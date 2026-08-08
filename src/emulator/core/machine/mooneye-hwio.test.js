import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import buildCartridge from '../cartridge/Cartridge';
import { DMG, CGB } from '../models';

/**
 * MOONEYE unused_hwio — l'oracle du lot 1.5 : le PLAN $FFxx, trou par trou.
 *
 * La ROM balaye tout l'espace d'IO. Pour chaque adresse elle écrit une valeur,
 * relit, et compare sous masque :
 *
 *     test REG   MASK   WRITE   EXPECTED
 *
 * La règle du matériel tient en une phrase : les bits qui n'existent pas, et les
 * adresses qui ne mènent à rien, se lisent à 1. Il n'y a personne derrière, le
 * bus laisse ses lignes en l'air.
 *
 * POURQUOI CE LOT EXISTE. Il n'est pas CGB du tout — c'est un trou de justesse
 * DMG découvert en préparant les lots suivants. Sa variante `-C` est l'oracle
 * naturel de VBK (0xFF4F) et des palettes (0xFF68, 0xFF6A), mais elle teste le
 * MÊME plan d'IO que `-GS` plus ces quelques adresses. Tant que la base DMG
 * était rouge, l'écart n'était pas lisible : impossible de dire si un échec
 * venait du CGB manquant ou d'un masque DMG manquant. On ferme donc la base
 * d'abord.
 *
 * `-C` DOIT RESTER ROUGE ICI, et c'est le négatif du lot : il prouve que ce
 * qu'on vient de faire n'a PAS accidentellement satisfait le CGB. Le jour où
 * les lots 2 et 3 poseront VBK et les palettes, ce test-là devra être retourné.
 */

const FIXTURES = resolve(process.cwd(), 'src/test/fixtures/mooneye/build');

const REUSSITE = [3, 5, 8, 13, 21, 34];
const ECHEC = [0x42, 0x42, 0x42, 0x42, 0x42, 0x42];
const VERDICT_LONGUEUR = REUSSITE.length;

const Cartridge = buildCartridge();
const instructions = buildInstructions();

const buildManivelle = () => {
  const cbs = [];
  return {
    onTick(cb) { cbs.push(cb); },
    start() {}, stop() {},
    tick() { cbs.forEach((cb) => cb({ detail: 'tick' })); },
  };
};

const runRom = (relative, model, maxFrames = 3000) => {
  const serial = { output: [], read() {}, write() {}, echo(buffer) { this.output = buffer; } };
  const clock = buildManivelle();
  const memory = buildMemory(undefined, serial);
  const cpu = new CPU(memory);
  const Decoder = buildDecoder(cpu, instructions);
  const Machine = buildMachine(memory, cpu, new Decoder(), clock, serial);
  const machine = new Machine(model);

  machine.plugCartridge(new Cartridge(new Uint8Array(readFileSync(resolve(FIXTURES, relative)))));

  let frames = 0;
  while (frames < maxFrames && serial.output.length < VERDICT_LONGUEUR) {
    clock.tick();
    frames++;
  }
  return { verdict: serial.output, frames };
};

const GS_ROM = 'acceptance/bits/unused_hwio-GS.gb';
const C_ROM = 'misc/bits/unused_hwio-C.gb';
const present = (r) => existsSync(resolve(FIXTURES, r));

describe.skipIf(!present(GS_ROM))('Mooneye unused_hwio : les trous du plan $FFxx', () => {
  it('unused_hwio-GS.gb passe en DMG', () => {
    const { verdict, frames } = runRom(GS_ROM, DMG);
    expect(verdict, `verdict après ${frames} trames : [${verdict}]`).toEqual(REUSSITE);
  });

  it.skipIf(!present(C_ROM))(
    'unused_hwio-C.gb échoue encore : VBK et les palettes n\'existent pas (lots 2 et 3)',
    () => {
      // Le négatif du lot. À RETOURNER quand le lot 3 sera fermé — ce test est
      // le rappel écrit qu'il reste du chemin, pas un échec qu'on tolère.
      const { verdict } = runRom(C_ROM, CGB);
      expect(verdict, 'si ceci devient vert, c\'est que les lots 2-3 sont faits').toEqual(ECHEC);
    },
  );
});
