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
 * MOONEYE — acceptance/timer.
 *
 * La suite de gekkio, écrite pour épingler le comportement du timer au T-cycle près.
 * C'est l'oracle matériel du chapitre qu'on vient de terminer, et le seul capable de
 * trancher le `DIVERGE` restant (écriture dans TIMA pile sur le cycle de recharge).
 *
 * PROTOCOLE (README amont) : le test écrit son verdict sur le port série.
 *   - réussite : les nombres de Fibonacci 3, 5, 8, 13, 21, 34
 *   - échec    : six fois l'octet 0x42
 * Puis il exécute `LD B, B` et boucle sur lui-même. On n'a donc besoin ni de la
 * balise `ld b,b` ni des registres : la bande série suffit, exactement comme Blargg.
 *
 * Le buffer série est une CHAÎNE (String.fromCharCode), et les octets de Fibonacci ne
 * sont pas imprimables — on compare donc des codes de caractères. Un échec, lui, se
 * lit en clair : 0x42 est le « B » majuscule, la bande dit « BBBBBB ».
 */

const FIXTURES_DIR = resolve(
  process.cwd(),
  'src/test/fixtures/mooneye/build/acceptance/timer',
);
const roms = existsSync(FIXTURES_DIR)
  ? readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.gb')).sort()
  : [];

// Le verdict, en octets.
const REUSSITE = [3, 5, 8, 13, 21, 34];
const VERDICT_LONGUEUR = REUSSITE.length;

// Le maître reçoit des octets. Pour l'affichage d'un échec on les relit en ASCII :
// 0x42 est le « B » majuscule, donc une bande ratée se lit « BBBBBB ».
const enTexte = (octets) => String.fromCharCode(...octets);

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
  output: [],
  read() {},
  write() {},
  echo(buffer) { this.output = buffer; },
});

// Insère la ROM, tourne la manivelle jusqu'au verdict (6 octets) ou au plafond.
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
  while (frames < maxFrames && serial.output.length < VERDICT_LONGUEUR) {
    clock.tick();
    frames++;
  }
  return { verdict: serial.output, brut: enTexte(serial.output), frames };
};

describe('Mooneye acceptance/timer : l\'oracle matériel du chapitre timer', () => {
  it.skipIf(roms.length === 0).each(roms)(
    '%s envoie Fibonacci sur le port série',
    (fileName) => {
      const { verdict, brut, frames } = runRom(fileName);
      expect(
        verdict,
        verdict.length === 0
          ? `rien reçu après ${frames} trames : la ROM n'a jamais rendu son verdict`
          : `bande série après ${frames} trames : [${verdict}] («${brut}» — six 0x42, soit « BBBBBB », signifie ÉCHEC)`,
      ).toEqual(REUSSITE);
    },
    60000,
  );
});
