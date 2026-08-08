import { describe, it, expect } from 'vitest';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import { DMG, CGB } from '../models';

/**
 * LOT 1 DU JALON DOUBLE VITESSE — KEY1 ET STOP.
 *
 * La bascule de régime ne se demande pas avec un registre : elle se demande avec
 * DEUX GESTES, et c'est ce qui la rend particulière. On ARME (bit 0 de KEY1),
 * puis on exécute `STOP`. Le premier geste ne fait rien tout seul, le second ne
 * fait rien sans le premier.
 *
 *     KEY1 = $01
 *     STOP
 *
 * C'est la procédure que pandocs recommande, et c'est le seul usage de `STOP`
 * dans les jeux sous licence.
 *
 * POURQUOI CE LOT NE SE COUPE PAS EN DEUX. Mapper KEY1 sans faire la bascule
 * serait pire que de ne rien faire : aujourd'hui $FF4D tombe dans les trous et se
 * lit 0xFF, donc bit 7 à 1, donc « tu es déjà en double vitesse » — les jeux
 * n'insistent pas. Le mapper à 0x7E leur dit « tu es en simple, demande la
 * bascule ». Sans bascule derrière, ils attendraient pour toujours.
 */

const KEY1 = 0xFF4D;

/** Le CPU s'arrête 2050 cycles machine après la bascule (pandocs). */
const ARRET = 2050;

// De la vraie mémoire où poser deux octets de code : la HRAM.
const CODE = 0xFF80;

const instructions = buildInstructions();

const makeMachine = (model) => {
  const serial = { read() {}, write() {}, echo() {} };
  const memory = buildMemory(undefined, serial);
  const cpu = new CPU(memory);
  const Decoder = buildDecoder(cpu, instructions);
  const decoder = new Decoder();
  const Machine = buildMachine(memory, cpu, decoder, { onTick() {}, start() {}, stop() {} }, serial);
  const machine = new Machine(model);
  machine.plugCartridge({ header: { supportsCgb: model === CGB }, mbc: null, read: () => 0, write: () => {} });
  return { machine, cpu, decoder, memory: machine.memory };
};

/** Exécuter un vrai `STOP` : l'opcode 0x10 suivi de son octet ignoré. */
const executerStop = ({ cpu, decoder, memory }) => {
  memory.write(CODE, 0x10);
  memory.write(CODE + 1, 0x00);
  cpu.registers.PC.setValue(CODE);
  decoder.step();
};

describe('KEY1 (0xFF4D) : le registre', () => {
  it('n\'existe qu\'en CGB', () => {
    expect(makeMachine(DMG).memory.read(KEY1), 'un trou en DMG : 0xFF').toBe(0xFF);
    expect(makeMachine(CGB).memory.read(KEY1), 'la vraie valeur au repos').toBe(0x7E);
  });

  it('au repos : vitesse simple, bascule non armée, six bits en l\'air', () => {
    // 0x7E = 0b0111_1110 : bit 7 à 0 (vitesse simple), bit 0 à 0 (pas armé),
    // et les six du milieu à 1 comme partout ailleurs dans le plan d'IO.
    expect(makeMachine(CGB).memory.read(KEY1)).toBe(0x7E);
  });

  it('le bit 0 s\'arme et se désarme', () => {
    const { memory } = makeMachine(CGB);
    memory.write(KEY1, 0x01);
    expect(memory.read(KEY1)).toBe(0x7F);
    memory.write(KEY1, 0x00);
    expect(memory.read(KEY1)).toBe(0x7E);
  });

  it('le bit 7 est en LECTURE SEULE : on ne bascule pas en l\'écrivant', () => {
    // Le piège du registre : c'est `STOP` qui bascule, pas l'écriture. Un
    // émulateur qui prendrait le bit 7 au mot changerait de régime au moment où
    // le jeu ne fait que RELIRE et réécrire la valeur qu'il vient de lire.
    const { machine, memory } = makeMachine(CGB);
    memory.write(KEY1, 0xFF);

    expect(machine.doubleSpeed, 'écrire le bit 7 ne bascule rien').toBe(false);
    expect(memory.read(KEY1), 'seul le bit 0 a été retenu').toBe(0x7F);
  });
});

describe('la bascule elle-même', () => {
  it('STOP sans avoir armé ne change rien', () => {
    const rig = makeMachine(CGB);
    executerStop(rig);

    expect(rig.machine.doubleSpeed).toBe(false);
    expect(rig.memory.read(KEY1)).toBe(0x7E);
  });

  it('armer puis STOP fait passer en double régime', () => {
    const rig = makeMachine(CGB);
    rig.memory.write(KEY1, 0x01);
    executerStop(rig);

    expect(rig.machine.doubleSpeed).toBe(true);
    expect(rig.memory.read(KEY1), 'bit 7 levé, et le bit 0 s\'est désarmé tout seul').toBe(0xFE);
  });

  it('et la même procédure ramène en vitesse simple', () => {
    const rig = makeMachine(CGB);
    rig.memory.write(KEY1, 0x01);
    executerStop(rig);
    rig.memory.write(KEY1, 0x01);
    executerStop(rig);

    expect(rig.machine.doubleSpeed).toBe(false);
    expect(rig.memory.read(KEY1)).toBe(0x7E);
  });

  it('elle coûte 2050 cycles machine, pendant lesquels le CPU est arrêté', () => {
    const rig = makeMachine(CGB);
    rig.memory.write(KEY1, 0x01);
    const avant = rig.machine.totalCycles;
    executerStop(rig);

    expect(rig.machine.totalCycles - avant, 'l\'arrêt le temps que l\'oscillateur se stabilise')
      .toBeGreaterThanOrEqual(ARRET);
  });

  it('en DMG, STOP ne bascule rien — il n\'y a pas de second régime', () => {
    const rig = makeMachine(DMG);
    const avant = rig.machine.totalCycles;
    executerStop(rig);

    expect(rig.machine.doubleSpeed).toBe(false);
    expect(rig.machine.totalCycles - avant, 'et il ne coûte pas 2050 cycles').toBeLessThan(ARRET);
  });
});

describe('ce que la bascule change au temps qui passe', () => {
  it('après elle, le monde ne voit plus passer qu\'un cycle sur deux', () => {
    const rig = makeMachine(CGB);
    rig.memory.write(KEY1, 0x01);
    executerStop(rig);

    const cpuAvant = rig.machine.totalCycles;
    const mondeAvant = rig.machine.systemCycles;
    rig.cpu.pay(10);

    expect(rig.machine.totalCycles - cpuAvant, 'le CPU a payé dix cycles').toBe(10);
    expect(rig.machine.systemCycles - mondeAvant, 'le monde n\'en a vu que cinq').toBe(5);
  });

  it('le PPU suit le monde, pas le processeur', () => {
    const rig = makeMachine(CGB);
    rig.memory.write(KEY1, 0x01);
    executerStop(rig);

    const avant = rig.machine.ppu.totalMachineCycles;
    rig.cpu.pay(8);

    expect(rig.machine.ppu.totalMachineCycles - avant, 'sinon l\'écran doublerait de vitesse')
      .toBe(4);
  });
});
