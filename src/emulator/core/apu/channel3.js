import { Register } from "../../lib/register";
import byte from "../../lib/byte";
import { Channel, NRegister, NRegister1 } from "./channel";

class NR30 extends NRegister {
    setValue(val) {
        super.setValue(val);
        if (!this.parent.isDacOn) this.parent._isEnabled = false;
    }
}
class NR31 extends NRegister1 {
    lengthRemaining(val) {
        return this.parent._maxLength - val;
    }
}

const OFFSETS = [4, 0, 1, 2];

export default function(apu) {
    function ChanFactory(start, Parent) {
        class Chan extends Parent {
            constructor() {
                super(...arguments);
                this._maxLength = 256;
            }
            get DAC() {
                return byte.getBit(this.NR0.getValue(), 7);
            }

            get volume() {
                return this.NR2.getValue();
            }

            get outputLevel() {
                return (this.NR2.getValue() >> 5) & 0x03;
            }

            waveStep(cycle) {
                return Math.floor(
                    2 * (cycle - this.triggeredAt) / this.period
                ) % 32
            }

            waveSample(cycle) {
                const position = this.waveStep(cycle);
                const addr = 0xFF30 + Math.floor(position / 2);
                let o = this.apu.read(addr);
                if (position % 2 === 0) {
                    o >>= 4;
                } else {
                    o &= 0x0F;
                }
                return o;
            }

            amplitude(cycle) {
                if (!this.isDacOn || !this.isEnabledAt(cycle)) return 0;
                const sample = this.waveSample(cycle);
                return sample >> OFFSETS[this.outputLevel];
            }

            addReg(offset) {
                if (offset === 0) {
                    this.registers[this.start] = new NR30(this);
                } else if (offset === 1) {
                    this.registers[this.start + offset] = new NR31(this);
                } else {
                    super.addReg(offset);
                }
            }
        }
    
        return new Chan(apu, start);
    }
    return Channel(0xFF1A, ChanFactory);
}