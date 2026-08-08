import byte from "../../lib/byte";
import { Register } from "../../lib/register";

export default function(apu) {
    class NR52 extends Register(8) {
        constructor() {
            super();
            this.apu = apu;
        }

        setRegistersZero() {
            const registers = this.apu.registersMapping;
            for (let addr in registers) {
                const r = registers[addr];
                if (r === this) continue;
                if (r.reset) r.reset();
                else r.setValue(0);
            }
        }

        setValue(val) {
            const wasPowered = this.apu._isPowered;
            this.apu._isPowered = byte.getFlag(val, 7);
            if (!this.apu._isPowered) {
                this.setRegistersZero();
            } else if (!wasPowered) {
                this.apu.powerOn();
            }
        }

        getValue() {
            let value = +(this.apu._isPowered) * (2 ** 7) // 7 - bit
            value |= 0x70; // 6..4 - bit
            for (let i = 0; i < 4; i++) { // 3..0 - bit
                const arg = "channel" + (i + 1);
                value |= (+(this.apu?.[arg]?.isEnabled) * (2 ** i));

            }
            return value;
        }
    }

    return new NR52();

}