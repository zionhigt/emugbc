import MemoryBuilder from "../memory/index.js";

export default function(cpu, decodeur, clock) {
    class Machine {
        constructor() {
            this.cpu = cpu;
            this.decodeur = decodeur;
            this.clock = clock;
        }

        plugCartridge(cartridge) {
            const newMemory = MemoryBuilder(cartridge);
            this.cpu.initMemory(newMemory);
        }
    }
}