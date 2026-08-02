import byte from "../../lib/byte";
import { Register } from "../../lib/register";

import channel2 from "./channel2";
import Nr52 from "./nr52";


export default function(machine) {
    class APU {
        constructor() {
            this.machine = machine;
            this.channel2 = channel2(this);
            this._isPowered = true;
            this.nr52 = Nr52(this);
            this.ff15 = new (Register(8));

        }

        get isPowered() {
            return this._isPowered;
        }
        
        get bus() {
            return this.machine.memory;
        }
        get totalMachineCycles() {
            return this.machine.totalCycles;
        }

        get registersMapping() {
            return {
                0xFF26: this.nr52,
                ...this.channel2.registers,
            }
        }
        get maskRegistersMapping() {
            return {
                0xFF16: 0x3F,
                0xFF18: 0xFF,
                0xFF19: 0xBF,
            }
        }

        check() {
            return;
        }

        read (addr) {
            const reg = this.registersMapping[addr];
            if (!reg) {
                return this.bus._read(addr);
            }
            const mask = this.maskRegistersMapping?.[addr] || 0;
            return reg.getValue() | mask;
        };

        write (addr, value) {
            if (!this.isPowered && addr !== 0xFF26) return;
            const reg = this.registersMapping[addr];
            if (!reg) {
                return this.bus._write(addr, value);
            }
            return reg.setValue(value);
        };

        frameTicks(cycle) {
            return Math.floor(this.machine.timer.innerCyclesAt(cycle) / 8192); // 8192 = 2 ^ (12 + 1) : Effondrement du bit 12
        }

        frameStep(cycle) {
            return this.frameTicks(cycle) % 8;
        }

        lengthTicks(cycle) {
            return Math.floor(this.frameTicks(cycle) / 2);
        }
        
        sweepTicks(cycle) {
            const v = this.frameTicks(cycle) + 2; 
            return Math.floor(v / 4);
        }

        envelopeTicks(cycle) {
            const v = this.frameTicks(cycle) + 1; 
            return Math.floor(v / 8);
        }
    }

    return APU;
}