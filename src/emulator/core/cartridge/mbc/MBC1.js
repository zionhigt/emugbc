import { Register } from "../../../lib/register.js"

class RBNRegister extends Register(8) {
    setValue(value) {
        value &= 0x1f;
        return super.setValue(value);
    }
}

export default class MBC1 {
    constructor(rom) {
        this.rom = rom;
        this.RBN = new RBNRegister();
        this.RBN.setValue(1);
    }

    read(addr) {
        if (addr >= 0x4000) {
            addr = this.RBN.getValue() * 0x4000 + (addr - 0x4000);
        }
        return this.rom.read(addr);
    }

    write(addr, value) {
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            this.RBN.setValue(value);
            value = this.RBN.getValue();
            if (value === 0) {
                this.RBN.setValue(1);
            }
        }
    }
}