import { describe, it, expect } from 'vitest';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import { CGB } from '../models';

/**
 * LOT 0 DU JALON DOUBLE VITESSE — LA BASE DE TEMPS SYSTÈME.
 *
 * Jusqu'ici `machine.totalCycles` servait d'heure à tout le monde. C'est juste
 * tant qu'il n'y a QU'UNE horloge. Le CGB en a deux : quand le double régime est
 * enclenché, le processeur bat deux fois plus vite, mais l'écran affiche toujours
 * 59,7 images par seconde et le haut-parleur sort toujours un la à 440 Hz.
 *
 * Deux montres, donc, et une question par périphérique : tu regardes laquelle ?
 *
 *   CPU, timer/DIV, série, DMA vers l'OAM  ->  la montre du CPU  (`totalCycles`)
 *   PPU, HDMA, toutes les fréquences audio ->  la montre du monde (`systemCycles`)
 *
 * CE LOT NE CHANGE RIEN, et c'est tout son intérêt : en vitesse simple les deux
 * compteurs portent le même nombre. Il ne pose que la couture — `doubleSpeed`,
 * qui rend `false` — pour que le lot 1 n'ait plus qu'à la faire mentir. Même
 * geste que le lot 0 du jalon CGB, et pour la même raison : c'est un refactor
 * sous les pieds de trois chapitres clos.
 */

const instructions = buildInstructions();

const makeMachine = () => {
  const serial = { read() {}, write() {}, echo() {} };
  const memory = buildMemory(undefined, serial);
  const cpu = new CPU(memory);
  const Decoder = buildDecoder(cpu, instructions);
  const Machine = buildMachine(memory, cpu, new Decoder(), { onTick() {}, start() {}, stop() {} }, serial);
  const machine = new Machine(CGB);
  machine.plugCartridge({ header: { supportsCgb: true }, mbc: null, read: () => 0, write: () => {} });
  return { machine, cpu };
};

/** Forcer la couture, tant que personne ne sait encore l'enclencher (lot 1). */
const forcerDoubleRegime = (machine) => {
  Object.defineProperty(machine, 'doubleSpeed', { get: () => true, configurable: true });
};

describe('la couture du régime', () => {
  it('la machine tourne en vitesse simple, et le dit', () => {
    expect(makeMachine().machine.doubleSpeed).toBe(false);
  });
});

describe('les deux compteurs', () => {
  it('partent tous les deux de zéro', () => {
    const { machine } = makeMachine();
    expect(machine.totalCycles).toBe(0);
    expect(machine.systemCycles).toBe(0);
  });

  it('avancent du même pas en vitesse simple', () => {
    const { machine, cpu } = makeMachine();
    cpu.pay(7);
    expect(machine.totalCycles).toBe(7);
    expect(machine.systemCycles, 'une seule horloge, deux noms').toBe(7);
  });

  it('en vitesse double, le temps système avance de moitié', () => {
    const { machine, cpu } = makeMachine();
    forcerDoubleRegime(machine);
    cpu.pay(10);

    expect(machine.totalCycles, 'le CPU, lui, a bien payé dix cycles').toBe(10);
    expect(machine.systemCycles, 'le monde n\'en a vu que cinq passer').toBe(5);
  });

  it('un cycle CPU isolé donne un DEMI cycle système, sans se perdre', () => {
    // On compte en demis, sinon un cycle sur deux disparaîtrait dans un
    // arrondi — et le PPU, qui multiplie par quatre, verrait deux dots manquer
    // à chaque instruction impaire.
    const { machine, cpu } = makeMachine();
    forcerDoubleRegime(machine);
    cpu.pay(1);
    expect(machine.systemCycles).toBe(0.5);
    cpu.pay(1);
    expect(machine.systemCycles, 'les deux moitiés se recollent').toBe(1);
  });

  it('le temps système ne recule jamais quand le régime change en cours de route', () => {
    // Le piège d'un compteur DÉRIVÉ : si `systemCycles` se recalculait depuis
    // `totalCycles` à chaque lecture, la bascule le ferait sauter en arrière de
    // la moitié de toute l'histoire de la machine. Il s'ACCUMULE, il ne se
    // recalcule pas.
    const { machine, cpu } = makeMachine();
    cpu.pay(100);
    const avant = machine.systemCycles;
    forcerDoubleRegime(machine);
    cpu.pay(4);

    expect(avant).toBe(100);
    expect(machine.systemCycles, 'on repart de 100, pas de 52').toBe(102);
  });
});

describe('qui regarde quelle montre', () => {
  it('le PPU regarde celle du monde', () => {
    const { machine, cpu } = makeMachine();
    forcerDoubleRegime(machine);
    cpu.pay(8);

    expect(machine.ppu.totalMachineCycles, 'sinon l\'écran doublerait de vitesse').toBe(4);
    expect(machine.ppu.totalMachineCycles).toBe(machine.systemCycles);
  });

  it('l\'APU aussi — toutes ses fréquences sont celles du monde', () => {
    const { machine, cpu } = makeMachine();
    forcerDoubleRegime(machine);
    cpu.pay(8);

    expect(machine.apu.totalMachineCycles, 'sinon le la monterait d\'une octave').toBe(4);
  });

  it('le timer, lui, garde celle du CPU : c\'est SON horloge qu\'il compte', () => {
    const { machine, cpu } = makeMachine();
    forcerDoubleRegime(machine);
    cpu.pay(8);

    // DIV compte les cycles du processeur : en double régime il bat deux fois
    // plus vite dans le monde réel, et c'est le comportement du matériel.
    expect(machine.timer.innerCyclesAt(machine.totalCycles))
      .toBe(machine.timer.innerCyclesAt(8));
  });
});
