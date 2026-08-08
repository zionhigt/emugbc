import { Register } from "../../lib/register";
import byte from "../../lib/byte";
import PPU, { Fetcher } from "./index.js";

const VRAM_START = 0x8000;
const VRAM_SIZE = 0x2000; // 8 Ko par banque

/**
 * VBK (0xFF4F) — l'aiguillage de banque, CÔTÉ PROCESSEUR.
 *
 * Un seul bit utile ; les sept autres se lisent à 1, comme partout ailleurs dans
 * le plan d'IO (`unused_hwio-C` : `test $FF4F %11111110`).
 *
 * Ce registre ne concerne QUE les accès du CPU à 0x8000-0x9FFF. Le PPU, lui, ne
 * le consulte jamais : il va chercher dans l'une ou l'autre banque selon ce
 * qu'il lit — la carte de tuiles en banque 0, son étiquette en banque 1, le
 * motif dans la banque que l'étiquette désigne. Confondre les deux, c'est faire
 * clignoter le fond au rythme des écritures du jeu.
 */
class VBKRegister extends Register(8) {
    getValue() {
        return 0xFE | (super.getValue() & 0x01);
    }

    setValue(value) {
        super.setValue(value & 0x01);
    }
}

/** Huit palettes de quatre couleurs, deux octets par couleur. */
const PALETTE_BYTES = 64;

const AUTO_INCREMENT = 0x80;
const INDEX_MASK = 0x3F;
/** Le bit 6 n'existe pas et se lit à 1 (`unused_hwio-C` : `test $FF68 %01000000`). */
const SPEC_READ_MASK = 0x40;

/**
 * LES PALETTES — 64 octets derrière une meurtrière de deux registres.
 *
 * Le CGB ne donne pas 64 adresses à sa RAM de palette : il en donne DEUX. Un
 * registre d'INDEX (BCPS/OCPS) qui dit où l'on est, et un registre de DONNÉE
 * (BCPD/OCPD) qui lit ou écrit là. Le bit 7 de l'index demande d'avancer tout
 * seul après chaque écriture — c'est ce qui permet de verser une palette entière
 * en huit écritures d'affilée sans jamais retoucher l'index.
 *
 * PIÈGE, et il est arbitré par blargg comme par le bon sens : l'auto-incrément
 * n'avance QU'À L'ÉCRITURE. Une lecture ne bouge pas le curseur. Un émulateur qui
 * avance aussi en lecture décale toutes les palettes d'un cran dès qu'un jeu
 * relit ce qu'il vient d'écrire.
 */
class PaletteAccess {
    constructor() {
        this.data = new Uint8Array(PALETTE_BYTES);
        this._spec = 0;
    }

    get index() {
        return this._spec & INDEX_MASK;
    }

    get autoIncrement() {
        return (this._spec & AUTO_INCREMENT) !== 0;
    }

    readSpec() {
        return this._spec | SPEC_READ_MASK;
    }

    writeSpec(value) {
        this._spec = value & (AUTO_INCREMENT | INDEX_MASK);
    }

    readData() {
        return this.data[this.index];
    }

    writeData(value) {
        this.data[this.index] = value;
        if (!this.autoIncrement) return;
        // Le curseur boucle sur 64 : c'est un compteur de 6 bits, il ne déborde
        // pas sur le bit d'auto-incrément.
        this._spec = (this._spec & AUTO_INCREMENT) | ((this.index + 1) & INDEX_MASK);
    }

    /** La couleur RGB555 d'une teinte dans une palette : deux octets, petit-boutiste. */
    color(palette, shade) {
        const at = (palette & 0x07) * 8 + (shade & 0x03) * 2;
        return ((this.data[at + 1] << 8) | this.data[at]) & 0x7FFF;
    }
}

/** Le registre vu du bus : il ne fait que relayer vers l'accès ci-dessus. */
function paletteRegister(access, kind) {
    return {
        getValue() { return kind === 'spec' ? access.readSpec() : access.readData(); },
        setValue(value) { return kind === 'spec' ? access.writeSpec(value) : access.writeData(value); },
    };
}

