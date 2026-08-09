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
 * Et un second point, qui lui n'est pas gratuit : SUR QUELLE MONTRE se comptent
 * les cycles de l'arrêt de `STOP`. Voir le describe du même nom — la réponse a
 * changé, et c'est un oracle qui l'a changée.
 */

const KEY1 = 0xFF4D;
const LCDC = 0xFF40;
const LY = 0xFF44;

/** Une ligne complète du PPU : 456 dots, donc 114 cycles machine du MONDE. */
const LIGNE = 114;
/** Une trame : 154 lignes. */
const TRAME = LIGNE * 154;

/** L'arrêt de `STOP`, en cycles machine DU PROCESSEUR. Voir `STOP_PAUSE`. */
const ARRET = 32769;

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

describe('l\'arrêt de STOP se compte sur la montre du PROCESSEUR', () => {
  // La question que pandocs laisse ouverte : « 2050 cycles machine », mais
  // comptés sur quelle montre ? Ce fichier a d'abord tranché pour le MONDE, au
  // motif qu'un délai d'oscillateur est un délai physique. C'était une jolie
  // idée sans oracle derrière, et `spsw-tima` l'a démentie : elle ne bascule
  // QUE vers le double régime, et le compte d'incréments qu'elle attend est
  // celui d'un arrêt facturé en cycles DU PROCESSEUR.
  //
  // Conséquence directe, et c'est elle qu'on vérifie ici : l'écran voit passer
  // deux fois MOINS de temps quand la bascule mène au double régime.
  it('vers le double régime : le processeur paie 32769, le monde n\'en voit que la moitié', () => {
    const rig = makeMachine();
    const mondeAvant = rig.machine.systemCycles;
    const cpuAvant = rig.machine.totalCycles;
    basculer(rig);

    expect(rig.machine.totalCycles - cpuAvant, 'la montre du processeur')
      .toBeGreaterThanOrEqual(ARRET);
    expect(rig.machine.systemCycles - mondeAvant, 'et le monde, moitié moins')
      .toBeLessThan(ARRET / 2 + 10);
  });

  it('le retour en simple régime dure DEUX FOIS PLUS, vu de l\'écran', () => {
    const rig = makeMachine();
    basculer(rig);

    const mondeAvant = rig.machine.systemCycles;
    basculer(rig);

    expect(rig.machine.systemCycles - mondeAvant, 'même compte de cycles processeur, montre plus lente')
      .toBeGreaterThanOrEqual(ARRET);
  });

  it('l\'écran AVANCE pendant l\'arrêt, il n\'est pas suspendu avec le processeur', () => {
    // C'est le PROCESSEUR que `STOP` arrête, pas l'écran. Et l'arrêt est LONG :
    // 32769 cycles processeur, soit ~16385 du monde à l'aller, soit 143 lignes —
    // presque une trame entière. Un jeu qui bascule juste avant une VBlank la
    // rate. C'est aussi pourquoi le harnais des ROMs a dû passer de 60 à 300
    // trames : chaque bascule lui en coûte près d'une.
    const rig = makeMachine();
    jusquAuChangementDeLigne(rig);

    const mondeAvant = rig.machine.systemCycles;
    basculer(rig);

    const lignes = Math.floor((rig.machine.systemCycles - mondeAvant) / LIGNE);
    expect(lignes, 'presque une trame entière de 154 lignes').toBe(143);
  });
});
