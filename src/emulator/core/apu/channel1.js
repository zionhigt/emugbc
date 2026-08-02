import { Register } from "../../lib/register";
import byte from "../../lib/byte";
import { Channel, NRegister } from "./channel";

class NR10 extends NRegister { }

export default function(apu) {
    function ChanFactory(start, Parent) {
        class Chan extends Parent {
            addReg(offset) {
                if (offset === 0) {
                    this.registers[this.start] = new NR10(this);
                } else {
                    super.addReg(offset);
                }
            }
        }
    
        return new Chan(apu, start);
    }
    return Channel(0xFF10, ChanFactory);
}