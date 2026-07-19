import MemoryBuilder from "../memory/index.js";
import Timer from "../timer/index.js";
import PPU from "../ppu/index.js"
import Joypad from "../joypad/index.js"

const MACHINE_FREQUENCE = 1048576; // Hz
const MACHINE_FRAMES_PER_SECONDES = 59.7275;
const DEFAULT_BUDGET = Number.parseInt(MACHINE_FREQUENCE / MACHINE_FRAMES_PER_SECONDES);

export default function(cpu, decoder, clock, serial) {
    class Machine {
        constructor() {
            // Assume that, decoder.cpu == cpu
            this.cpu = cpu;
            this._memory = cpu.memory;
            this.decoder = decoder;
            this.clock = clock;
            this.interruptsAcc = 1;
            this.clock.onTick(this.handleTick.bind(this));
            this.totalCycles = 0;
            this._observersPostStep = [];
            this.ppu = new (PPU(this));
            this.joypad = new (Joypad())
            this.subscribePostStep(function() {
                this.ppu.check();
            }.bind(this));

            this._tickObservers = [];
        }

        get IE() {
            return this.memory.read(0xFFFF);
        }
        get IF() {
            return this.memory.read(0xFF0F);
        }
        set IE(value) {
            return this.memory.write(0xFFFF, value);
        }
        set IF(value) {
            return this.memory.write(0xFF0F, value);
        }

        get memory() {
            return this._memory;
        }

        start() {
            clock.start();
        }
        stop() {
            clock.stop();
        }

        /**
         * 
         * @param {*} byte 
         * @returns a byte like a 0x1 << n-first
         */
        getFisrtLowBit(byte) {
            return byte & -byte;
        }

        dispatch(isService=true) {
            /** choisir la source : le bit levé le plus bas gagne (VBlank bit 0 = priorité maximale, Joypad bit 4 = minimale) ;
                couper ime ;
                acquitter : éteindre ce bit-là dans IF (les autres continuent d'attendre) ;
                empiler PC, sauter au vecteur de la source — 0x40, 0x48, 0x50, 0x58, 0x60 (bit × 8 + 0x40 : des cousins de RST) ;
                facturer 5 cycles. */
            if (this.cpu.ime && this.IE & this.IF) {
                const source = this.getFisrtLowBit(this.IE & this.IF);
                const mask = 0xFF ^ source;
                this.cpu.di();
                this.IF = this.IF & mask;
                this.cpu.stack.push(this.cpu.registers.PC.getValue());
                const address = Math.log2(source) * 8 + 0x40;
                this.cpu.registers.PC.setValue(address);
                return 5;
            }
            return 0;
        }

        subscribePostStep(cb) {
            this._observersPostStep.push(cb);
        }

        postStep() {
            for (let o of this._observersPostStep) {
                o.call(null, this);
            }
            const isScheduled = this.cpu.imeScheduled;
            if (!isScheduled) {
                // this.interruptsAcc = 1;
                return;
            };
            switch (this.interruptsAcc) {
                case 0:
                    this.interruptsAcc = 1;
                    this.cpu.start();
                    break;
                case 1:
                    this.interruptsAcc = 0;
                    break;
            }
        }

        onTick(cb) {
            this._tickObservers.push(cb);
        }

        emitTick() {
            for (let o of this._tickObservers) {
                o.call(null, this);
            }
        }

        handleTick(event) {
            let budget = DEFAULT_BUDGET;
            while (budget > 0) {
                if (this.cpu.halted && (this.IE & this.IF) !== 0) {
                    cpu.wake();
                }
                let cost = this.dispatch();
                if (this.cpu.halted) {
                    cost += 1;
                } else {
                    cost += this.decoder.step();
                }
                budget -= cost;
                this.totalCycles += cost;
                this.postStep();
            }
            this.emitTick();

        }

        plugCartridge(cartridge) {
            const timer = new (Timer(this));
            this.subscribePostStep(function(machine) {
                timer.check();
            })
            const newMemory = MemoryBuilder(
                cartridge,
                serial,
                timer,
                this.ppu,
                this.joypad
            );
            this._memory = newMemory;
            this.cpu.initMemory(newMemory);
            cpu.postBoot();
        }
    }

    return Machine;
}