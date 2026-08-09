import { describe, it, expect } from 'vitest';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import { CGB } from '../models';

/**
 * LOT 2 DU JALON DOUBLE VITESSE — LE PPU GARDE SON HEURE.
 *
 * Le lot 0 a branché le PPU sur `machine.systemCycles`, et c'était une ligne.
 * Ce lot-ci est celui qui le PROUVE — pas au niveau du getter, où la preuve ne
 * vaut rien (elle relit ce que le code vient d'écrire), mais au niveau de
 * L'ÉCRAN : combien de cycles processeur faut-il pour dessiner une ligne, une
 * trame. En double régime la réponse doit DOUBLER, ce qui est exactement la
 * façon de dire que l'écran, lui, n'a pas bougé.
 *
 * Et un second point, qui lui n'est pas gratuit : COMBIEN DE TEMPS DURE L'ARRÊT
 * de `STOP`, vu du monde. Voir le describe du même nom.
 */

const KEY1 = 0xFF4D;
const LCDC = 0xFF40;
const LY = 0xFF44;

/** Une ligne complète du PPU : 456 dots, donc 114 cycles machine du MONDE. */
const LIGNE = 114;
/** Une trame : 154 lignes. */
const TRAME = LIGNE * 154;

/** L'arrêt de `STOP`, en cycles machine du monde (8200 dots). */
const ARRET = 2050;

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
  machine.memory.write(LCDC, 0x80); // l'écran allumé, sinon LY reste à zéro
  return { machine, cpu, decoder, memory: machine.memory };
};

const basculer = ({ cpu, decoder, memory }) => {
  memory.write(KEY1, 0x01);
  memory.write(CODE, 0x10);
  memory.write(CODE + 1, 0x00);
  cpu.registers.PC.setValue(CODE);
  decoder.step();
};

/** Avancer d'un cycle processeur jusqu'à ce que LY change, et rendre le compte. */
const jusquAuChangementDeLigne = (rig) => {
  const depart = rig.memory.read(LY);
  let paye = 0;
  while (rig.memory.read(LY) === depart && paye < TRAME * 3) {
    rig.cpu.pay(1);
    paye += 1;
  }
  return paye;
};

/**
 * Combien de cycles PROCESSEUR pour une ligne entière. Le premier appel sert à
 * se caler sur une frontière de ligne — sans lui on mesure le reste de la ligne
 * en cours, et le compte manque de ce qui s'était déjà écoulé.
 */
const cyclesParLigne = (rig) => {
  jusquAuChangementDeLigne(rig);
  return jusquAuChangementDeLigne(rig);
};

describe('l\'écran ne double pas de vitesse', () => {
  it('en simple régime, une ligne coûte 114 cycles processeur', () => {
    const rig = makeMachine();
    expect(cyclesParLigne(rig)).toBe(LIGNE);
  });

  it('en double régime, la MÊME ligne en coûte 228', () => {
    // C'est la seule façon honnête de dire « l'écran n'a pas bougé » : ce n'est
    // pas le PPU qui ralentit, c'est le processeur qui bat deux fois entre deux
    // battements du monde. Le nombre qui double est celui du processeur.
    const rig = makeMachine();
    basculer(rig);

    expect(cyclesParLigne(rig)).toBe(LIGNE * 2);
  });

  it('et la bascule inverse rend les 114 cycles', () => {
    const rig = makeMachine();
    basculer(rig);
    basculer(rig);

    expect(cyclesParLigne(rig)).toBe(LIGNE);
  });

  it('LY parcourt ses 154 lignes en deux fois plus de cycles processeur', () => {
    const rig = makeMachine();
    basculer(rig);

    const avant = rig.memory.read(LY);
    rig.cpu.pay(TRAME * 2);

    expect(rig.memory.read(LY), 'une trame entière, et on retombe sur la même ligne').toBe(avant);
  });
});

describe('l\'arrêt de STOP dure 8200 dots — du temps du MONDE', () => {
  // La question que pandocs laisse ouverte : « 2050 cycles machine », mais
  // comptés sur quelle montre ? On tranche pour celle du MONDE, parce que
  // l'arrêt n'est pas un compte d'instructions, c'est un DÉLAI PHYSIQUE — le
  // temps que l'oscillateur se stabilise. Un délai physique dure la même chose
  // en secondes quel que soit le régime qui en sortira.
  //
  // Conséquence directe et vérifiable : l'écran avance d'autant dans les deux
  // sens de bascule. Le processeur, lui, paie deux fois plus de SES cycles
  // quand il en sort en double régime — même durée, montre plus rapide.
  it('vers le double régime : le monde avance de 2050, le processeur de 4100', () => {
    const rig = makeMachine();
    const mondeAvant = rig.machine.systemCycles;
    const cpuAvant = rig.machine.totalCycles;
    basculer(rig);

    expect(rig.machine.systemCycles - mondeAvant, 'l\'écran a vu passer 8200 dots')
      .toBeGreaterThanOrEqual(ARRET);
    expect(rig.machine.systemCycles - mondeAvant).toBeLessThan(ARRET + 10);
    expect(rig.machine.totalCycles - cpuAvant, 'et le processeur deux fois plus de ses cycles à lui')
      .toBeGreaterThanOrEqual(ARRET * 2);
  });

  it('et le retour en simple régime dure exactement aussi longtemps, vu de l\'écran', () => {
    const rig = makeMachine();
    basculer(rig);

    const mondeAvant = rig.machine.systemCycles;
    basculer(rig);

    expect(rig.machine.systemCycles - mondeAvant, 'le même délai physique')
      .toBeGreaterThanOrEqual(ARRET);
    expect(rig.machine.systemCycles - mondeAvant).toBeLessThan(ARRET + 10);
  });

  it('l\'écran AVANCE pendant l\'arrêt, il n\'est pas suspendu avec le processeur', () => {
    // C'est le PROCESSEUR que `STOP` arrête, pas l'écran. Confondre les deux
    // ferait rater une VBlank entière au jeu qui bascule juste avant.
    //
    // Le compte tombe rond : 2 cycles pour lire l'opcode et son octet, puis
    // 2050 d'arrêt, soit 2052 cycles du monde = 8208 dots = très exactement 18
    // lignes de 456. On se cale d'abord sur une frontière de ligne, sinon le
    // reste de la ligne en cours ferait pencher le compte à 17.
    const rig = makeMachine();
    jusquAuChangementDeLigne(rig);

    const avant = rig.memory.read(LY);
    basculer(rig);

    expect((rig.memory.read(LY) - avant + 154) % 154, 'dix-huit lignes de plus').toBe(18);
  });
});