/**
 * OPRI (0xFF6C) — dans quel ordre les objets se recouvrent.
 *
 * Le DMG range ses objets par coordonnée X, le CGB par position dans l'OAM. Un
 * seul bit dit lequel des deux : 0 = ordre CGB, 1 = ordre DMG. C'est le boot ROM
 * du CGB qui le pose, après avoir regardé si la cartouche se déclare CGB —
 * autrement dit un jeu DMG tournant sur un CGB garde ses priorités DMG.
 *
 * Les sept autres bits n'existent pas et se lisent à 1, comme partout ailleurs.
 */
class OPRIRegister extends Register(8) {
    getValue() {
        return 0xFE | (super.getValue() & 0x01);
    }

    setValue(value) {
        super.setValue(value & 0x01);
    }
}

/** Le HDMA porte des blocs de 16 octets, jamais un de plus, jamais un de moins. */
const HDMA_BLOCK = 0x10;

const VRAM_END = VRAM_START + VRAM_SIZE - 1;

/**
 * HDMA1-4 — les quatre demi-adresses, EN ÉCRITURE SEULE.
 *
 * Le matériel ne les relit pas : il n'y a personne derrière, le bus laisse ses
 * lignes en l'air, donc à 1. Le contrôleur, lui, a besoin de ce qui a été écrit,
 * d'où `written` — la valeur brute, celle que le bus ne rend pas.
 */
class WriteOnlyRegister extends Register(8) {
    getValue() {
        return 0xFF;
    }

    get written() {
        return super.getValue();
    }
}

/**
 * LE HDMA — le second bouton-copie du CGB, celui qui vise la VRAM.
 *
 * Le DMG en avait déjà un (0xFF46), mais il ne remplit que l'OAM, toujours de la
 * même longueur, et d'un seul geste. Celui-ci sait faire une chose de plus :
 * **se découper en tranches**. Un déménagement en un camion plein qui bloque le
 * programme (transfert général), ou le même chargement porté carton par carton,
 * un carton de 16 octets à chaque fois que le PPU souffle en fin de ligne
 * (transfert HBlank). Dans le second cas le jeu continue de tourner entre deux
 * cartons : c'est ce qui permet de recharger tuiles et palettes PENDANT
 * l'affichage, et la plupart des jeux CGB en dépendent.
 *
 * Deux règles qui ne se devinent pas :
 *
 *  - il n'y a pas de HBlank en VBlank. Rien ne bouge aux lignes 144-153, et le
 *    transfert reprend tout seul à la ligne 0 ;
 *  - le CPU en `halt` GÈLE le transfert. Le DMA emprunte le bus au processeur,
 *    pas au PPU : processeur endormi, plus personne pour porter les cartons.
 */
class VramDma {
    constructor(ppu) {
        this.ppu = ppu;
        this.HDMA1 = new WriteOnlyRegister(); // source, octet haut
        this.HDMA2 = new WriteOnlyRegister(); // source, octet bas
        this.HDMA3 = new WriteOnlyRegister(); // destination, octet haut
        this.HDMA4 = new WriteOnlyRegister(); // destination, octet bas
        this.source = 0;
        this.destination = VRAM_START;
        this.remaining = 0;   // blocs restant à porter
        this.running = false; // un transfert HBlank est en cours
    }

    /**
     * HDMA5 en lecture : le bit 7 dit « aucun transfert en cours », les sept
     * autres comptent les blocs restants moins un. 0xFF = terminé.
     */
    get status() {
        if (this.running) return (this.remaining - 1) & 0x7F;
        if (this.remaining > 0) return 0x80 | ((this.remaining - 1) & 0x7F);
        return 0xFF;
    }

    /**
     * HDMA5 en écriture — un registre à DEUX usages, et c'est le piège :
     * le même bit 7 à 0 démarre un transfert général quand rien ne tourne, et
     * INTERROMPT le transfert HBlank en cours quand il y en a un.
     */
    write(value) {
        const hblankMode = byte.getFlag(value, 7);
        if (this.running && !hblankMode) {
            this.running = false; // interrompu : `remaining` reste lisible
            return;
        }

        this.source = ((this.HDMA1.written << 8) | this.HDMA2.written) & 0xFFF0;
        // La destination est toujours en VRAM : seuls les bits 12-4 comptent.
        this.destination = VRAM_START | (((this.HDMA3.written << 8) | this.HDMA4.written) & 0x1FF0);
        this.remaining = (value & 0x7F) + 1;
        this.running = true;

        if (hblankMode) return;
        // Transfert général : le camion part une fois, plein. Le vrai matériel
        // arrête le processeur pendant ce temps ; ici la copie est instantanée,
        // comme celle de l'OAM (0xFF46), et les cycles ne sont pas facturés.
        while (this.running) this.copyBlock();
    }

