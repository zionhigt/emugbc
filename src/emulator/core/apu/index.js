import byte from "../../lib/byte";
import { Register } from "../../lib/register";

import channel2 from "./channel2";


export default function(machine) {
    class APU {
        constructor() {
            this.machine = machine;
            this.channel2 = channel2();
        }
        
        get bus() {
            return this.machine.memory;
        }
        get totalMachineCycles() {
            return this.machine.totalCycles;
        }

        get registersMapping() {
            return {
                ...this.channel2.registers,
            }
        }

        check() {
            return;
        }

        read (addr) {
            const reg = this.registersMapping[addr];
            if (!reg) {
                return this.bus._read(addr);
            }
            return reg.getValue();
        };

        write (addr, value) {
            const reg = this.registersMapping[addr];
            if (!reg) {
                return this.bus._write(addr, value);
            }
            return reg.setValue(value);
        };

    }

    return APU;
}