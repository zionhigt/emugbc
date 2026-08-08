import { Register } from "../../lib/register";

/** 4 Ko par banque, sept banques commutables en 0xD000-0xDFFF. */
const WRAM_BANK_SIZE = 0x1000;
const WRAM_BANKED_START = 0xD000;
const WRAM_BANKS = 8;

/**
 * SVBK (0xFF70) — l'aiguillage des banques de WRAM.
 *
 * Trois bits, et une règle qui se retient : la banque 0 n'existe pas là-haut.
 * La demander donne la banque 1 — 0xC000-0xCFFF, elle, est déjà la banque 0 et
 * ne bouge jamais. Les cinq bits du haut n'existent pas et se lisent à 1.
 */
class SVBKRegister extends Register(8) {
    getValue() {
        return 0xF8 | (super.getValue() & 0x07);
    }

    setValue(value) {
        super.setValue(value & 0x07);
    }

    /** Le numéro de banque réellement visible en 0xD000. */
    get bank() {
        return (super.getValue() & 0x07) || 1;
    }
}

/**
 * $FF75 — trois bits qui se souviennent, cinq qui n'existent pas.
 *
 * `unused_hwio-C` l'arbitre nommément : écrire 0x00 et relire doit rendre
 * 0b1000_1111. Personne ne sait à quoi sert ce registre ; ce qu'on sait, c'est
 * la forme exacte de sa relecture, et c'est tout ce qu'on émule.
 */
class MaskedRegister extends Register(8) {
    getValue() {
        return 0x8F | (super.getValue() & 0x70);
    }

    setValue(value) {
        super.setValue(value & 0x70);
    }
}

/**
 * PCM12 / PCM34 ($FF76-$FF77) — une FENÊTRE SUR L'APU, pas un registre.
 *
 * Ces deux-là ont longtemps été rangés parmi les indocumentés, et ils ne le sont
 * plus : ils rendent la sortie NUMÉRIQUE des quatre voies, celle d'avant le
 * mélangeur et les faders — un quartet par voie, la voie impaire en bas. Rien
 * n'est stocké : on lit l'APU à l'instant où le CPU demande. Écrire n'a aucun
 * effet, il n'y a pas de case derrière.
 */
function pcmRegister(machine, odd, even) {
    return {
        getValue() {
            const cycle = machine.totalCycles;
            const low = machine.apu[odd].amplitude(cycle) & 0x0F;
            const high = machine.apu[even].amplitude(cycle) & 0x0F;
            return (high << 4) | low;
        },
        setValue() {},
    };
}

/**
 * LE SYSTÈME CGB — ce qui reste du CGB une fois le PPU servi.
 *
 * Le PPU déclare déjà les registres qui le concernent (VBK, les palettes, OPRI,
 * HDMA) et `MemoryBuilder` les lui route. Ceux d'ici ne sont pas du dessin : les
 * six indocumentés, et SVBK avec les banques de WRAM qui vont avec. Ils ont donc
 * leur propre propriétaire, bâti sur le même modèle — il DÉCLARE une table,
 * la mémoire route ce qui est déclaré. La carte mémoire reste unique : il n'y a
 * toujours pas de « si CGB » dedans, seulement des propriétaires présents ou
 * absents.
 */
export default function(machine) {
    class CgbSystem {
        constructor() {
            this.SVBK = new SVBKRegister();
            // La banque 1 reste dans la mémoire plate, là où elle a toujours été :
            // tout le reste de l'émulateur continue de lire 0xD000 sans rien
            // savoir de cette histoire. Même geste qu'au lot 2 pour la VRAM.
            this._banks = Array.from(
                { length: WRAM_BANKS },
                (_, bank) => (bank <= 1 ? null : new Uint8Array(WRAM_BANK_SIZE)),
            );
            this.FF72 = new (Register(8));
            this.FF73 = new (Register(8));
            this.FF74 = new (Register(8));
            this.FF75 = new MaskedRegister();
            this._registersMapping = null;
        }

        buildRegistersMapping() {
            return {
                0xFF70: this.SVBK,
                0xFF72: this.FF72,
                0xFF73: this.FF73,
                0xFF74: this.FF74,
                0xFF75: this.FF75,
                0xFF76: pcmRegister(machine, 'channel1', 'channel2'),
                0xFF77: pcmRegister(machine, 'channel3', 'channel4'),
            };
        }

        /** Bâtie à la première demande et gardée, comme celle du PPU. */
        get registersMapping() {
            if (!this._registersMapping) {
                this._registersMapping = this.buildRegistersMapping();
            }
            return this._registersMapping;
        }

        read(addr) {
            return this.registersMapping[addr].getValue();
        }

        write(addr, value) {
            return this.registersMapping[addr].setValue(value);
        }

        get wramBank() {
            return this.SVBK.bank;
        }

        wramRead(addr) {
            const bank = this._banks[this.wramBank];
            if (!bank) return machine.memory._read(addr);
            return bank[addr - WRAM_BANKED_START];
        }

        wramWrite(addr, value) {
            const bank = this._banks[this.wramBank];
            if (!bank) return machine.memory._write(addr, value);
            bank[addr - WRAM_BANKED_START] = value;
        }
    }

    return CgbSystem;
}
