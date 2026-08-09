import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import buildCartridge from '../cartridge/Cartridge';
import { CGB } from '../models';

/**
 * AGE speed-switch — LES ORACLES DU JALON DOUBLE VITESSE, POSÉS AVANT LE PREMIER
 * LOT.
 *
 * Huit ROMs écrites pour la bascule de régime, et rien d'autre
 * (github.com/c-sp/age-test-roms, MIT — le LICENSE est déposé à côté d'elles).
 * Elles suivent le protocole mooneye, à une différence près qui compte :
 * **elles n'écrivent rien sur le port série**. Le verdict est dans les REGISTRES
 * du CPU à l'arrêt — la suite de Fibonacci si le test réussit. On les lit donc
 * directement, après avoir laissé tourner assez longtemps.
 *
 * CE FICHIER EST UN TABLEAU DE BORD, pas une suite de tests qui doit être verte.
 * Chaque lot du cahier fait basculer une ligne de `ATTENDU` de `false` à `true`,
 * et une ligne qui retomberait à `false` est une régression nommée. C'est la
 * règle d'oracle du cahier CGB (§3), appliquée dès l'ouverture cette fois :
 * l'oracle est là AVANT le code, et il mesure au lieu de juger à la fin.
 *
 * État de départ, mesuré avant d'écrire une ligne du jalon : les huit échouent
 * identiquement, PC figé à 0x12D0 — la signature d'un `STOP` qui n'a rien fait.
 */

const FIXTURES = resolve(process.cwd(), 'src/test/fixtures/age/speed-switch');
const FIBONACCI = [3, 5, 8, 13, 21, 34];

// De quoi laisser une bascule et ses 2050 cycles d'arrêt se dérouler largement.
const FRAMES = 60;

/**
 * `false` = échoue aujourd'hui, et c'est ATTENDU tant que son lot n'est pas fait.
 * Le lot qui la vise est en commentaire ; le faire passe la ligne à `true`.
 */
const ATTENDU = [
  ['spsw-stop-prefetch-cgbBCE.gb', false], // lot 1 — ce que STOP avale
  ['spsw-mode0-cgbBCE.gb', false],         // lot 2 — les modes du PPU
  ['spsw-div-cgbBCE.gb', true],            // lot 3 — DIV
  ['spsw-tima-cgbBC.gb', false],           // lot 3 — TIMA, révision B/C
  ['spsw-tima-cgbE.gb', false],            // lot 3 — TIMA, révision E
  ['spsw-ch2-lc-delay-cgbBCE.gb', false],  // lot 4 — le compteur de longueur
  ['spsw-interrupts-cgbBC.gb', false],     // lot 5 — les IRQ pendant l'arrêt
  ['spsw-interrupts-cgbE.gb', false],      // lot 5 — idem, révision E
];

const Cartridge = buildCartridge();
const instructions = buildInstructions();

const rom = (name) => resolve(FIXTURES, name);

const runRom = (name) => {
  const cbs = [];
  const clock = {
    onTick(cb) { cbs.push(cb); },
    start() {}, stop() {},
    tick() { cbs.forEach((cb) => cb({ detail: 'tick' })); },
  };
  const serial = { output: [], read() {}, write() {}, echo() {} };
  const memory = buildMemory(undefined, serial);
  const cpu = new CPU(memory);
  const Decoder = buildDecoder(cpu, instructions);
  const Machine = buildMachine(memory, cpu, new Decoder(), clock, serial);
  const machine = new Machine(CGB);
  machine.plugCartridge(new Cartridge(new Uint8Array(readFileSync(rom(name)))));
  for (let i = 0; i < FRAMES; i++) clock.tick();

  const registers = ['B', 'C', 'D', 'E', 'H', 'L'].map((r) => cpu.registers[r].getValue());
  return { registers, pc: cpu.registers.PC.getValue() };
};

describe.skipIf(!existsSync(FIXTURES))('AGE speed-switch : le tableau de bord du jalon', () => {
  it.each(ATTENDU)('%s', (name, attendu) => {
    const { registers, pc } = runRom(name);
    const passe = FIBONACCI.every((v, i) => v === registers[i]);

    expect(
      passe,
      attendu
        ? `régression : registres [${registers}] au lieu de Fibonacci, PC=0x${pc.toString(16)}`
        : `elle passe maintenant — mettre sa ligne d'ATTENDU à true (PC=0x${pc.toString(16)})`,
    ).toBe(attendu);
  });
});
