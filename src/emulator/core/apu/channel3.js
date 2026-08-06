import { Register } from "../../lib/register";
import byte from "../../lib/byte";
import { Channel, NRegister, NRegister1, NRegister4 } from "./channel";

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

class NR33 extends NRegister {
    setValue(val) {
        this.parent.captureWaveStep();
        return super.setValue(val);
    }
}
class NR34 extends NRegister4 {
    setValue(val) {
        this.parent.captureWaveStep();
        return super.setValue(val);
    }
}

const OFFSETS = [4, 0, 1, 2];

export default function(apu) {
    function ChanFactory(start, Parent) {
        class Chan extends Parent {
            constructor() {
                super(...arguments);
                this._maxLength = 256;
                this._lastWaveStep = 0;
                this._lastWaveAt = 0;
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

            waveByteIndexAt(cycle) {
                return Math.floor(this.waveStep(cycle) / 2);
            }

            /**
             * Le canal ne touche la RAM qu'en changeant d'OCTET, soit un échantillon sur
             * deux : toutes les `period` cycles machine depuis le trigger.
             */
            isAccessingWaveAt(cycle) {
                if (!this.isEnabledAt(cycle)) return false;
                return (cycle - this.triggeredAt) % this.period === 0;
            }

            waveStep(cycle) {
                return (this._lastWaveStep + Math.floor(
                    2 * (cycle - this._lastWaveAt) / this.period
                )) % 32
            }

            waveSample(cycle) {
                const position = this.waveStep(cycle);
                // Lecture directe : passer par apu.read ferait retomber le canal sur sa
                // propre porte, et il se lirait 0xFF dès qu'il n'est pas dans sa fenêtre.
                const octet = this.apu._WaveRAM[0xFF30 + this.waveByteIndexAt(cycle)].getValue();
                return position % 2 === 0 ? octet >> 4 : octet & 0x0F;
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
                } else if (offset === 3) {
                    this.registers[this.start + offset] = new NR33(this);
                } else if (offset === 4) {
                    this.registers[this.start + offset] = new NR34(this);
                } else {
                    super.addReg(offset);
                }
            }

            captureWaveStep() {
                const now = this.apu.totalMachineCycles;
                this._lastWaveStep = this.waveStep(now);
                this._lastWaveAt = now;
            };

            onTrigger() {
                this._lastWaveStep = 0;
                this._lastWaveAt = this.apu.totalMachineCycles;
            }
        }
    
        return new Chan(apu, start);
    }
    return Channel(0xFF1A, ChanFactory);
}