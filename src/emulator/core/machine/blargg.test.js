import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import buildCartridge from '../cartridge/Cartridge';

// LE test. Celui vers lequel tout convergeait : la ROM de Blargg, écrite en
// 2010 pour certifier des CPU, insérée dans la machine et exécutée pour de
// vrai. Elle teste elle-même chaque LD r,r et écrit son verdict sur le port
// série. Si « Passed » sort, c'est Blargg qui le dit — pas nous.
const GOLD_ROM_PATH = resolve(process.cwd(), 'src/test/fixtures/06-ld r,r.gb');
const goldRomAvailable = existsSync(GOLD_ROM_PATH);

const Cartridge = buildCartridge();
const instructions = buildInstructions();

// La manivelle : le contrat clock vu par la machine, déclenché à la main.
const buildManivelle = () => {
  const cbs = [];
  return {
    onTick(cb) { cbs.push(cb); },
    start() {},
    stop() {},
    tick() { cbs.forEach((cb) => cb({ detail: 'tick' })); },
  };
};

// Le maître série : il n'a qu'une mission, retenir le dernier instantané
// du buffer (cumulatif) — le message complet à date.
const buildSerial = () => ({
  output: '',
  read() {},
  write() {},
  echo(buffer) { this.output = buffer; },
});

describe('Blargg cpu_instrs 06-ld r,r : le verdict', () => {
  it.skipIf(!goldRomAvailable)(
    'la ROM s\'exécute et écrit « Passed » sur le port série',
    () => {
      const serial = buildSerial();
      const clock = buildManivelle();
      const cpu = new CPU(buildMemory(undefined, serial));
      const Decoder = buildDecoder(cpu, instructions);
      const decoder = new Decoder();
      const Machine = buildMachine(cpu, decoder, clock, serial);
      const machine = new Machine();

      const bytes = new Uint8Array(readFileSync(GOLD_ROM_PATH));
      machine.plugCartridge(new Cartridge(bytes));

      // ~3000 trames = ~50 secondes de temps Game Boy : très au-delà du
      // besoin réel (quelques secondes). On sort dès que Blargg a parlé.
      const MAX_FRAMES = 3000;
      let frames = 0;
      while (frames < MAX_FRAMES && !/Passed|Failed/.test(serial.output)) {
        clock.tick();
        frames++;
      }

      expect(
        serial.output,
        `après ${frames} trames, la bande du magnétophone série dit ceci`,
      ).toContain('Passed');
    },
    60000,
  );
});
