import { Register } from "../../lib/register";
import Channel from "./channel";


function ChanFactory(start, Parent) {
    const Registers = [
        class NR21 extends Register(8) {},
        class NR22 extends Register(8) {},
        class NR23 extends Register(8) {},
        class NR24 extends Register(8) {},
    ]
    class Chan extends Parent {
        addReg(offset) {
            this.registers[this.start + offset] = new Registers[offset % 4];
        }
    }

    return new Chan(start);
}

export default function() {
    return Channel(0xFF16, ChanFactory);
}