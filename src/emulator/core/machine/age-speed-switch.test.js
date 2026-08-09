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
 * UNE ROM QUI ÉCHOUE DONNE UN TEST ROUGE. Point.
 *
 * Ce fichier a d'abord été écrit en « tableau de bord » : chaque ligne portait
 * son résultat ATTENDU, et l'assertion comparait `passe === attendu`. Une ROM
 * rouge donnait donc un test VERT tant que sa ligne disait `false`. L'intention
 * était de mesurer l'avancement sans faire rougir la suite — le résultat est
 * qu'on décrochait sept verts sur des oracles qui échouent, ce qui est
 * exactement le motif que ce dépôt refuse.
 *
 * La suite est donc ROUGE tant que les huit ne passent pas, et c'est la vérité :
 * le jalon a livré ce qu'il pouvait livrer, il n'a pas satisfait ses oracles. Ce
 * qu'ils mesurent encore est dit dans le message d'échec de chacun.
 */

const FIXTURES = resolve(process.cwd(), 'src/test/fixtures/age/speed-switch');
const FIBONACCI = [3, 5, 8, 13, 21, 34];

/**
 * CHAQUE BASCULE COÛTE PRESQUE UNE TRAME, et c'est ce qui a fixé ce nombre.
 *
 * L'arrêt qui suit un `STOP` armé vaut 32769 cycles processeur (voir
 * `STOP_PAUSE`), soit ~143 lignes d'écran. Ces ROMs enchaînent des dizaines de
 * bascules : `spsw-div` a besoin d'au moins 150 trames pour rendre son verdict,
 * mesuré. 300 laisse le double de marge.
 *
 * Le nombre a longtemps valu 60, du temps où l'arrêt était cru long de 2050
 * cycles. Il faisait alors passer `spsw-div` pour rouge alors qu'elle n'avait
 * simplement pas fini de tourner — un faux négatif, et le genre qui envoie
 * chercher un bug ailleurs.
 */
const FRAMES = 300;

/**
 * Les huit ROMs et ce que chacune arbitre. Plus de colonne « attendu » : il n'y
 * a qu'un attendu, elles passent toutes. Le lot en regard dit seulement où
 * chercher quand l'une d'elles rougit.
 */
const ORACLES = [
  ['spsw-stop-prefetch-cgbBCE.gb', 'lot 1 — ce que STOP avale exactement'],
  ['spsw-mode0-cgbBCE.gb', 'lot 2 — l\'alignement LCD/CPU en travers d\'une bascule'],
  ['spsw-div-cgbBCE.gb', 'lot 3 — DIV remis à zéro, gelé, et sa phase'],
  ['spsw-tima-cgbBC.gb', 'lot 3 — TIMA, révision B/C'],
  ['spsw-tima-cgbE.gb', 'lot 3 — TIMA, révision E'],
  ['spsw-ch2-lc-delay-cgbBCE.gb', 'lot 4 — le compteur de longueur de la voie 2'],
  ['spsw-interrupts-cgbBC.gb', 'lot 5 — les IRQ pendant l\'arrêt'],
  ['spsw-interrupts-cgbE.gb', 'lot 5 — idem, révision E'],
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

describe.skipIf(!existsSync(FIXTURES))('AGE speed-switch : les huit oracles du jalon', () => {
  it.each(ORACLES)('%s — %s', (nom, arbitre) => {
    const { registers, pc } = runRom(nom);
    const passe = FIBONACCI.every((v, i) => v === registers[i]);

    expect(
      passe,
      `${arbitre}\n` +
        `      registres [${registers}] au lieu de Fibonacci [${FIBONACCI}], ` +
        `PC=0x${pc.toString(16)}`,
    ).toBe(true);
  });
});
