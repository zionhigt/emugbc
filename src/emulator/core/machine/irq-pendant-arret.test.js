import { describe, it, expect } from 'vitest';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import { CGB } from '../models';

/**
 * LOT 5 DU JALON DOUBLE VITESSE — LES INTERRUPTIONS PENDANT L'ARRÊT.
 *
 * L'arrêt de 2050 cycles n'est pas un blocage : c'est un `halt` déguisé, et il
 * se réveille comme un `halt` — dès qu'une source ARMÉE lève son drapeau. La
 * bascule de régime, elle, a bien eu lieu : ce n'est pas elle qu'on interrompt,
 * c'est l'attente qui la suit.
 *
 * POURQUOI CE LOT PORTE UN AVERTISSEMENT. Les deux ROMs qui l'arbitrent sont
 * rangées dans un dossier `caution/` chez AGE, et son auteur explique pourquoi :
 * en les enchaînant il a rendu une vraie CGB E instable, au point qu'un reset
 * n'y suffisait plus — l'oscillateur n'avait plus le temps de se stabiliser. Le
 * manuel Nintendo déconseille explicitement la manœuvre. Rien de tout ça ne nous
 * coûte quoi que ce soit en émulation, mais ça dit ce que ces ROMs mesurent :
 * un cas limite hors des clous, pas un usage de jeu.
 */

const KEY1 = 0xFF4D;
const IE = 0xFFFF;
const IF = 0xFF0F;
const DIV = 0xFF04;
const CODE = 0xFF80;

/** L'arrêt complet, en cycles machine du monde. */
const ARRET = 2050;

/** Le bit 0 de IE/IF : VBlank, la source la plus prioritaire. */
const VBLANK = 0x01;

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

const basculer = ({ cpu, decoder, memory }) => {
  memory.write(KEY1, 0x01);
  memory.write(CODE, 0x10);
  memory.write(CODE + 1, 0x00);
  cpu.registers.PC.setValue(CODE);
  decoder.step();
};

const armer = ({ memory }, source) => {
  memory.write(IE, source);
  memory.write(IF, source);
};

describe('une interruption en attente coupe l\'arrêt', () => {
  it('sans elle, l\'arrêt est servi en entier', () => {
    const rig = makeMachine();
    const avant = rig.machine.totalCycles;
    basculer(rig);

    expect(rig.machine.totalCycles - avant).toBeGreaterThanOrEqual(ARRET);
  });

  it('avec elle, le processeur repart tout de suite', () => {
    const rig = makeMachine();
    armer(rig, VBLANK);
    const avant = rig.machine.totalCycles;
    basculer(rig);

    expect(rig.machine.totalCycles - avant, 'le coût de l\'instruction, et rien de plus')
      .toBeLessThan(10);
  });

  it('et la bascule a quand même eu lieu', () => {
    // Le point qui ne va pas de soi : l'interruption n'annule pas la bascule.
    // Un émulateur qui sortirait de `onStop` en voyant le drapeau laisserait le
    // jeu en vitesse simple alors qu'il se croit en double.
    const rig = makeMachine();
    armer(rig, VBLANK);
    basculer(rig);

    expect(rig.machine.doubleSpeed).toBe(true);
    expect(rig.memory.read(KEY1), 'bit 7 levé, bit 0 désarmé').toBe(0xFE);
  });

  it('DIV est remis à zéro dans les deux cas — c\'est `STOP` qui le fait, pas l\'attente', () => {
    const rig = makeMachine();
    rig.cpu.pay(64 * 100);
    expect(rig.memory.read(DIV)).toBe(100);

    armer(rig, VBLANK);
    basculer(rig);

    expect(rig.memory.read(DIV)).toBe(0);
  });

  it('une source NON ARMÉE ne coupe rien', () => {
    // Le drapeau seul ne suffit pas : il faut que IE l'écoute. C'est la règle du
    // réveil de `halt`, et elle ne se confond pas avec celle du SERVICE, qui
    // demande en plus `ime`.
    const rig = makeMachine();
    rig.memory.write(IF, VBLANK);
    rig.memory.write(IE, 0x00);
    const avant = rig.machine.totalCycles;
    basculer(rig);

    expect(rig.machine.totalCycles - avant, 'personne n\'écoute, l\'arrêt est servi')
      .toBeGreaterThanOrEqual(ARRET);
  });

  it('les trois bits du haut de IF ne comptent pas', () => {
    // IF se lit avec ses bits 5-7 à 1. Les prendre pour des sources en attente
    // ferait couper TOUS les arrêts, et le lot 3 ne servirait plus à rien.
    const rig = makeMachine();
    rig.memory.write(IE, 0xFF);
    rig.memory.write(IF, 0x00);
    const avant = rig.machine.totalCycles;
    basculer(rig);

    expect(rig.machine.totalCycles - avant).toBeGreaterThanOrEqual(ARRET);
  });
});
