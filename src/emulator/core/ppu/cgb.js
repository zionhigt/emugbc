import { Register } from "../../lib/register";
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
        }

        buildRegistersMapping() {
            return {
                ...super.buildRegistersMapping(),
                0xFF4F: this.VBK,
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
    }

    return CGBPPU;
}

export { Fetcher };
