import { Register } from "../../lib/register";
import byte from "../../lib/byte";

/**
 * LE FORMAT DE SORTIE DU PPU — décision D1 du cahier CGB.
 *
 * `screen` porte du RGB555 (0bxBBBBBGGGGGRRRRR), POUR LES DEUX MODÈLES. Le DMG
 * n'a que quatre teintes, mais il les traverse ici plutôt que de laisser le
 * front deviner : sinon l'affichage garderait un « si CGB » permanent, et la
 * promesse « le CGB est une surcharge » s'arrêterait à la frontière du rendu.
 *
 * C'est aussi le format du matériel : le CGB range ses palettes exactement
 * comme ça, cinq bits par composante, le bleu en haut.
 */
export const toRgb555 = (r, g, b) => ((b >> 3) << 10) | ((g >> 3) << 5) | (r >> 3);

/** Les quatre verts de la dalle DMG, dans l'ordre des teintes 0 à 3. */
export const DMG_COLORS = [
    toRgb555(155, 188, 15),
    toRgb555(139, 172, 15),
    toRgb555(48, 98, 48),
    toRgb555(15, 56, 15),
];

/** Le blanc de l'écran éteint : la dalle laiteuse, pas du noir. */
export const BLANK_COLOR = DMG_COLORS[0];

class LYregister extends Register(8) {
    
    constructor(parent) {
        super();
        this.parent = parent;
    }

    getValue() {
        if (!this.parent.LCDC.isOn) return 0;
        return this.parent.computeState(this.parent.totalMachineCycles, 4).line;
    }
}
class LYCregister extends Register(8) {
    
    constructor(parent) {
        super();
        this.parent = parent;
    }

    setValue(value) {
        super.setValue(value);
        this.parent.updateStat();
    }
}

class LCDCregister extends Register(8) {
    constructor(parent) {
        super();
        super.setValue(0x91);
        this.parent = parent;
    }

    get isOn() {
        return byte.getFlag(this.getValue(), 7);
    }

    setValue(value) {
        const a = this.isOn;
        const b = byte.getFlag(value, 7);
        super.setValue(value);
        if (a !== b) {
            if (b) return this.parent.wake();
            return this.parent.sleep();
        }
    }
}
class STATregister extends Register(8) {
    constructor(parent) {
        super();
        this.parent = parent;
    }

    get bus() {
        return this.parent.bus;
    }

    getValue() {
        const ly = this.parent.LY.getValue();
        const lyc = this.parent.LYC.getValue();
        const { mode, line } = this.parent.LCDC.isOn ?
            this.parent.computeState(this.parent.totalMachineCycles, 3) :
            { line: null, mode: 0 };
        const coincidence = this.parent.computeCoincidence();
        return 0x80 | (super.getValue() & 0x78) | (coincidence << 2) | mode;
    }

    setValue(value) {
        super.setValue(value & 0x78);
        this.parent.updateStat();
    }
}
class DMAregister extends Register(8) {
    constructor(parent) {
        super();
        this.parent = parent;
    }

    get bus() {
        return this.parent.bus;
    }

    setValue(value) {
        super.setValue(value);
        const source = value << 8;

        for (let i = 0; i <= 0x9F; i++) {
            this.bus.ppuWrite(0xFE00 + i, this.bus.ppuRead(source + i))
        }
    }
}

/**
 * LA FIFO DE FOND — exportée, et injectée dans le PPU plutôt qu'instanciée par
 * lui (voir le constructeur de PPU).
 *
 * C'est ici que se lit la tuile de fond : l'identifiant dans la carte, puis les
 * deux octets de motif. Un PPU CGB doit lire au même endroit un octet de PLUS,
 * l'étiquette rangée dans la banque 1 de VRAM, qui dit quelle palette prendre,
 * s'il faut retourner la tuile et si elle passe devant les sprites. Tant que
 * cette classe restait privée du module et construite en dur, aucune sous-classe
 * ne pouvait l'atteindre — d'où la couture.
 */
