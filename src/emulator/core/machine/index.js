import MemoryBuilder from "../memory/index.js";
import Timer from "../timer/index.js";
import PPU, { Fetcher } from "../ppu/index.js"
import APU from "../apu/index.js"
import Joypad from "../joypad/index.js"

const MACHINE_FREQUENCE = 1048576; // Hz
const MACHINE_FRAMES_PER_SECONDES = 59.7275;
const DEFAULT_BUDGET = Number.parseInt(MACHINE_FREQUENCE / MACHINE_FRAMES_PER_SECONDES);

export default function(memory, cpu, decoder, clock, serial) {
    class Machine {
        constructor() {
            // Assume that, decoder.cpu == cpu
            this.cpu = cpu;
            this._memory = memory;
            this.decoder = decoder;
            this.clock = clock;
            this.interruptsAcc = 1;
            this.clock.onTick(this.handleTick.bind(this));
            this.totalCycles = 0;
            this._observersCyclesUpdate = [];
            // La FIFO de fond est injectée : c'est ici que se choisira celle du
            // CGB, sans que le PPU ait à connaître les deux.
            this.ppu = new (PPU(this))(Fetcher);
            this.apu = new (APU(this));
            this.joypad = new (Joypad())
            this.subscribeCycleUpdate(function() {
                this.ppu.check();
                this.apu.check();
            }.bind(this));

            this._tickObservers = [];

            this.cpu.onCyclesUpdate(this.cyclesUpdate.bind(this));

            this._timerTickCallback = this.onTimer.bind(this);
            this.initTimer();
        }

        cyclesUpdate(cpu, n) {
            if (n.type === "add") this.totalCycles += n.value;
            this.emitCyclesUpdate();
        }

        emitCyclesUpdate() {
            for (let o of this._observersCyclesUpdate) {
                o.call(null, this);
            }
        }

        get timer() {
            return this._timer;
        }

        get IE() {
            return this.memory._read(0xFFFF);
        }
        get IF() {
            return this.memory._read(0xFF0F);
        }
        set IE(value) {
            return this.memory._write(0xFFFF, value);
        }
        set IF(value) {
            return this.memory._write(0xFF0F, value);
        }

        get memory() {
            return this._memory;
        }

        onTimer(machine) {
            this.timer.check();
        }

        initTimer() {
            const timer = new (Timer(this));
            this._timer = timer;
            this.unsubscribeCycleUpdate(this._timerTickCallback);
            this.subscribeCycleUpdate(this._timerTickCallback);
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
                this.cpu.pay(2);
                this.cpu.stack.push(this.cpu.registers.PC.getValue());
                this.cpu.pay(1);
                const address = Math.log2(source) * 8 + 0x40;
                this.cpu.registers.PC.setValue(address);
            }
        }

        subscribeCycleUpdate(cb) {
            this._observersCyclesUpdate.push(cb);
        }

        unsubscribeCycleUpdate(cb) {
            this._observersCyclesUpdate = this._observersCyclesUpdate.filter(
                function(item) {
                    return item !== cb;
                }
            );
        }

        postStep() {
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
                const deltaCycles = this.totalCycles;
                this.dispatch();
                if (this.cpu.halted) {
                    cpu.pay(1);
                } else {
                    this.decoder.step();
                }
                budget -= (this.totalCycles - deltaCycles);
                this.postStep();
            }
            this.emitTick();

        }

        plugCartridge(cartridge) {
            this.initTimer();
            const timer = this.timer;
            const newMemory = MemoryBuilder(
                cartridge,
                serial,
                timer,
                this.ppu,
                this.joypad,
                this.apu
            );
            this._memory = newMemory;
            this.cpu.initMemory(newMemory);
            cpu.postBoot();
        }
    }

    return Machine;
}