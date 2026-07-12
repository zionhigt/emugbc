import MemoryBuilder from "../memory/index.js";


const MACHINE_FREQUENCE = 1048576; // Hz
const MACHINE_FRAMES_PER_SECONDES = 59.7275;
const DEFAULT_BUDGET = Number.parseInt(MACHINE_FREQUENCE / MACHINE_FRAMES_PER_SECONDES);

export default function(cpu, decoder, clock, serial) {
    class Machine {
        constructor() {
            // Assume that, decoder.cpu == cpu
            this.cpu = cpu;
            this.decoder = decoder;
            this.clock = clock;

            this.clock.onTick(this.handleTick.bind(this));
        }

        start() {
            clock.start();
        }
        stop() {
            clock.stop();
        }

        handleTick(event) {
            let budget = DEFAULT_BUDGET;
            while (budget > 0) {
                budget -= this.decoder.step();
            }
        }

        plugCartridge(cartridge) {
            const newMemory = MemoryBuilder(cartridge, serial);
            this.cpu.initMemory(newMemory);
            cpu.postBoot();
        }
    }

    return Machine;
}