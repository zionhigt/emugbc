import { describe, it, expect } from 'vitest';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import buildTimer from '../timer/index';
import { CGB } from '../models';

/**
 * LOT 3 DU JALON DOUBLE VITESSE — LE TIMER DOUBLE VRAIMENT.
 *
 * Deux affirmations, et une seule des deux demande du code neuf.
 *
 * 1. DIV et TIMA suivent la montre du PROCESSEUR. En double régime ils battent
 *    donc deux fois plus vite dans le monde réel. C'est déjà vrai depuis le lot
 *    0 — le timer lit `machine.totalCycles`, qui est justement cette montre-là —
 *    mais rien ne l'avait encore écrit noir sur blanc, et une inversion des deux
 *    compteurs ne se verrait qu'à l'oreille d'un jeu.
 *
 * 2. **`STOP` remet DIV à zéro — et NE LE GÈLE PAS.** Là, c'est neuf, et ce
 *    fichier a d'abord assuré le contraire, sur la foi de pandocs (§FF04) :
 *    *« this register is reset when executing the `stop` instruction, and only
 *    begins ticking again once stop mode ends. »*
 *
 * CES TESTS SONT DONC PORTÉS, PAS AJOUTÉS : ceux qui assuraient le gel assurent
 * maintenant le contraire, parce que les ROMs ont retourné la lecture. Et
 * l'illusion valait la peine d'être comprise — l'arrêt dure 131072 T-cycles,
 * soit EXACTEMENT 512 crans de DIV. Un compteur qui tourne tout ce temps revient
 * donc sur la même valeur qu'avant : indiscernable d'un compteur gelé, tant
 * qu'on ne regarde que DIV. Seul TIMA à 4 kHz peut trancher (128 incréments,
 * qui ne sont pas un multiple de 256), et c'est très exactement la ligne de
 * `spsw-tima` qui refusait de concorder.
 */

const KEY1 = 0xFF4D;
const DIV = 0xFF04;
const TIMA = 0xFF05;
const TMA = 0xFF06;
const TAC = 0xFF07;

/**
 * L'arrêt qui suit la bascule, en cycles machine du PROCESSEUR. Le +1 est la
 * phase, mesurée sur `spsw-div`. Voir `STOP_PAUSE` dans machine/index.js.
 */
const ARRET = 32769;

/** 131072 T-cycles d'arrêt, ça fait 512 crans de DIV. Pile. */
const CRANS_PENDANT_L_ARRET = 512;

/** Un cran de DIV = 256 T-cycles = 64 cycles machine. */
const CRAN_DIV = 64;

// De la vraie mémoire où poser deux octets de code : la HRAM.
const CODE = 0xFF80;

const instructions = buildInstructions();

const makeMachine = () => {
  const serial = { read() {}, write() {}, echo() {} };
  const memory = buildMemory(undefined, serial);
  const cpu = new CPU(memory);
  const Decoder = buildDecoder(cpu, instructions);
  const decoder = new Decoder();
  const Machine = buildMachine(memory, cpu, decoder, { onTick() {}, start() {}, stop() {} }, serial);
  const machine = new Machine(CGB);
  machine.plugCartridge({ header: { supportsCgb: true }, mbc: null, read: () => 0, write: () => {} });
  return { machine, cpu, decoder, memory: machine.memory };
};

/** Armer la bascule et exécuter un vrai `STOP` (opcode 0x10 + son octet ignoré). */
const basculer = ({ cpu, decoder, memory }) => {
  memory.write(KEY1, 0x01);
  memory.write(CODE, 0x10);
  memory.write(CODE + 1, 0x00);
  cpu.registers.PC.setValue(CODE);
  decoder.step();
};

