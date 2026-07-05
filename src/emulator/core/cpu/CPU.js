import byte from "../../lib/byte.js";
import { Register, FlagRegister, Extendedregister } from "../../lib/register.js";

class CPUFlagRegister extends FlagRegister(8) {
    constructor() {
        super({
            "C": { "offset": 4 },
            "H": { "offset": 5 },
            "N": { "offset": 6 },
            "Z": { "offset": 7 },
        })
    }
}
class CPURegister {
    constructor() {
        this.A = new (Register(8));
        this.F = new CPUFlagRegister(8);
        this.B = new (Register(8));
        this.C = new (Register(8));
        this.D = new (Register(8));
        this.E = new (Register(8));
        this.H = new (Register(8));
        this.L = new (Register(8));

        this.AF = new Extendedregister(this.A, this.F);
        this.BC = new Extendedregister(this.B, this.C);
        this.DE = new Extendedregister(this.D, this.E);
        this.HL = new Extendedregister(this.H, this.L);

        this.SP = new (Register(16));
        this.PC = new (Register(16));

    }
}

export default class CPU {
    constructor(memory) {
        this.registers = new CPURegister();
        this.memory = memory;
    }

    updateZeroFlag(value) {
        this.registers.F.Z = +(value === 0);
        return this;
    }

    updateCarryFlag(operation) {
        const { raw, size, ...__ } = operation;
        const highLimit = 2 ** size - 1;
        this.registers.F.C = +(raw < 0 || raw > highLimit);
        return this;

    }

    updateNFlag(operation) {
        this.registers.F.N = operation.id;
        return this;
    }

    updateHFlag(operation, carry=0) {
        const { id, a, b, size} = operation;
        const border = size === 8 ? 0xf : 0xfff;
        const aNible = a & border;
        const bNible = b & border;
        if (id === 0) {
            this.registers.F.H = +((aNible + bNible + carry) > border);
        } else {
            this.registers.F.H = +(aNible < (bNible + carry));
        }
        return this;
    }

    updateNAndHFlags(operation, carry) {
        this.updateNFlag(operation);
        this.updateHFlag(operation, carry);
        return this;

    }
}