import { Register } from "../../lib/register";
import byte from "../../lib/byte";
import { Channel, NRegister, NRegister1 } from "./channel";
import { faSearch } from "@fortawesome/free-solid-svg-icons";

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