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
        }

        buildRegistersMapping() {
            return {
                ...super.buildRegistersMapping(),
                0xFF4F: this.VBK,
                0xFF68: paletteRegister(this.bgPalettes, 'spec'),
                0xFF69: paletteRegister(this.bgPalettes, 'data'),
                0xFF6A: paletteRegister(this.objPalettes, 'spec'),
                0xFF6B: paletteRegister(this.objPalettes, 'data'),
            };
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
    }

    return CGBPPU;
}

export { Fetcher };