    /** Le souffle de fin de ligne : un carton, s'il reste quelqu'un pour le porter. */
    onHBlank() {
        if (!this.running) return;
        if (this.ppu.machine.cpu.halted) return;
        this.copyBlock();
    }

    copyBlock() {
        const memory = this.ppu.machine.memory;
        for (let i = 0; i < HDMA_BLOCK; i++) {
            // La source passe par le bus du PROCESSEUR (`read`) et non par la
            // mémoire plate : elle est presque toujours en ROM, donc derrière le
            // MBC et sa banque courante.
            this.ppu.vramWrite(this.destination, memory.read(this.source));
            this.source = (this.source + 1) & 0xFFFF;
            this.destination++;
        }
        this.remaining--;
        // Fini, ou sorti de la VRAM par le haut : dans les deux cas on s'arrête.
        if (this.remaining === 0 || this.destination > VRAM_END) {
            this.remaining = 0;
            this.running = false;
        }
    }
}

/** HDMA5, vu du bus : il ne fait que relayer vers le contrôleur. */
function hdmaRegister(dma) {
    return {
        getValue() { return dma.status; },
        setValue(value) { return dma.write(value); },
    };
}

/**
 * LE PPU CGB — une surcharge du DMG, pas un second PPU.
 *
 * Il ne redéfinit que les endroits où le matériel diverge, ouverts au lot 0. Au
 * lot 2, ces endroits sont la VRAM (deux banques au lieu d'une) et la table de
 * registres (VBK en plus). Le trajet du pixel, lui, n'a pas bougé d'un iota.
 */
