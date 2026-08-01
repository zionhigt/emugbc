import { Register } from "../../lib/register";
import byte from "../../lib/byte";
import Channel from "./channel";

const DUTY_PATTERNS = [
    [0, 0, 0, 0, 0, 0, 0, 1], // duty 0 - 12,5 %
    [1, 0, 0, 0, 0, 0, 0, 1], // duty 1 - 25 %
    [1, 0, 0, 0, 0, 1, 1, 1], // duty 2 - 50 %
    [0, 1, 1, 1, 1, 1, 1, 0], // duty 3 - 75 %
];

class NRegister extends Register(8) {
    constructor(parent) {
        super();
        this.parent = parent;
    }
}

class NRegister24 extends NRegister {
    setValue(val) {
        super.setValue(val);
        if (byte.getFlag(val, 7)) {
            this.parent._triggeredAt = this.parent.apu.totalMachineCycles;
            this.parent._isEnabled = this.parent.isDacOn;
        }
    }
}
class NRegister22 extends NRegister {
    setValue(val) {
        super.setValue(val);
        if (!this.parent.isDacOn) this.parent._isEnabled = false;
    }
}

export default function(apu) {
    function ChanFactory(start, Parent) {
        const Registers = [
            class NR21 extends NRegister {},
            class NR22 extends NRegister22 {},
            class NR23 extends NRegister {},
            class NR24 extends NRegister24 {},
        ]
        class Chan extends Parent {
            constructor() {
                super(...arguments);
                this._isEnabled = false;
                this._triggeredAt = null;
            }

            get isEnabled() {
                return this._isEnabled;
            }
            get triggeredAt() {
                return this._triggeredAt;
            }
            get NR21() {
                return this.registers[this.start + 0];
            }
            get NR22() {
                return this.registers[this.start + 1];
            }
            get NR23() {
                return this.registers[this.start + 2];
            }
            get NR24() {
                return this.registers[this.start + 3];
            }

            get DAC() {
                return (this.NR22.getValue() & 0xF8) >> 3;
            }

            get duty() {
                return (this.NR21.getValue() & 0xC0) >> 6;
            }

            get frequency() {
                const low = this.NR23.getValue();
                let high = (this.NR24.getValue() & 0x7) << 8;
                return (high | low) & 0x7FF;
            }

            get period() {
                return 2048 - this.frequency;
            }

            get isDacOn() {
                return this.DAC > 0;
            }

            get initialVolume() {
                return (this.NR22.getValue() & 0xF0) >> 4;
            }

            get volume() {
                return this.initialVolume;
            }

            addReg(offset) {
                this.registers[this.start + offset] = new Registers[offset % 4](this);
            }

            dutyStep(cycle) {
                const q = Math.floor(cycle / this.period);
                return q % 8;
            }

            dutyOutput(cycle) {
                const step = this.dutyStep(cycle);
                return DUTY_PATTERNS[this.duty % 4][step];
            }

            amplitude(cycle) {
                if (!this.isDacOn || !this.isEnabled) return 0;
                return this.dutyOutput(cycle) * this.volume;
            }
        }
    
        return new Chan(apu, start);
    }
    return Channel(0xFF16, ChanFactory);
}