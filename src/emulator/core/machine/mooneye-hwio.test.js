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

/**
 * La ROM range son état de test en HRAM avant de rendre son verdict :
 * `test_addr dw, test_got db, test_reg db, test_mask db` (voir la .ramsection
 * « Test-State » dans unused_hwio-C.s). De quoi savoir SUR QUELLE ADRESSE elle
 * s'est arrêtée, au lieu de constater un échec sans nom.
 */
const TEST_REG = 0xFF83;

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
  return { verdict: serial.output, frames, failedAt: machine.memory._read(TEST_REG) };
};

const GS_ROM = 'acceptance/bits/unused_hwio-GS.gb';
const C_ROM = 'misc/bits/unused_hwio-C.gb';
const present = (r) => existsSync(resolve(FIXTURES, r));

describe.skipIf(!present(GS_ROM))('Mooneye unused_hwio : les trous du plan $FFxx', () => {
  it('unused_hwio-GS.gb passe en DMG', () => {
    const { verdict, frames } = runRom(GS_ROM, DMG);
    expect(verdict, `verdict après ${frames} trames : [${verdict}]`).toEqual(REUSSITE);
  });

  /**
   * unused_hwio-C — POURQUOI IL NE PEUT PAS DEVENIR VERT, ET CE QU'IL MESURE
   * QUAND MÊME.
   *
   * Le cahier CGB a longtemps promis que les quatre registres indocumentés
   * étaient « tout ce qui séparait cette ROM du vert ». **C'est faux**, et le
   * lot 7 l'a découvert en la faisant avancer : elle s'arrête maintenant sur
   * $FF69, le port de DONNÉE des palettes de fond, qu'elle attend à 0xFF.
   *
   * L'explication est dans son en-tête : 0x143 = 0x00. Sur un vrai CGB, une
   * cartouche qui ne se déclare pas CGB fait démarrer la console en MODE DE
   * COMPATIBILITÉ DMG — le boot ROM pose KEY0 et verrouille au passage tout un
   * lot de registres : les deux ports de donnée des palettes ($FF69, $FF6B),
   * OPRI ($FF6C), SVBK ($FF70), les registres HDMA, et $FF74 qui devient
   * lecture seule à 0xFF. Ce que la ROM a mesuré sur du vrai matériel, c'est
   * donc un CGB BRIDÉ, et sa table dit « non mappé » là où un CGB en mode CGB
   * répondrait.
   *
   * Nous la forçons en modèle CGB — c'est la seule façon d'atteindre les
   * registres qu'elle arbitre par ailleurs ($FF4F, $FF68, $FF6A). Les deux
   * lectures ne peuvent pas être vraies en même temps : le vert exigerait
   * d'émuler le mode de compatibilité, qui est un jalon à lui seul.
   *
   * Ce test garde donc sa valeur, mais change de nature : il ne dit plus « il
   * reste du travail », il dit **jusqu'où** elle va. Reculer, c'est casser un
   * lot déjà fermé.
   */
  it.skipIf(!present(C_ROM))(
    'unused_hwio-C.gb passe tout le plan jusqu\'à $FF69, où le mode de compatibilité le bloque',
    () => {
      const { verdict, failedAt } = runRom(C_ROM, CGB);

      expect(verdict, 'toujours rouge, et pour une raison nommée').toEqual(ECHEC);
      expect(
        failedAt,
        'si ce n\'est plus $FF69, quelque chose a reculé AVANT — masques DMG (lot 1.5), '
        + 'VBK (2), palettes (3) ou registres indocumentés (7)',
      ).toBe(0x69);
    },
  );
});