export class Fetcher {
    constructor(parent) {
        this.fifo = [];
        this.step = 0;
        this.fetchX = 0;
        this.id = null;
        this.low = 0;
        this.high = 0;
        this.x = 0;
        this.dy = 0;
        this.parent = parent;
        this.discard = 0;
        // L'étiquette de la tuile qu'on vient d'aller chercher, et celle des
        // pixels actuellement dans la FIFO. Deux champs et pas un : la tuile
        // SUIVANTE est lue alors qu'il reste sept pixels de la précédente à
        // sortir — un seul champ les colorierait avec la mauvaise étiquette.
        // En DMG les deux valent toujours 0 (voir PPU.tileAttributes).
        this.fetchedAttrs = 0;
        this.attrs = 0;
    }

    tick(line) {
        const dy = this.dy;
        const card = byte.getFlag(this.parent.LCDC.getValue(), 3) ? 0x9C00 : 0x9800;
        const addr = card + (dy >> 3) * 32 + (this.fetchX & 31);
        let tile;
        switch (this.step) {
            case 0:
                this.id = this.parent.bus.ppuRead(addr);
                this.fetchedAttrs = this.parent.tileAttributes(addr);
                this.step = 1;
                break;
            case 1:
                tile = this.parent.tileAddress(this.id);
                this.low = this.parent.bus.ppuReadBank(
                    tile + this.parent.patternRow(dy % 8, this.fetchedAttrs) * 2,
                    this.parent.patternBank(this.fetchedAttrs),
                );
                this.step = 2;
                break;
            case 2:
                tile = this.parent.tileAddress(this.id);
                this.high = this.parent.bus.ppuReadBank(
                    tile + this.parent.patternRow(dy % 8, this.fetchedAttrs) * 2 + 1,
                    this.parent.patternBank(this.fetchedAttrs),
                );
                this.step = 3;
                break;
            case 3:
                if (this.fifo.length === 0) {
                    // Les huit pixels qu'on pousse portent l'étiquette de LEUR
                    // tuile : on la fige ici, avant que l'étape 0 du tour suivant
                    // n'aille chercher celle d'après.
                    this.attrs = this.fetchedAttrs;
                    for (let column = 0; column < 8; column++) {
                        const bit = this.parent.patternBit(column, this.attrs);
                        const teinte = byte.getBit(this.high, bit) * 2 + byte.getBit(this.low, bit);
                        this.fifo.push(teinte);
                    }
                    this.fetchX++;
                    this.step = 0;
                }
                break;
        }
        if (this.fifo.length > 0) {
            if (this.discard > 0) {
                this.fifo.shift();
                this.discard--;
                return;
            }
            const pixel = this.fifo.shift();
            this.parent.bgLine[this.x] = pixel;
            this.parent.bgPriority[this.x] = this.parent.tilePriority(this.attrs);
            this.parent.screen[line * 160 + this.x] = this.parent.backgroundColor(pixel, this.attrs);
            this.x++;
        }

    }

    renderFifo(line) {
        if (line === 0) this.parent.windowLine = 0;

        // Le fond d'abord, s'il est visible. LCDC bit 0 ne dit pas la même chose
        // dans les deux modèles — d'où la couture : en DMG il éteint le décor, en
        // CGB il ne fait que lui retirer sa priorité, et le décor reste peint.
        if (this.parent.backgroundVisible()) {
            const scx = this.parent.SCX.getValue();
            this.fifo = [];
            this.fetchX = scx >> 3;
            this.step = 0;
            this.x = 0;
            this.discard = scx & 7;
            this.fetchedAttrs = 0;
            this.attrs = 0;
            this.dy = (line + this.parent.SCY.getValue()) & 0xFF;
            while (this.x < 160) {
                this.tick(line);
            }

            if (byte.getFlag(this.parent.LCDC.getValue(), 5) && line >= this.parent.WY.getValue() && this.parent.WX.getValue() <= 166) {
                this.parent.renderWindow(line);
                this.parent.windowLine++;
            }
        } else {
            this.parent.blankLine(line);
        }

        // Les objets, eux, sont dessinés dans les deux cas : un décor éteint est
        // blanc, pas absent, et rien n'empêche un objet de passer par-dessus.
        if (byte.getFlag(this.parent.LCDC.getValue(), 1)) this.parent.renderSprites(line);
    }
}

