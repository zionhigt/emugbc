import byte from "../../lib/byte.js";
import { Register, FlagRegister } from "../../lib/register.js";

class Extendedregister {
    constructor(highRegister, lowRegister) {
        this.highRegister = highRegister;
        this.lowRegister = highRegister;
    }

    getValue() {
        return byte.buildU16(
            this.highRegister.getValue(),
            this.lowRegister.getValue()
        )
    }

    setValue(value) {
        const { high, low } = byte.U16to2U8(value);
        this.highRegister.setValue(high);
        this.lowRegister.setValue(low);
    }
}

class CPURegister {
    constructor() {
        this.A = new Register(8);
        this.F = new Register(8);
        this.B = new Register(8);
        this.C = new Register(8);
        this.D = new Register(8);
        this.E = new Register(8);

        this._AF = new Register(16);
        this._BC = new Register(16);
        this._DE = new Register(16);

        this.SP = new Register(16);
        this.PC = new Register(16);

    }
}

export default class CPU {
    constructor() {

    }
}