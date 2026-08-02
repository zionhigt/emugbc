import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import buildCartridge from '../cartridge/Cartridge';

/**
 * L'ORACLE DE L'APU : blargg dmg_sound, 12 ROMs.
 *
 * Même protocole que cpu_instrs — la ROM s'auto-teste et écrit son verdict sur le port
 * série. Le dossier est balayé : déposer une ROM, c'est l'activer.
 *
 * Ce qu'elles arbitrent, et qu'aucun de nos tests unitaires ne peut trancher :
 *   02-len ctr        la phase exacte du frame sequencer, et l'extra length clocking
 *   03-trigger        la sémantique complète du trigger
 *   07-len sweep...   la synchronisation longueur/sweep sur le compteur de DIV
 *   08-len ctr...     la survie des compteurs de longueur à l'extinction (DMG)
 *   11-regs after...  l'état des registres après extinction
 *
 * Les ROMs qui portent sur des canaux non écrits (04, 05, 06 pour le sweep du canal 1 ;
 * 09, 10, 12 pour la wave du canal 3) échoueront tant que ces canaux n'existent pas.
 * C'est attendu : ce fichier est un tableau de bord, pas une exigence de tout-vert.
 */
const FIXTURES_DIR = resolve(process.cwd(), 'src/test/fixtures/dmg_sound');
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
  echo(buffer) { this.output = String.fromCharCode(...buffer); },
});

const runRom = (fileName, maxFrames = 3000) => {
  const serial = buildSerial();
  const clock = buildManivelle();
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

describe('Blargg dmg_sound : l\'oracle de l\'APU, ROM par ROM', () => {
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
