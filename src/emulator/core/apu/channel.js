import { Register } from "../../lib/register";


class Channel {
    constructor(apu, start) {
        this.apu = apu;
        this.start = start;
        this.registers = {};
    }

    addReg(offset) {
        this.registers[this.start + offset] = new (Register(8));
    }

    register(addr) {
        return this.registers[addr] || { setValue() {}, getValue()  {} };
    }
}
export default function(start, chanController) {
    const chan = chanController(start, Channel);
    for (let i = 0; i < 4; i++) {
        chan.addReg(i);
    }
    return chan;
}