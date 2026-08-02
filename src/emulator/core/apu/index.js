import byte from "../../lib/byte";
import { Register } from "../../lib/register";

import channel1 from "./channel1";
import channel2 from "./channel2";
import channel3 from "./channel3";
import channel4 from "./channel4";
import Nr52 from "./nr52";


export default function(machine) {
    class APU {
        constructor() {
            this.machine = machine;
            this.channel1 = channel1(this);
            this.channel2 = channel2(this);
            this.channel3 = channel3(this);
            this.channel4 = channel4(this);
            this._isPowered = true;
            this.nr52 = Nr52(this);
            this.nr50 = new (Register(8));
            this.nr51 = new (Register(8));

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
                0xFF24: this.nr50,
                0xFF25: this.nr51,
                0xFF26: this.nr52,
                ...this.channel1.registers,
                ...this.channel2.registers,
                ...this.channel3.registers,
                ...this.channel4.registers,
            }
        }
        get maskRegistersMapping() {
            return {
                0xFF10: 0x80,
                0xFF11: 0x3F,
                0xFF13: 0xFF,
                0xFF14: 0xBF,
                0xFF16: 0x3F,
                0xFF18: 0xFF,
                0xFF19: 0xBF,
                0xFF1A: 0x7F,
                0xFF1B: 0xFF,
                0xFF1C: 0x9F,
                0xFF1D: 0xFF,
                0xFF1E: 0xBF,
                0xFF1F: 0xFF,
                0xFF20: 0xFF,
                0xFF23: 0xBF,
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