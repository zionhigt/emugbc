import byte from "../../lib/byte.js"
import opecodes from "../cpu/opcodes.js"

export default function(cpu, instructions) {
    class Decoder {
        constructor() {
            this.cpu = cpu;
        }

        get memory() {
            return this.cpu.memory;
        }

        fetch() {
            const value = this.memory.read(cpu.registers.PC.getValue());
            cpu.registers.PC.increment();
            return value;
        }
        step() {
            let main = opecodes.main;
            let currentbyte = this.fetch();
            if (currentbyte === 0xCB) {
                main = opecodes.cb;
                currentbyte = this.fetch();
            }
            if (!main[currentbyte]) throw new Error("Unknown opecodes");
            const [id, ..._args] = main[currentbyte];
            const args = [];
            for (let arg of _args) {
                if (["n8", "a8", "e8"].includes(arg)) {
                    args.push(this.fetch());
                } else if(arg === "n16") {
                    const low = this.fetch();
                    const high = this.fetch();
                    args.push(
                        byte.buildU16(
                            high,
                            low,
                        )
                    )
                } else if (typeof arg === "string" && arg.startsWith("cc:")) {
                    args.push(arg.slice(3, arg.length));
                } else if(typeof arg === "number") {
                    args.push(arg);
                } else {
                    args.push(cpu.registers[arg]);
                }
            }

            instructions[id].run(cpu, ...args);
            const cycles = cpu.cycles;
            cpu.resetCycles();
            return cycles;
        }
    }

    return Decoder;
}