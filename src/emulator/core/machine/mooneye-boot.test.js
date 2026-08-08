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
 * MOONEYE boot_regs — l'oracle du lot 1 : quels registres la ROM de démarrage
 * laisse-t-elle derrière elle, selon le modèle de console.
 *
 * POURQUOI LE FORÇAGE EST OBLIGATOIRE. `boot_regs-cgb.gb` porte 0x143 = 0x00 :
 * elle ne se déclare PAS compatible CGB. C'est le cas de toutes les ROMs
 * mooneye, et c'est logique — elles ne décrivent pas ce qu'elles savent faire,
 * elles mesurent ce que la CONSOLE a laissé dans les registres. On ne peut donc
 * pas les faire tourner en CGB par déduction depuis l'en-tête : il faut le dire.
 *
 * CHAQUE ORACLE VIENT AVEC SON NÉGATIF, et c'est la moitié qui compte. Qu'une
 * ROM CGB passe en CGB ne prouve pas grand-chose tant qu'on n'a pas vu la même
 * ROM ÉCHOUER en DMG : sans ça, un `postBoot` qui ignorerait le modèle et
 * poserait toujours les mêmes valeurs pourrait très bien passer le test positif
 * par coïncidence. Mooneye documente lui-même ses échecs attendus, en tête de
 * chaque source :
 *
 *   boot_regs-cgb.s      pass: CGB          fail: DMG, MGB, SGB, SGB2, AGB, AGS
 *   boot_regs-dmgABC.s   pass: DMG ABC      fail: DMG 0, MGB, SGB, SGB2, CGB, ...
 *
 * PROTOCOLE (commun à mooneye) : verdict sur le port série, Fibonacci
 * 3 5 8 13 21 34 en cas de réussite, six fois 0x42 en cas d'échec.
 */

const FIXTURES = resolve(process.cwd(), 'src/test/fixtures/mooneye/build');

const REUSSITE = [3, 5, 8, 13, 21, 34];
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
  return { verdict: serial.output, model: machine.model, frames };
};

const CGB_ROM = 'misc/boot_regs-cgb.gb';
const DMG_ROM = 'acceptance/boot_regs-dmgABC.gb';
const present = (r) => existsSync(resolve(FIXTURES, r));

describe.skipIf(!present(CGB_ROM) || !present(DMG_ROM))(
  'Mooneye boot_regs : les registres au démarrage, par modèle',
  () => {
    it('le forçage l\'emporte sur l\'en-tête, qui ne déclare rien', () => {
      // Le fait qui rend le forçage nécessaire, tenu par un test pour qu'on ne
      // le redécouvre pas dans six mois.
      const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, CGB_ROM)));
      const cartridge = new Cartridge(bytes);

      expect(cartridge.header.cgbFlag, 'la ROM ne se déclare pas CGB').toBe(0x00);
      expect(cartridge.header.supportsCgb).toBe(false);
      expect(runRom(CGB_ROM, CGB).model, 'et pourtant la machine est en CGB').toBe(CGB);
    });

    describe('le positif : chaque ROM passe sur SON modèle', () => {
      it('boot_regs-cgb.gb passe en CGB', () => {
        const { verdict, frames } = runRom(CGB_ROM, CGB);
        expect(verdict, `verdict après ${frames} trames : [${verdict}]`).toEqual(REUSSITE);
      });

      it('boot_regs-dmgABC.gb passe en DMG', () => {
        const { verdict, frames } = runRom(DMG_ROM, DMG);
        expect(verdict, `verdict après ${frames} trames : [${verdict}]`).toEqual(REUSSITE);
      });
    });

    describe('le négatif : sur le mauvais modèle, elles doivent ÉCHOUER', () => {
      // Sans cette moitié-là, un postBoot qui ignorerait le modèle passerait
      // peut-être le positif par coïncidence. C'est ici qu'on prouve que la
      // bascule fait réellement quelque chose.
      const ECHEC = [0x42, 0x42, 0x42, 0x42, 0x42, 0x42];

      it('boot_regs-cgb.gb échoue en DMG', () => {
        expect(runRom(CGB_ROM, DMG).verdict).toEqual(ECHEC);
      });

      it('boot_regs-dmgABC.gb échoue en CGB', () => {
        expect(runRom(DMG_ROM, CGB).verdict).toEqual(ECHEC);
      });
    });
  },
);
