import { Register } from "../../lib/register";

class DIVregister extends Register(8) {
    
    constructor(parent) {
        super();
        this.parent = parent;
    }

    getValue() {
        const cycles = this.parent.innerCycles;
        const value = Math.floor(cycles / 64);
        return value & 0xFF;
    }

    setValue(value) {
        this.parent._innerCycles = this.parent.totalMachineCycles;
        return super.setValue(0);
    }
}

class TIMAregister extends Register(8) {
    constructor(parent) {
        super();
        this.parent = parent;
    }

    getValue() {
        if (!this.parent.isTAC) return this.parent.base;
        const crans = Math.floor((this.parent.totalMachineCycles - this.parent.anchor) / this.parent.periode);
        return (this.parent.base + crans) & 0xFF;
    }

    setValue(value) {
        this.parent.base = value;
        super.setValue(value);
        this.parent._armer();
    }
}
class TACregister extends Register(8) {
    constructor(parent) {
        super();
        this.parent = parent;
    }

    setValue(value) {
        super.setValue(value);
        if (value & 0x4) {
            this.parent._armer();
        }
    }
}

export default function(machine) {
    class Timer {
        constructor() {
            this.machine = machine;
            this._innerCycles = this.totalMachineCycles; // Almost a bad boy. Whatcha gonna do !!
            this.DIV = new DIVregister(this);
            this.TIMA = new TIMAregister(this);
            this.TAC = new TACregister(this);
            this.TMA = new (Register(8));

            this.base = 0;
            this.anchor = this.totalMachineCycles;
            this.dateAlarme = Infinity;
        }

        get innerCycles() {
            return this.totalMachineCycles - this._innerCycles;
        }
        
        get totalMachineCycles() {
            return this.machine.totalCycles;
        }

        get registersMapping() {
            return {
                0xFF04: this.DIV,
                0xFF05: this.TIMA,
                0xFF06: this.TMA,
                0xFF07: this.TAC,
            }
        }

        get periode() {
            const mapping = {
                0b00: 256,
                0b01: 4,
                0b10: 16,
                0b11: 64,
            }
            return mapping[this.TAC.getValue() & 0b11];
        }

        get isTAC() {
            return (this.TAC.getValue() & 0x4) > 0;
        }

        _armer() {
            this.anchor = this.totalMachineCycles;
            this.dateAlarme = this.anchor + (0x100 - this.base) * this.periode;
        }

        check() {
            if (!this.isTAC) {
                this.dateAlarme = Infinity;
                return;
            }
            while (this.totalMachineCycles >= this.dateAlarme) {
                this.machine.IF = this.machine.IF | 0b00100;
                this.base = this.TMA.getValue();
                this.anchor = this.dateAlarme;
                this.dateAlarme = this.anchor + (0x100 - this.base) * this.periode;
            }
        }

        read (addr) {
            return this.registersMapping[addr].getValue();
        };

        write (addr, value) {
            return this.registersMapping[addr].setValue(value);
        };

    }

    return Timer;
}