export default function(machine) {
    class PPU {
        /**
         * `FetcherClass` est une DÉPENDANCE, pas un réglage : le PPU ne connaît
         * plus la classe qui remplit sa FIFO, on la lui donne. C'est ce qui
         * permettra à un PPU CGB d'en fournir une autre sans toucher à celle-ci.
         *
         * Elle n'a pas de valeur par défaut, volontairement : un défaut ferait
         * silencieusement retomber le CGB sur la FIFO DMG le jour où un appelant
         * oublie de la passer, et la panne se lirait comme un bug de rendu.
         */
        constructor(FetcherClass) {
            if (typeof FetcherClass !== 'function') {
                throw new Error('PPU : il faut lui injecter une classe de Fetcher');
            }
            this.machine = machine;
            this.LY = new LYregister(this);
            this.LCDC = new LCDCregister(this);
            this.STAT = new STATregister(this);
            this.SCY = new (Register(8));
            this.SCX = new (Register(8));
            this.LYC = new LYCregister(this);
            this.DMA = new DMAregister(this);
            this.BGP = new (Register(8));
            this.OBP0 = new (Register(8));
            this.OBP1 = new (Register(8));
            this.WY = new (Register(8));
            this.WX = new (Register(8));


            this.line = 0;
            this.mode = 2;

            this.screen = new Uint16Array(160 * 144);
            this.screen.fill(BLANK_COLOR);
            this.windowLine = 0;
            this.bgLine = new Uint8Array(160);
            // Le plan de priorité du fond : le bit 7 de l'étiquette, un par pixel.
            // Toujours 0 en DMG. Le lot 5 le croise avec l'attribut du sprite.
            this.bgPriority = new Uint8Array(160);
            // Le pixel d'objet retenu pour chaque colonne, et l'objet dont il
            // vient. Bâtis une fois : `renderSprites` les remplit à chaque ligne.
            this.objLine = new Uint8Array(160);
            this.objOwner = new Array(160).fill(null);
            this.remain = this.duration(this.mode);
            this.lastSeen = 0;
            this.origin = 0;

            this.statLine = 0;

            this.lcdJustOn = false;
            this.mode3Penality = 0;
            this._visibleLineSprites = {};

            this.coincidence = 0;

            this.fetcher = new FetcherClass(this);
            this._bus = this.buildBus();
            this._registersMapping = null; // bâtie à la première demande, voir le getter
        }

        sleep() {
            // Écran coupé : la dalle redevient laiteuse, pas noire.
            this.screen.fill(BLANK_COLOR);
        }

        wake() {
            this.line = 0;
            this.mode = 0;
            this.remain = this.duration(2);
            this.lcdJustOn = true;
            this.lastSeen = this.totalMachineCycles;
            this.origin = this.totalMachineCycles;
            this.updateStat();
        }

        /**
         * Le bus est bâti UNE fois. Il était reconstruit à chaque accès, or le
         * fetcher l'appelle plusieurs fois par pixel : c'était un objet de deux
         * méthodes alloué ~100 000 fois par trame, sur le chemin le plus chaud
         * du PPU. Même motif que les tables de registres (voir apu/index.js).
         */
        buildBus() {
            const self = this;
            return {
                ppuRead(addr) {
                    return self.machine.memory._read(addr);
                },
                /**
                 * Lire en visant une banque de VRAM. En DMG il n'y en a qu'une :
                 * la banque demandée est ignorée. Le CGB range ses étiquettes de
                 * tuile dans la banque 1 et surcharge `vramReadBank`.
                 */
                ppuReadBank(addr, bank) {
                    return self.vramReadBank(addr, bank);
                },
                ppuWrite(addr, value) {
                    return self.machine.memory._write(addr, value);
                }
            }
        }

        get bus() {
            return this._bus;
        }

        /**
         * LA VRAM, VUE DU CPU (0x8000-0x9FFF). Une seule banque en DMG, deux en
         * CGB, commutées par VBK — c'est un aiguillage CÔTÉ PROCESSEUR, et lui
         * seul : le PPU, lui, lit les deux banques quand il veut (`vramReadBank`).
         * La section mémoire passe par ici, ce qui laisse au CGB un unique
         * endroit à surcharger.
         */
        vramRead(addr) {
            return this.machine.memory._read(addr);
        }

        vramWrite(addr, value) {
            return this.machine.memory._write(addr, value);
        }

        /** En DMG la banque demandée n'existe pas : il n'y en a qu'une. */
        vramReadBank(addr, bank) {
            return this.machine.memory._read(addr);
        }

        /**
         * L'ADRESSE DU MOTIF d'une tuile de fond, depuis son identifiant. Les deux
         * modes d'adressage de LCDC bit 4 : indexé depuis 0x8000, ou SIGNÉ autour
         * de 0x9000 — la moitié haute des identifiants vit alors sous 0x9000.
         */
        tileAddress(id) {
            return byte.getFlag(this.LCDC.getValue(), 4) ?
                0x8000 + id * 16 :
                0x9000 + byte.sign8(id) * 16;
        }

        /**
         * LES TROIS COUTURES DU MOTIF. En DMG elles ne font rien — une tuile se
         * lit toujours dans la seule banque, à l'endroit, dans l'ordre. Le CGB y
         * branche ce que dit l'étiquette : la banque (bit 3), le miroir vertical
         * (bit 6) et le miroir horizontal (bit 5).
         */
        patternRow(row, attrs) {
            return row;
        }

        patternBank(attrs) {
            return 0;
        }

        patternBit(column, attrs) {
            return 7 - column;
        }

        /**
         * La tuile passe-t-elle DEVANT les sprites ? Jamais en DMG : là-bas, seul
         * l'attribut du sprite décide. Le CGB ajoute le bit 7 de l'étiquette, et
         * les deux se combinent au lot 5.
         */
        tilePriority(attrs) {
            return 0;
        }

        /**
         * L'ÉTIQUETTE D'UNE TUILE DE FOND, à l'adresse où son identifiant a été lu.
         *
         * En DMG il n'y en a pas : on rend 0, le neutre — pas de miroir, pas de
         * palette à choisir, pas de priorité sur les sprites. Le CGB lira l'octet
         * rangé à la MÊME adresse dans la banque 1 de VRAM.
         */
        tileAttributes(mapAddress) {
            return 0;
        }

        /**
         * LE COLORIAGE DU FOND — un seul endroit, alors qu'il était recopié dans
         * le fetcher et dans la fenêtre.
         *
         * En DMG, les deux bits de teinte traversent BGP et rien d'autre : `attrs`
         * ne sert pas. Le CGB y lira le numéro de palette (bits 0-2) pour aller
         * chercher la couleur dans sa RAM de palette.
         */
        backgroundColor(shade, attrs) {
            return DMG_COLORS[(this.BGP.getValue() >> (shade * 2)) & 0b11];
        }

        /**
         * LE COLORIAGE D'UN SPRITE. En DMG le bit 4 des attributs OAM choisit entre
         * les deux palettes d'objet ; le CGB ignore ces deux-là et lit un numéro de
         * palette sur les bits 0-2.
         */
        spriteColor(shade, sprite) {
            const palette = byte.getFlag(sprite.attrs, 4) ? this.OBP1 : this.OBP0;
            return DMG_COLORS[(palette.getValue() >> (shade * 2)) & 0b11];
        }

        /**
         * LE DÉCOR EST-IL VISIBLE ? C'est LCDC bit 0, et c'est le bit qui change
         * de SENS d'un modèle à l'autre :
         *
         *   DMG  — décor et fenêtre deviennent blancs, la fenêtre est ignorée.
         *          Seuls les objets peuvent encore s'afficher.
         *   CGB  — le décor reste dessiné. Le bit ne fait que lui retirer sa
         *          priorité : les objets passent devant, quoi qu'en disent les
         *          bits 7 de l'OAM et de l'étiquette.
         *
         * Confondre les deux peint des bandes entières en blanc — c'est
         * exactement ce que faisait le PPU CGB avant le lot 5.
         */
        backgroundVisible() {
            return byte.getFlag(this.LCDC.getValue(), 0);
        }

        /** Décor éteint : la ligne est blanche, et transparente pour les objets. */
        blankLine(line) {
            this.screen.fill(BLANK_COLOR, line * 160, line * 160 + 160);
            this.bgLine.fill(0);
            this.bgPriority.fill(0);
        }

        /**
         * LA BANQUE DU MOTIF D'UN OBJET — le pendant de `patternBank` pour les
         * sprites. Toujours 0 en DMG ; le CGB lit le bit 3 des attributs OAM.
         * Un NUMÉRO, pas un booléen (voir la règle apprise au lot 4).
         */
        spriteBank(sprite) {
            return 0;
        }

        /**
         * CE PIXEL D'OBJET PASSE-T-IL DEVANT LE FOND ?
         *
         * En DMG la règle tient en une ligne : le bit 7 des attributs OAM range
         * l'objet derrière les teintes 1-3 du décor. Le CGB y ajoute deux entrées
         * (LCDC bit 0 et le bit 7 de l'étiquette de tuile) et surcharge.
         */
        spriteOverBackground(sprite, x) {
            if (this.bgLine[x] === 0) return true;
            return !byte.getFlag(sprite.attrs, 7);
        }

        /**
         * L'ORDRE DE DESSIN DES SPRITES D'UNE LIGNE.
         *
         * Tri DESCENDANT, et ce n'est pas un détail : `renderSprites` dessine dans
         * cet ordre et chaque sprite écrase le précédent, donc le dernier dessiné
         * est celui qui gagne. En DMG le plus petit X gagne, l'index OAM départage
         * les égalités. Le CGB, lui, ne regardera que l'index — sauf si OPRI
         * réclame le comportement DMG.
         */
        spriteOrder(visibles) {
            return visibles.sort(function(a, b) {
                return (b.x - a.x) || (b.index - a.index);
            });
        }
        
        get totalMachineCycles() {
            return this.machine.totalCycles;
        }

        /**
         * La table adresse -> registre. Une sous-classe y ajoute les siens :
         *
         *   buildRegistersMapping() {
         *       return { ...super.buildRegistersMapping(), 0xFF4F: this.VBK };
         *   }
         *
         * (Le routage mémoire ne couvre aujourd'hui que 0xFF40-0xFF4B : l'élargir
         * fera partie du lot qui introduira ces registres-là.)
         */
        buildRegistersMapping() {
            return {
                0xFF40: this.LCDC,
                0xFF41: this.STAT,
                0xFF42: this.SCY,
                0xFF43: this.SCX,
                0xFF44: this.LY,
                0xFF45: this.LYC,
                0xFF46: this.DMA,
                0xFF47: this.BGP,
                0xFF48: this.OBP0,
                0xFF49: this.OBP1,
                0xFF4A: this.WY,
                0xFF4B: this.WX,
            };
        }

        /**
         * Bâtie à la PREMIÈRE DEMANDE, pas dans le constructeur, et gardée ensuite.
         *
         * Deux raisons qui vont ensemble. La rebâtir à chaque appel mettait un objet
         * de douze clés entières sur le chemin de tout accès à 0xFF40-0xFF4B — dont
         * STAT et LY, que les jeux sondent en boucle. Et la bâtir dans le
         * constructeur de base la figerait AVANT qu'une sous-classe ait eu le temps
         * de créer ses propres registres : ses champs à elle ne sont posés qu'au
         * retour de `super()`, donc ils manqueraient à l'appel.
         */
        get registersMapping() {
            if (!this._registersMapping) {
                this._registersMapping = this.buildRegistersMapping();
            }
            return this._registersMapping;
        }

        renderWindow(line) {
            const startX = this.WX.getValue() - 7;
            const card = byte.getFlag(this.LCDC.getValue(), 6) ? 0x9C00 : 0x9800;
            const wrow = this.windowLine;

            for (let x = 0; x < 160; x++) {
                if (x < startX) continue;
                const wx = x - startX;
                const mapAddress = card + (wrow >> 3) * 32 + (wx >> 3);
                const id = this.bus.ppuRead(mapAddress);
                const attrs = this.tileAttributes(mapAddress);
                const tile = this.tileAddress(id);
                const row = this.patternRow(wrow & 7, attrs);
                const bank = this.patternBank(attrs);
                const low = this.bus.ppuReadBank(tile + row * 2, bank);
                const high = this.bus.ppuReadBank(tile + row * 2 + 1, bank);
                const bit = this.patternBit(wx & 7, attrs);
                const teinte = byte.getBit(high, bit) * 2 + byte.getBit(low, bit);
                this.bgLine[x] = teinte;
                this.bgPriority[x] = this.tilePriority(attrs);
                this.screen[line * 160 + x] = this.backgroundColor(teinte, attrs);

            }
        }

        visibleLineSprites(line) {

            if (line in (this._visibleLineSprites || {})) return this._visibleLineSprites[line];
            const h = byte.getFlag(this.LCDC.getValue(), 2) ? 16 : 8;
            let visibles = [];
            for (let i = 0; i < 40 && visibles.length < 10; i++) {
                const addr = 0xFE00 + i * 4;
                const y = this.bus.ppuRead(addr) - 16;

                if (line >= y && line < y + h) {
                    visibles.push({
                        y,
                        x: this.bus.ppuRead(addr+1)-8,
                        index:i,
                        tile: this.bus.ppuRead(addr+2),
                        attrs: this.bus.ppuRead(addr+3)
                    })
                }
            }

            visibles = this.spriteOrder(visibles);
            this._visibleLineSprites = {[line]: visibles};
            return this._visibleLineSprites[line];
        }

        computeOAMPenality(line) {
            let penality = 0;
            if (byte.getFlag(this.LCDC.getValue(), 1)) {
                const visibles = this.visibleLineSprites(line);
                const tmp = [];
                const scx = this.SCX.getValue();
                for (let o of Object.values(visibles)) {
                    if (o.x >= 160) continue;
                    if (!tmp.includes(o.x)) {
                        tmp.push(o.x);
                        if (o.x === -8) penality += 5;
                        else penality += Math.max(0, 5 - ((o.x + scx) & 7));
                    };
                    penality += 6;
                }
            }

            return penality;

        }

        /**
         * LES OBJETS, EN DEUX TEMPS — et l'ordre des deux temps est du matériel,
         * pas une commodité d'écriture.
         *
         * Le PPU choisit d'abord UN pixel d'objet par colonne : le premier opaque
         * dans l'ordre de priorité, sans jamais regarder le bit « BG over OBJ ».
         * Ce n'est qu'ensuite qu'il demande à ce pixel-là s'il passe devant le
         * fond. Conséquence contre-intuitive, mais bien réelle : un objet
         * prioritaire qui perd contre le décor MASQUE ceux de derrière au lieu de
         * leur céder la place. Les jeux s'en servent pour ne cacher qu'une partie
         * d'un objet derrière le décor.
         */
        renderSprites(line) {
            const h = byte.getFlag(this.LCDC.getValue(), 2) ? 16 : 8;

            // Premier temps : qui gagne la colonne. `spriteOrder` rend l'ordre
            // croissant de priorité, donc le dernier à écrire est le bon.
            this.objLine.fill(0);
            for (let sprite of this.visibleLineSprites(line)) {
                let row = line - sprite.y;
                if (byte.getFlag(sprite.attrs, 6)) {
                    row = h - 1 - row
                }

                let tile = sprite.tile;
                if (h === 16) {
                    tile = (sprite.tile & 0xFE) + +(row >= 8);
                    row = row & 7;
                }

                const adr = 0x8000 + tile * 16;
                const bank = this.spriteBank(sprite);
                const low = this.bus.ppuReadBank(adr + row * 2, bank);
                const high = this.bus.ppuReadBank(adr + row * 2 + 1, bank);

                for (let col = 0; col < 8; col++) {
                    const bit = byte.getFlag(sprite.attrs, 5) ? col : 7 - col;
                    const teinte = byte.getBit(high, bit) * 2 + byte.getBit(low, bit);
                    if (teinte === 0) continue;
                    const ex = sprite.x + col;

                    if (ex < 0 || ex >= 160) continue;
                    this.objLine[ex] = teinte;
                    this.objOwner[ex] = sprite;
                }
            }

            // Second temps : le fond peut encore reprendre la colonne.
            for (let x = 0; x < 160; x++) {
                const teinte = this.objLine[x];
                if (teinte === 0) continue;
                const sprite = this.objOwner[x];
                if (!this.spriteOverBackground(sprite, x)) continue;
                this.screen[line * 160 + x] = this.spriteColor(teinte, sprite);
            }
        }

        renderLine(line) {
            return this.fetcher.renderFifo(line);
        }

        fetchLine() {
            this.line++;
            if (this.mode == 1 && this.line >= 154) {
                this.line = 0;
                this.mode = 2;
            }
        }

        computeCoincidence(cycles=this.totalMachineCycles) {
            let coincidence = this.coincidence;
            if (this.LCDC.isOn) {
                const line = this.computeState(cycles, 4).line;
                const prev = this.computeState(cycles, 0).line;
                if (line !== prev) {
                    coincidence = 0;
                } else {
                    const ly = this.LY.getValue();
                    const lyc = this.LYC.getValue();
                    coincidence = +(ly === lyc);
                }
            }
            return coincidence;

        }

        updateStat() {
            if (!this.LCDC.isOn) return;
            const LYC = this.LYC.getValue();
            const stat = this.STAT.getValue();
            this.coincidence = (this.line === LYC) ? 1 : 0;
            const { line, mode } = this;
            const level = (this.coincidence && byte.getFlag(stat, 6)) ||
                        (mode === 0 && byte.getFlag(stat, 3)) ||
                        (mode === 1 && byte.getFlag(stat, 4)) ||
                        (mode === 2 && byte.getFlag(stat, 5)) ||
                        (line === 144 && byte.getFlag(stat, 5))
            if (level && !this.statLine) {
                this.machine.IF |= 0b00010;
            }
            this.statLine = level;
        }

        /**
         * LE SOUFFLE DE FIN DE LIGNE. Rien à y faire en DMG — c'est du temps mort.
         * Le CGB y cadence son HDMA : un bloc de 16 octets par HBlank, et aucun
         * pendant le VBlank, puisqu'on n'y passe jamais par ici (mode 1 ne
         * traverse pas le mode 3).
         */
        enterHBlank() {
        }

        duration(mode) {
            return [204, 456, 80, 172][mode % 4];
        }

        transition() {
            switch (this.mode) {
                case 0:
                    this.mode = 2;
                    if (this.lcdJustOn) {
                        this.lcdJustOn = false;
                        return this.transition();
                    };
                    this.fetchLine();
                    if (this.line >= 144) {
                        this.mode = 1;
                        this.machine.IF |= 0b00001;
                    }
                    break;
                case 1:
                    this.fetchLine();
                    break;
                case 2:
                    this.mode = 3;
                    this.mode3Penality = this.SCX.getValue() & 7;
                    this.mode3Penality += this.computeOAMPenality(this.line);
                    this.renderLine(this.line);
                    break;
                case 3:
                    this.mode = 0;
                    this.enterHBlank();
                    break;
            }

            this.updateStat();

            // Débordement négatif
            let overflow = 0;
            if (this.remain < 0) {
                overflow = this.remain;
            }
            let penality = 0;
            if (this.mode === 0) {
                penality = -this.mode3Penality;
            } 
            if (this.mode === 3) {
                penality = this.mode3Penality;
            } 
            this.remain = this.duration(this.mode) + penality + overflow;
        }

        computeState(cycle = this.totalMachineCycles, dotOffset=0) {
            let mode;
            const elapsedDots = 4 * (cycle - this.origin) + dotOffset;
            const frameDot    = elapsedDots % 70224;
            const line        = Math.floor(frameDot / 456);
            const dotInLine   = frameDot % 456;
            const len         = 172 + (this.SCX.getValue() & 7) + this.computeOAMPenality(line);
            if      (line >= 144)          mode = 1;
            else if (dotInLine < 80)       mode = 2;
            else if (dotInLine < 80 + len) mode = 3;
            else                           mode = 0;

            if (elapsedDots < 456) {
                if (dotInLine < 80) mode = 0;
            }

            return { line, mode };
        }

        check() {
            if (!this.LCDC.isOn) return;
            const delta = (this.totalMachineCycles - this.lastSeen) * 4;
            this.lastSeen = this.totalMachineCycles;
            this.remain -= delta;
            while (this.remain <= 0) {                
                this.transition();
            }
        }

        read (addr) {
            return this.registersMapping[addr].getValue();
        };

        write (addr, value) {
            return this.registersMapping[addr].setValue(value);
        };

    }

    return PPU;
}