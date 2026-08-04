import byte from "../../lib/byte";
import { Register } from "../../lib/register";

import channel1 from "./channel1";
import channel2 from "./channel2";
import channel3 from "./channel3";
import channel4 from "./channel4";
import Nr52 from "./nr52";

const FRAME_PERIOD = 8192; // 8192 = 2 ^ (12 + 1) : Effondrement du bit 12 de DIV
const LENGTH_STEPS = [0, 2, 4, 6];
const LENGTH_ADDRESSES = [0xFF11, 0xFF16, 0xFF1B, 0xFF20]
const SWEEP_STEPS = [2, 6];
const ENVELOPE_STEPS = [7];

const executedSteps = (ticks, steps) => {
    const rounds = Math.floor(ticks / 8);
    const rest = ticks % 8;
    const inLastRound = steps.filter((step) => step < rest).length;
    return rounds * steps.length + inLastRound;
};

class NilRegister extends Register(8) {
    setValue(value) {};
    getValue() {
        return 0xFF;
    }
}

export default function(machine) {
    class APU {
        constructor() {
            this.machine = machine;
            this.channel1 = channel1(this);
            this.channel2 = channel2(this);
            this.channel3 = channel3(this);
            this.channel4 = channel4(this);
            this._isPowered = true;
            this._frameOrigin = 0;
            this.nr52 = Nr52(this);
            this.nr50 = new (Register(8));
            this.nr51 = new (Register(8));

            this._nilRegisters = {};
            for (let i = 0xFF27; i <= 0xFF2F; i++) {
                this._nilRegisters[i] = new NilRegister();
            }
            this._WaveRAM = {};
            for (let i = 0xFF30; i <= 0xFF3F; i++) {
                this._WaveRAM[i] = new (Register(8));
            }

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
                ...this._nilRegisters,
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

        powerOn() {
            this._frameOrigin = this.divTicks(this.totalMachineCycles);
        }

        check() {
            return;
        }

        read (addr) {
            let reg = this._WaveRAM[addr];
            if (!reg) {
                reg = this.registersMapping[addr];
            }
            if (!reg) {
                return this.bus._read(addr);
            }
            const mask = this.maskRegistersMapping?.[addr] || 0;
            return reg.getValue() | mask;
        };

        write (addr, value) {
            let reg = this._WaveRAM[addr];
            if (!reg) {
                if (!this.isPowered && addr !== 0xFF26) {
                    if (!LENGTH_ADDRESSES.includes(addr)) return;
                    return this.registersMapping[addr].setLength(value);
                }
                reg = this.registersMapping[addr];
            }
            if (!reg) {
                return this.bus._write(addr, value);
            }
            return reg.setValue(value);
        };

        divTicks(cycle) {
            return Math.floor(this.machine.timer.innerCyclesAt(cycle) / FRAME_PERIOD);
        }

        frameTicks(cycle) {
            return this.divTicks(cycle) - this._frameOrigin;
        }

        frameStep(cycle) {
            return this.frameTicks(cycle) % 8;
        }

        nextStepClocksLength(cycle) {
            return LENGTH_STEPS.includes(this.frameStep(cycle));
        }

        lengthTicks(cycle) {
            return executedSteps(this.frameTicks(cycle), LENGTH_STEPS);
        }
        
        sweepTicks(cycle) {
            return executedSteps(this.frameTicks(cycle), SWEEP_STEPS);
        }

        envelopeTicks(cycle) {
            return executedSteps(this.frameTicks(cycle), ENVELOPE_STEPS);
        }
    }

    return APU;
}