import { Register } from "../../lib/register";
import byte from "../../lib/byte";

const DUTY_PATTERNS = [
    [0, 0, 0, 0, 0, 0, 0, 1], // duty 0 - 12,5 %
    [1, 0, 0, 0, 0, 0, 0, 1], // duty 1 - 25 %
    [1, 0, 0, 0, 0, 1, 1, 1], // duty 2 - 50 %
    [0, 1, 1, 1, 1, 1, 1, 0], // duty 3 - 75 %
];

export class NRegister extends Register(8) {
    constructor(parent) {
        super();
        this.parent = parent;
    }
}

export class NRegister4 extends NRegister {
    setValue(val) {
        super.setValue(val);
        if (byte.getFlag(val, 7)) {
            const now = this.parent.apu.totalMachineCycles;
            let remain = this.parent.lengthRemaining(now);
            if (remain === 0) remain = 64;
            this.parent._lastLengthRemaining = remain;
            this.parent._triggeredAt = now;
            this.parent._lastLengthAt = now;
            this.parent._lastVolumeAt = now;
            this.parent._lastVolume = this.parent.initialVolume;
            this.parent._isEnabled = this.parent.isDacOn;
            this.parent.onTrigger();
        }
    }
}
export class NRegister2 extends NRegister {
    setValue(val) {
        super.setValue(val);
        if (!this.parent.isDacOn) this.parent._isEnabled = false;
    }
}
export class NRegister1 extends NRegister {
    setValue(val) {
        super.setValue(val);
        this.parent._lastLengthRemaining = 64 - (val & 0x3F);
        this.parent._lastLengthAt = this.parent.apu.totalMachineCycles;
        this.parent._lastVolume = this.parent.volume;
        this.parent._lastVolumeAt = this.parent.apu.totalMachineCycles;
    }
}
export class NRegister0 extends Register(8) {
    setValue(val) {
        return;
    }
    getValue() {
        return 0xFF;
    }
}

export function Channel(start, chanController) {
    const Registers = [
        NRegister0,
        NRegister1,
        NRegister2,
        NRegister,
        NRegister4,
    ]
    class Channel {
        constructor(apu, start) {
            this.apu = apu;
            this.start = start;
            this.registers = {};
            this._isEnabled = false;
            this._triggeredAt = null;
            this._lastLengthRemaining = 0;
            this._lastLengthAt = 0;
            this._lastVolume = 0;
            this._lastVolumeAt = 0;
        }

        get isLengthEnabled() {
            return byte.getFlag(this.NR4.getValue(), 6);
        }

        get isEnabled() {
            return this.isEnabledAt(this.apu.totalMachineCycles);
        }
        get triggeredAt() {
            return this._triggeredAt;
        }
        get NR0() {
            return this.registers[this.start + 0];
        }
        get NR1() {
            return this.registers[this.start + 1];
        }
        get NR2() {
            return this.registers[this.start + 2];
        }
        get NR3() {
            return this.registers[this.start + 3];
        }
        get NR4() {
            return this.registers[this.start + 4];
        }

        get DAC() {
            return (this.NR2.getValue() & 0xF8) >> 3;
        }

        get duty() {
            return (this.NR1.getValue() & 0xC0) >> 6;
        }

        get frequency() {
            const low = this.NR3.getValue();
            let high = (this.NR4.getValue() & 0x7) << 8;
            return (high | low) & 0x7FF;
        }

        get period() {
            return 2048 - this.frequency;
        }

        get isDacOn() {
            return this.DAC > 0;
        }

        get initialVolume() {
            return (this.NR2.getValue() & 0xF0) >> 4;
        }

        get volume() {
            return this.volumeAt(this.apu.totalMachineCycles);
        }

        get envelopePeriod() {
            return this.NR2.getValue() & 0x07;
        }

        get isEnvelopeIncreasing() {
            return byte.getFlag(this.NR2.getValue(), 3);
        }

        volumeAt(cycle) {
            if (this.envelopePeriod === 0) return this._lastVolume;
            const step = Math.floor(
                (this.apu.envelopeTicks(cycle) - this.apu.envelopeTicks(this._lastVolumeAt)) / this.envelopePeriod
            );
            const value = this.isEnvelopeIncreasing ? this._lastVolume + step : this._lastVolume - step;
            return Math.min(15, Math.max(value, 0));
        }

        isEnabledAt(cycle) {
            if (!this._isEnabled) return false;
            if (this.isLengthEnabled && this.lengthRemaining(cycle) === 0) return false;
            return true;
        }

        frequencyAt(cycle) {
            return 1024;
        }

        onTrigger() { }

        addReg(offset) {
            this.registers[this.start + offset] = new Registers[offset % 5](this);
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
            if (!this.isDacOn || !this.isEnabledAt(cycle)) return 0;
            return this.dutyOutput(cycle) * this.volumeAt(cycle);
        }

        lengthRemaining(cycle) {
            if (!this.isLengthEnabled) return this._lastLengthRemaining;
            const value = this._lastLengthRemaining - (this.apu.lengthTicks(cycle) - this.apu.lengthTicks(this._lastLengthAt));
            return Math.max(0, value);
        }

        register(addr) {
            return this.registers[addr] || { setValue() {}, getValue()  {} };
        }
    }
    const chan = chanController(start, Channel);
    for (let i = 0; i < 5; i++) {
        chan.addReg(i);
    }
    return chan;
}