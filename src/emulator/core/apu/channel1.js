import { Register } from "../../lib/register";
import byte from "../../lib/byte";
import { Channel, NRegister, NRegister4 } from "./channel";

class NR10 extends NRegister { }
class NR14 extends NRegister4 {
    write(value) {
        this._buffer[0] = value;
    }
}

export default function(apu) {
    function ChanFactory(start, Parent) {
        class Chan extends Parent {
            constructor() {
                super(...arguments);
                this._sweepFrequency = 0;
                this._sweptTicks  = 0;
                this._sweepTimer = 0;
                this._isSweepArmed = false;
            }

            get sweepTimerPeriod() {
                return this.sweepPace === 0 ? 8 : this.sweepPace;
            }

            get sweepPace() {
                return (this.NR0.getValue() & 0x70) >> 4;
            }

            get sweepShift() {
                return (this.NR0.getValue() & 0x07);
            }

            get isSweepDown() {
                return byte.getFlag(this.NR0.getValue(), 3);
            }

            addReg(offset) {
                if (offset === 0) {
                    this.registers[this.start] = new NR10(this);
                } else if (offset === 4) {
                    this.registers[this.start + offset] = new NR14(this);
                } else {
                    super.addReg(offset);
                }
            }

            isEnabledAt(cycle) {
                this.frequencyAt(cycle);
                return super.isEnabledAt(cycle);
            }

            setFrequency(val) {
                this.NR3.setValue(val & 0xFF);
                const high = (this.NR4.getValue() & 0xF8) | ((val >> 8) & 0x07)
                this.NR4.write(high);
            }

            frequencyAt(cycle) {
                if (this.apu.sweepTicks(cycle) < this._sweptTicks) {
                    console.warn("Special case");
                    return;
                } 0xF8
                if (!this._isSweepArmed || !super.isEnabledAt(cycle)) {
                    this._sweptTicks = this.apu.sweepTicks(cycle);
                    return this._sweepFrequency;
                }
                const target = this.apu.sweepTicks(cycle);
                while (this._sweptTicks < target) {
                    this._sweptTicks += 1;
                    this._sweepTimer -= 1;
                    if (this._sweepTimer === 0) {
                        this._sweepTimer = this.sweepTimerPeriod;
                        if (this.sweepPace !== 0) {
                            let n = this.computeN();
                            if (n > 2047) {
                                this._isEnabled = false;
                            } else if(this.sweepShift !== 0) {
                                this._sweepFrequency = n;
                                this.setFrequency(n);
                                n = this.computeN();
                                if (n > 2047) {
                                    this._isEnabled  = false;
                                }
                            }
                        }
                    }
                }
                return this._sweepFrequency;
            }

            computeN() {
                const delta = this._sweepFrequency >> this.sweepShift;
                const n = this.isSweepDown ? this._sweepFrequency - delta : this._sweepFrequency + delta;
                return n;
            }

            onTrigger() {
                this._sweepFrequency = this.frequency;
                this._sweptTicks  = this.apu.sweepTicks(this.apu.totalMachineCycles);
                this._sweepTimer = this.sweepTimerPeriod;
                this._isSweepArmed = this.sweepPace !== 0 || this.sweepShift !== 0;
                if (this.sweepShift !== 0) {
                    const n = this.computeN();
                    if (n > 2047) this._isEnabled = false;
                }
            }
        }
    
        return new Chan(apu, start);
    }
    return Channel(0xFF10, ChanFactory);
}