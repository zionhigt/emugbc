import CPU from "./cpu/CPU.js";
import instructions from "./cpu/instructions.js";
import Machine from "./machine/index.js";
import Decoder from "./decodeur/index.js";
import MemoryBuilder from "./memory/index.js";
import Clock from "./clock/index.js";
import Serial from "./serial/index.js";
import Cartridge from "./cartridge/Cartridge.js";
import { DMG } from "./models.js";

/**
 * @param {object} [options]
 * @param {'dmg'|'cgb'|'auto'} [options.model] le modèle de CONSOLE voulu.
 *        'auto' suit la cartouche ; voir core/models.js.
 */
export function MachineBuilder({ model = DMG } = {}) {

    const SerialClass = Serial(console);
    const serial = new SerialClass();

    const memory = MemoryBuilder();
    const cpu = new CPU(memory);

    const DecoderClass = Decoder(cpu, instructions());
    const decoder = new DecoderClass();

    const ClockClass = Clock();
    const clock = new ClockClass(1000 / 59.7275);

    const MachineClass = Machine(
        memory, cpu, decoder, clock, serial
    )

    return new MachineClass(model);
}