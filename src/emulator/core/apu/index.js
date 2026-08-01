import byte from "../../lib/byte";
import { Register } from "../../lib/register";

import channel2 from "./channel2";


export default function(machine) {
    class APU {
        constructor() {
            this.machine = machine;
            this.channel2 = channel2(this);
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

        frameTicks(cycle) {
            return Math.floor(this.machine.timer.innerCyclesAt(cycle) / 8192); // 8192 = 2 ^ (12 + 1) : Effondrement du bit 12
        }

        frameStep(cycle) {
            return this.frameTicks(cycle) % 8;
        }

        lengthTicks(cycle) {
            return Math.floor(this.frameTicks(cycle) / 2);
        }
        
        sweepTicks(cycle) {
            const v = this.frameTicks(cycle) + 2; 
            return Math.floor(v / 4);
        }

        envelopeTicks(cycle) {
            const v = this.frameTicks(cycle) + 1; 
            return Math.floor(v / 8);
        }
    }

    return APU;
}