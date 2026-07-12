import { Register } from "../../lib/register";

class LYregister extends Register(8) {
    
    constructor(parent) {
        super();
        this.parent = parent;
    }

    getValue() {
        const value = Math.floor(this.parent.totalMachineCycles / 114) % 154;
        return value;
    }
}

export default function(machine) {
    class PPU {
        constructor() {
            this.machine = machine;
            this._innerCycles = this.totalMachineCycles; // Almost a bad boy. Whatcha gonna do !!
            this.LY = new LYregister(this);
            this.LCDC = new (Register(8));
            this.STAT = new (Register(8));
            this.SCY = new (Register(8));
            this.SCX = new (Register(8));
            this.LYC = new (Register(8));
            this.DMA = new (Register(8));
            this.BGP = new (Register(8));
            this.OBP0 = new (Register(8));
            this.OBP1 = new (Register(8));
            this.WY = new (Register(8));
            this.WX = new (Register(8));

            this.dateAlarme = 16416;
        }

        get innerCycles() {
            return this.totalMachineCycles - this._innerCycles;
        }
        
        get totalMachineCycles() {
            return this.machine.totalCycles;
        }

        get registersMapping() {
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
            }
        }

        check() {
            while (this.totalMachineCycles >= this.dateAlarme) {
                this.machine.IF |= 0b00001;
                this.dateAlarme += 17556;
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