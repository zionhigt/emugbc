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
 * 2. **`STOP` remet DIV à zéro, et le compteur ne tourne pas de tout l'arrêt.**
 *    Là, c'est neuf. Pandocs le dit en une phrase (§FF04) : *« this register is
 *    reset when executing the `stop` instruction, and only begins ticking again
 *    once stop mode ends. »* DEUX gestes dans cette phrase, et il faut les deux —
 *    `spsw-div` lit DIV de part et d'autre d'une bascule et compare.
 *
 * L'IMAGE À RETENIR pour le gel : le timer ne COMPTE pas des cycles, il LIT une
 * horloge. Son origine (`_innerCycles`) dit où cette horloge en était quand on
 * l'a remis à zéro. Geler le compteur, ce n'est donc pas l'empêcher de compter —
 * c'est **déplacer l'origine d'autant** : l'horloge avance, la différence ne
 * bouge pas.
 */

const KEY1 = 0xFF4D;
const DIV = 0xFF04;
const TIMA = 0xFF05;
const TMA = 0xFF06;
const TAC = 0xFF07;

/** Le CPU s'arrête 2050 cycles machine après la bascule (pandocs). */
const ARRET = 2050;

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

describe('timer.freeze : la couture, sur un timer nu', () => {
  // Le banc du timer, celui de `timer.test.js` : une fausse machine dont on
  // tourne l'aiguille à la main. Le timer ne reçoit pas les cycles, il les lit.
  const makeTimer = () => {
    const machine = { totalCycles: 0, get systemCycles() { return this.totalCycles; }, IF: 0 };
    const Timer = buildTimer(machine);
    return { machine, timer: new Timer() };
  };

  it('geler N cycles, c\'est ne pas les avoir vus passer', () => {
    const { machine, timer } = makeTimer();
    machine.totalCycles = CRAN_DIV * 3;
    expect(timer.read(DIV), 'trois crans avant le gel').toBe(3);

    timer.freeze(CRAN_DIV * 10);
    machine.totalCycles += CRAN_DIV * 10;

    expect(timer.read(DIV), 'l\'horloge a avancé de dix crans, DIV d\'aucun').toBe(3);
  });

  it('et le compteur repart de là où il s\'était arrêté', () => {
    const { machine, timer } = makeTimer();
    machine.totalCycles = CRAN_DIV * 3;
    timer.freeze(CRAN_DIV * 10);
    machine.totalCycles += CRAN_DIV * 10;

    machine.totalCycles += CRAN_DIV * 2;

    expect(timer.read(DIV), 'le gel décale l\'origine, il ne perd pas le compte').toBe(5);
  });

  it('TIMA non plus n\'avance pas pendant le gel', () => {
    const { machine, timer } = makeTimer();
    timer.write(TAC, 0b101); // timer en marche, un cran tous les 4 cycles machine
    timer.write(TIMA, 0x00);
    expect(timer.read(TIMA)).toBe(0x00);

    timer.freeze(CRAN_DIV * 10);
    machine.totalCycles += CRAN_DIV * 10;
    timer.check();

    expect(timer.read(TIMA), 'sinon il déborderait 160 fois pendant un arrêt').toBe(0x00);
  });

  it('enterStopMode : la remise à zéro EN PLUS du gel', () => {
    // Les deux moitiés de la phrase de pandocs. Ne faire que le gel laisse DIV
    // à la valeur qu'il avait avant la bascule — c'est ce décalage que
    // `spsw-div` mesure, et il ne se voit dans aucun test de gel.
    //
    // L'appel est ATOMIQUE avec le paiement de l'arrêt, et le banc le reproduit
    // : `enterStopMode` avance l'origine du compteur de toute la durée, donc
    // entre l'appel et le paiement l'origine est EN AVANCE sur l'horloge. Dans
    // la machine, `cpu.pay` suit immédiatement et personne ne regarde entre les
    // deux ; ici on tourne l'aiguille à la main, il faut le faire pareil.
    const { machine, timer } = makeTimer();
    machine.totalCycles = CRAN_DIV * 200;
    expect(timer.read(DIV), 'DIV est loin de zéro avant la bascule').toBe(200);

    timer.enterStopMode(CRAN_DIV * 10);
    machine.totalCycles += CRAN_DIV * 10;
    expect(timer.read(DIV), 'l\'arrêt entier n\'a pas fait un cran, et le compteur repart de zéro')
      .toBe(0);

    machine.totalCycles += CRAN_DIV * 3;
    expect(timer.read(DIV), 'trois crans, comptés depuis la fin de l\'arrêt').toBe(3);
  });
});

describe('l\'arrêt de STOP : le temps que le timer ne voit pas', () => {
  it('la bascule remet DIV à zéro, quelle que soit l\'heure qu\'il était', () => {
    const rig = makeMachine();
    rig.cpu.pay(CRAN_DIV * 100);
    expect(rig.memory.read(DIV), 'cent crans au compteur avant la bascule').toBe(100);

    basculer(rig);

    expect(rig.memory.read(DIV), 'et zéro après : STOP l\'a remis à zéro').toBe(0);
  });

  it('et il ne voit pas passer les 2050 cycles de l\'arrêt', () => {
    const rig = makeMachine();
    const avantCycles = rig.machine.totalCycles;

    basculer(rig);

    const paye = rig.machine.totalCycles - avantCycles;
    expect(paye, 'l\'arrêt a bien été facturé au processeur').toBeGreaterThanOrEqual(ARRET);
    expect(rig.memory.read(DIV), `DIV aurait fait ${Math.floor(paye / CRAN_DIV)} crans s'il avait tourné`)
      .toBe(0);
  });

  it('il ne repart qu\'une fois l\'arrêt fini', () => {
    const rig = makeMachine();
    basculer(rig);

    rig.cpu.pay(CRAN_DIV * 3);

    expect(rig.memory.read(DIV), 'trois crans, comptés depuis la fin de l\'arrêt et non depuis STOP')
      .toBe(3);
  });

  it('TIMA ne déborde pas pendant l\'arrêt', () => {
    // Le réglage le plus rapide : un cran tous les 4 cycles machine. Sur 2050
    // cycles, un timer qui tournerait pendant l\'arrêt ferait 512 crans, donc
    // DEUX débordements — et deux interruptions que la ROM n'attend pas.
    const rig = makeMachine();
    rig.memory.write(TMA, 0x00);
    rig.memory.write(TIMA, 0x00);
    rig.memory.write(TAC, 0b101);
    rig.machine.IF = 0;

    basculer(rig);

    expect(rig.memory.read(TIMA), 'l\'arrêt n\'a compté pour rien').toBeLessThan(0x10);
    expect(rig.machine.IF & 0b100, 'et n\'a levé aucune interruption de timer').toBe(0);
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
