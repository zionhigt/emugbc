import byte from "../../lib/byte";
import { FlagRegister, Register } from "../../lib/register";

class BTNFlagRegister extends FlagRegister(8, 0x0F) {
    constructor() {
        super({
            "STR": { "offset": 3 }, // Start
            "SEL": { "offset": 2 }, // Select
            "B": { "offset": 1 }, // B
            "A": { "offset": 0 }, // A
        })
    }
}
class DIRFlagRegister extends FlagRegister(8, 0x0F) {
    constructor() {
        super({
            "DWN": { "offset": 3 }, // Down
            "UP": { "offset": 2 }, // Up
            "LFT": { "offset": 1 }, // Left
            "RIG": { "offset": 0 }, // Right
        })
    }
}
class SelectFlagRegister extends FlagRegister(8) {
    constructor() {
        super({
            "BTN": { "offset": 5 }, // button
            "DIR": { "offset": 4 }, // Direction
        })
    }
}
export default function() {
    const KEYS = ["right", "left", "up", "down", "a", "b", "select", "start"];
    class Joypad {
        constructor() {
            this.dir = new DIRFlagRegister();
            this.btn = new BTNFlagRegister();
            this.select = new SelectFlagRegister();
            this.select.setValue(0xF0);
            this.dir.setValue(0x0F);
            this.btn.setValue(0x0F);
        }

        _setKeyState(key, val) {
            const keyIndex = KEYS.indexOf(key);
            if (keyIndex === -1) return;
            let reg = Math.floor(keyIndex / 4) ? this.btn : this.dir;
            reg.setValue(
                byte.setBit(reg.getValue(), (keyIndex % 4), val)
            )
        }

        onPress(key) {
            this._setKeyState(key, 0);
        }

        onRelease(key) {
            this._setKeyState(key, 1);
        }

        get activeReg() {
            const isBtn = this.select.BTN === 0;
            const isDir = this.select.DIR === 0;
            if (isBtn && isDir) {
                const self = this;
                return {
                    getValue() {
                        return self.btn.getValue() & self.dir.getValue();
                    }
                }
            } else if (!isBtn && !isDir) {
                return {
                    getValue() { return 0x0F; }
                }
            } else {
                if (isBtn) return this.btn;
                return this.dir;
            }
        }

        /**
         * Les bits 6 et 7 de P1 n'existent pas et se lisent TOUJOURS à 1 —
         * `unused_hwio` l'arbitre nommément (`test P1 %11000000`). Ce n'est pas
         * cosmétique : un jeu qui lit P1 et compare l'octet entier au lieu de
         * masquer les quatre bits bas ne trouverait jamais son compte.
         */
        read (addr) {
            return 0xC0 | (this.select.getValue() & 0x30) | (this.activeReg.getValue() & 0x0F);
        };

        write (addr, value) {
            return this.select.setValue(value & 0x30);
        };
    }

    return Joypad
}