export default function(machine) {
    const DMGPPU = PPU(machine);

    class CGBPPU extends DMGPPU {
        constructor(FetcherClass) {
            super(FetcherClass);
            // La banque 0 reste là où elle a toujours été, dans la mémoire plate :
            // tout le DMG continue de la lire sans rien savoir de cette histoire.
            // Seule la banque 1 est un tampon à part.
            this._vramBank1 = new Uint8Array(VRAM_SIZE);
            this.VBK = new VBKRegister();
            this.bgPalettes = new PaletteAccess();
            this.objPalettes = new PaletteAccess();
            this.OPRI = new OPRIRegister();
            this.hdma = new VramDma(this);
        }

        buildRegistersMapping() {
            return {
                ...super.buildRegistersMapping(),
                0xFF4F: this.VBK,
                0xFF51: this.hdma.HDMA1,
                0xFF52: this.hdma.HDMA2,
                0xFF53: this.hdma.HDMA3,
                0xFF54: this.hdma.HDMA4,
                0xFF55: hdmaRegister(this.hdma),
                0xFF68: paletteRegister(this.bgPalettes, 'spec'),
                0xFF69: paletteRegister(this.bgPalettes, 'data'),
                0xFF6A: paletteRegister(this.objPalettes, 'spec'),
                0xFF6B: paletteRegister(this.objPalettes, 'data'),
                0xFF6C: this.OPRI,
            };
        }

        /** Le CGB porte un carton de HDMA à chaque fin de ligne. */
        enterHBlank() {
            this.hdma.onHBlank();
        }

        /** La banque que le CPU voit en ce moment. */
        get vramBank() {
            return this.VBK.getValue() & 0x01;
        }

        vramRead(addr) {
            return this.vramReadBank(addr, this.vramBank);
        }

        vramWrite(addr, value) {
            if (this.vramBank === 1) {
                this._vramBank1[addr - VRAM_START] = value;
                return;
            }
            return super.vramWrite(addr, value);
        }

        vramReadBank(addr, bank) {
            if (bank === 1 && addr >= VRAM_START && addr < VRAM_START + VRAM_SIZE) {
                return this._vramBank1[addr - VRAM_START];
            }
            // Hors VRAM (l'OAM, notamment) il n'y a pas de banque : on retombe
            // sur la lecture plate, quelle que soit la banque demandée.
            return super.vramReadBank(addr, 0);
        }

        // ─── L'ÉTIQUETTE DE TUILE, et tout ce qu'elle commande ───

        /**
         * Elle vit à la MÊME adresse que l'identifiant, mais dans la banque 1.
         * C'est toute l'astuce du CGB : la carte de tuiles n'a pas bougé d'un
         * octet, on a mis un second tiroir derrière.
         */
        tileAttributes(mapAddress) {
            return this.vramReadBank(mapAddress, 1);
        }

        /**
         * Bit 3 : le motif de cette tuile vit dans l'une ou l'autre banque.
         *
         * `getBit` et non `getFlag` : la couture rend un NUMÉRO de banque, pas un
         * booléen, et `vramReadBank` compare strictement. Un `true` s'y lisait
         * comme « pas la banque 1 », et le motif revenait silencieusement de la
         * banque 0 — le fond restait juste assez plausible pour ne rien voir.
         */
        patternBank(attrs) {
            return byte.getBit(attrs, 3);
        }

        /** Bit 6 : miroir vertical — on lit la rangée depuis l'autre bout. */
        patternRow(row, attrs) {
            return byte.getFlag(attrs, 6) ? 7 - row : row;
        }

        /** Bit 5 : miroir horizontal — on lit les huit bits à l'envers. */
        patternBit(column, attrs) {
            return byte.getFlag(attrs, 5) ? column : 7 - column;
        }

        /** Bit 7 : cette tuile passe devant les sprites. Croisé au lot 5. */
        tilePriority(attrs) {
            return byte.getBit(attrs, 7);
        }

        /** Bits 0-2 : laquelle des huit palettes de fond colorie cette tuile. */
        backgroundColor(shade, attrs) {
            return this.bgPalettes.color(attrs & 0x07, shade);
        }

        // ─── LES OBJETS ───

        /**
         * LCDC bit 0 ne coupe plus le décor, il lui retire seulement sa priorité
         * (voir `spriteOverBackground`). Le décor du CGB est donc TOUJOURS
         * dessiné, et la fenêtre reste commandée par le seul bit 5.
         */
        backgroundVisible() {
            return true;
        }

        /** Bit 3 des attributs OAM : la banque où vit le motif de l'objet. */
        spriteBank(sprite) {
            return byte.getBit(sprite.attrs, 3);
        }

        /** Bits 0-2 : l'une des huit palettes d'objet. OBP0/OBP1 ne servent plus. */
        spriteColor(shade, sprite) {
            return this.objPalettes.color(sprite.attrs & 0x07, shade);
        }

        /**
         * LA TABLE DE PRIORITÉS À TROIS ENTRÉES, écrite dans l'ordre où le
         * matériel la résout (pandocs, « BG-to-OBJ Priority in CGB Mode ») :
         *
         *   1. teinte de fond 0        -> l'objet passe, toujours ;
         *   2. LCDC bit 0 à 0          -> le décor a perdu sa priorité, l'objet passe ;
         *   3. bit 7 de l'étiquette OU bit 7 de l'OAM -> le décor passe devant ;
         *   4. sinon                   -> l'objet passe.
         *
         * Le piège de lecture est dans la troisième ligne : le bit 7 de l'OAM
         * donne la priorité à l'objet quand il est À ZÉRO. Deux drapeaux, un OU,
         * et la règle bascule si on écrit un ET.
         */
        spriteOverBackground(sprite, x) {
            if (this.bgLine[x] === 0) return true;
            if (!byte.getFlag(this.LCDC.getValue(), 0)) return true;
            return !byte.getFlag(sprite.attrs, 7) && !this.bgPriority[x];
        }

        /** OPRI bit 0 : 1 réclame l'ordre DMG, celui de la coordonnée X. */
        get dmgSpritePriority() {
            return byte.getFlag(this.OPRI.getValue(), 0);
        }

        /**
         * En CGB, seule la position dans l'OAM compte. Tri DÉCROISSANT comme en
         * DMG, pour la même raison : `renderSprites` retient le DERNIER écrit,
         * donc l'index le plus petit doit passer en dernier.
         */
        spriteOrder(visibles) {
            if (this.dmgSpritePriority) return super.spriteOrder(visibles);
            return visibles.sort(function(a, b) {
                return b.index - a.index;
            });
        }
    }

    return CGBPPU;
}

export { Fetcher };