describe('enterStopMode : la couture, sur un timer nu', () => {
  // Le banc du timer, celui de `timer.test.js` : une fausse machine dont on
  // tourne l'aiguille à la main. Le timer ne reçoit pas les cycles, il les lit.
  const makeTimer = () => {
    const machine = { totalCycles: 0, get systemCycles() { return this.totalCycles; }, IF: 0 };
    const Timer = buildTimer(machine);
    return { machine, timer: new Timer() };
  };

  it('remet le compteur à zéro', () => {
    const { machine, timer } = makeTimer();
    machine.totalCycles = CRAN_DIV * 200;
    expect(timer.read(DIV), 'DIV est loin de zéro avant la bascule').toBe(200);

    timer.enterStopMode();

    expect(timer.read(DIV)).toBe(0);
  });

  it('et NE LE GÈLE PAS : le temps de l\'arrêt lui compte', () => {
    // Le test qui a changé de sens. Il assurait le gel ; il assure maintenant
    // l'inverse, parce que `spsw-tima` a tranché contre pandocs.
    const { machine, timer } = makeTimer();
    timer.enterStopMode();

    machine.totalCycles += CRAN_DIV * 10;

    expect(timer.read(DIV), 'dix crans passés, dix crans comptés').toBe(10);
  });

  it('l\'arrêt entier vaut 512 crans, donc DIV retombe sur zéro', () => {
    // LA COÏNCIDENCE QUI A COÛTÉ UN LOT. 32768 cycles machine = 131072
    // T-cycles = 512 × 256. Après un arrêt, DIV lit donc 0 — exactement ce que
    // rendrait un compteur gelé. C'est cette égalité, et elle seule, qui a fait
    // passer `spsw-div` pour un modèle faux.
    const { machine, timer } = makeTimer();
    timer.enterStopMode();

    machine.totalCycles += ARRET - 1;

    expect(CRANS_PENDANT_L_ARRET * CRAN_DIV, 'l\'arrêt, en cycles machine').toBe(ARRET - 1);
    expect(timer.read(DIV), 'indiscernable d\'un gel — c\'était tout le piège').toBe(0);
  });

  it('TIMA, lui, compte bel et bien pendant l\'arrêt', () => {
    // Et c'est la seule chose qui distingue les deux modèles. Au réglage le plus
    // lent (4 kHz, un cran tous les 256 cycles machine), l'arrêt vaut 128
    // incréments — pas un multiple de 256, donc visible.
    const { machine, timer } = makeTimer();
    timer.write(TMA, 0x00);
    timer.write(TIMA, 0x00);
    timer.write(TAC, 0b100); // 4 kHz
    timer.enterStopMode();

    machine.totalCycles += ARRET - 1;
    timer.check();

    expect(timer.read(TIMA), 'les 128 incréments que `spsw-tima` attend').toBe(0x80);
  });
});

describe('l\'arrêt de STOP, à travers la vraie machine', () => {
  it('la bascule remet DIV à zéro, quelle que soit l\'heure qu\'il était', () => {
    const rig = makeMachine();
    rig.cpu.pay(CRAN_DIV * 100);
    expect(rig.memory.read(DIV), 'cent crans au compteur avant la bascule').toBe(100);

    basculer(rig);

    expect(rig.memory.read(DIV), 'et zéro après : STOP l\'a remis à zéro').toBe(0);
  });

  it('DIV lit encore zéro à la sortie — 512 crans pile, pas un gel', () => {
    const rig = makeMachine();
    const avantCycles = rig.machine.totalCycles;

    basculer(rig);

    expect(rig.machine.totalCycles - avantCycles, 'l\'arrêt a bien été facturé au processeur')
      .toBeGreaterThanOrEqual(ARRET);
    expect(rig.memory.read(DIV), 'le compteur a fait 512 tours complets, il retombe sur zéro')
      .toBe(0);
  });

  it('et il repart de là, pas d\'ailleurs', () => {
    const rig = makeMachine();
    basculer(rig);

    rig.cpu.pay(CRAN_DIV * 3);

    expect(rig.memory.read(DIV), 'trois crans depuis la fin de l\'arrêt').toBe(3);
  });

  it('TIMA, lui, DÉBORDE pendant l\'arrêt — et la ROM l\'exige', () => {
    // Le test qui a changé de sens. Au réglage le plus rapide (un cran tous les
    // 4 cycles machine), l'arrêt vaut 8192 incréments, donc 32 débordements et
    // l'interruption qui va avec. `spsw-tima` attend précisément ce drapeau
    // levé : c'est en cherchant d'où il pouvait bien venir que le modèle « le
    // compteur est gelé » est tombé.
    const rig = makeMachine();
    rig.memory.write(TMA, 0x00);
    rig.memory.write(TIMA, 0x00);
    rig.memory.write(TAC, 0b101);
    rig.machine.IF = 0;

    basculer(rig);

    expect(rig.machine.IF & 0b100, 'le drapeau d\'interruption du timer').toBe(0b100);
  });
});

describe('en double régime, le timer suit le processeur et non le monde', () => {
  it('DIV bat deux fois plus vite que l\'écran', () => {
    const rig = makeMachine();
    basculer(rig);

    const divAvant = rig.memory.read(DIV);
    const mondeAvant = rig.machine.systemCycles;
    rig.cpu.pay(CRAN_DIV);

    expect((rig.memory.read(DIV) - divAvant) & 0xFF, 'un cran plein, comme en vitesse simple').toBe(1);
    expect(rig.machine.systemCycles - mondeAvant, 'mais le monde n\'a vu passer que la moitié du temps')
      .toBe(CRAN_DIV / 2);
  });

  it('TIMA aussi : c\'est la montre du CPU qu\'il compte', () => {
    const rig = makeMachine();
    basculer(rig);
    rig.memory.write(TMA, 0x00);
    rig.memory.write(TAC, 0b101); // un cran tous les 4 cycles machine
    rig.memory.write(TIMA, 0x00);

    rig.cpu.pay(4 * 10);

    expect(rig.memory.read(TIMA), 'dix crans de processeur, pas cinq de monde').toBe(10);
  });
});
