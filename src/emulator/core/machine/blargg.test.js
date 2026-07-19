import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import buildCartridge from '../cartridge/Cartridge';

// LA batterie. Les 11 ROMs cpu_instrs de Blargg (2010), le juge de paix de
// tout émulateur : chacune s'auto-teste et écrit son verdict sur le port
// série. Le test balaie le dossier : déposer une ROM, c'est l'activer.
const FIXTURES_DIR = resolve(process.cwd(), 'src/test/fixtures/individual');
const roms = existsSync(FIXTURES_DIR)
  ? readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.gb')).sort()
  : [];

const Cartridge = buildCartridge();
const instructions = buildInstructions();

const buildManivelle = () => {
  const cbs = [];
  return {
    onTick(cb) { cbs.push(cb); },
    start() {},
    stop() {},
    tick() { cbs.forEach((cb) => cb({ detail: 'tick' })); },
  };
};

const buildSerial = () => ({
  output: '',
  read() {},
  write() {},
  // Le bus transporte des OCTETS ; décider qu'ils sont de l'ASCII est le rôle du maître.
  echo(buffer) { this.output = String.fromCharCode(...buffer); },
});

// Insère la ROM, tourne la manivelle jusqu'au verdict (ou au plafond),
// rend la bande série complète.
const runRom = (fileName, maxFrames = 3000) => {
  const serial = buildSerial();
  const clock = buildManivelle();
  // Le bus NU : la machine le reçoit tel quel, le CPU en reçoit une vue qui facture.
  const memory = buildMemory(undefined, serial);
  const cpu = new CPU(memory);
  const Decoder = buildDecoder(cpu, instructions);
  const decoder = new Decoder();
  const Machine = buildMachine(memory, cpu, decoder, clock, serial);
  const machine = new Machine();

  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, fileName)));
  machine.plugCartridge(new Cartridge(bytes));

  let frames = 0;
  while (frames < maxFrames && !/Passed|Failed/.test(serial.output)) {
    clock.tick();
    frames++;
  }
  return { output: serial.output, frames };
};

describe('Blargg cpu_instrs : la batterie complète, ROM par ROM', () => {
  it.skipIf(roms.length === 0).each(roms)(
    '%s écrit « Passed » sur le port série',
    (fileName) => {
      const { output, frames } = runRom(fileName);
      expect(
        output,
        `après ${frames} trames, la bande série dit ceci`,
      ).toContain('Passed');
    },
    60000,
  );
});
