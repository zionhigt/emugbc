import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import buildCartridge from '../cartridge/Cartridge';
import { CGB } from '../models';
import { toRgb555 } from '../ppu/index';

/**
 * MAGENTESTS — trois ROMs CGB qui rendent leur verdict EN IMAGE.
 *
 * Pourquoi elles sont là. La règle d'oracle du cahier CGB (§3) demande que
 * chaque lot finisse sur quelque chose d'extérieur à ma tête. Les lots 5 et 6
 * n'avaient rien de tel dans les fixtures : `cgb-acid2` couvre le rendu entier
 * mais ne dit pas QUELLE règle a lâché, et le HDMA n'était arbitré par rien du
 * tout — le lot 6 serait parti sur des TU écrits contre pandocs, c'est-à-dire
 * verts parce qu'ils encodent ma lecture.
 *
 * Ces trois-là visent chacune une règle et une seule, et leur verdict tient dans
 * ce qu'elles peignent :
 *
 *   hblank_vram_dma       « The screen should be all green! »
 *   bg_oam_priority       cinq carrés verts, trois mi-verts mi-bleus, aucune
 *                         ligne rouge
 *   oam_internal_priority deux paires de triangles qui SE TOUCHENT
 *
 * Elles viennent de github.com/alloncm/MagenTests (MIT, voir le LICENSE déposé
 * à côté d'elles), version 0.5.0.
 */

const FIXTURES = resolve(process.cwd(), 'src/test/fixtures/magen');
const FRAMES = 200;

// Les couleurs que les ROMs chargent dans leurs palettes, en RGB555.
const BLANC = toRgb555(255, 255, 255);
const ROUGE = toRgb555(255, 0, 0);
const VERT = toRgb555(0, 255, 0);
const BLEU = toRgb555(0, 0, 255);

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

const rom = (name) => resolve(FIXTURES, `${name}.gbc`);

const runRom = (name) => {
  const serial = { output: [], read() {}, write() {}, echo() {} };
  const clock = buildManivelle();
  const memory = buildMemory(undefined, serial);
  const cpu = new CPU(memory);
  const Decoder = buildDecoder(cpu, instructions);
  const Machine = buildMachine(memory, cpu, new Decoder(), clock, serial);
  const machine = new Machine(CGB);
  machine.plugCartridge(new Cartridge(new Uint8Array(readFileSync(rom(name)))));
  for (let i = 0; i < FRAMES; i++) clock.tick();
  return machine.ppu.screen;
};

/** Combien de pixels de chaque couleur, du plus fréquent au plus rare. */
const census = (screen) => {
  const counts = new Map();
  for (const color of screen) counts.set(color, (counts.get(color) ?? 0) + 1);
  return counts;
};

const describeColors = (counts) => [...counts]
  .map(([color, n]) => `${color.toString(16).padStart(4, '0')}×${n}`)
  .join(' ');

describe.skipIf(!existsSync(rom('hblank_vram_dma')))('hblank_vram_dma : le HDMA du lot 6', () => {
  /**
   * CE QUE LA ROM FAIT, et pourquoi elle est un bon juge. Elle peint tout
   * l'écran en ROUGE, puis lance un transfert HBlank qui remplace la carte de
   * tuiles par des tuiles VERTES, et attend en scrutant HDMA5 qu'il soit fini.
   * Elle en lance ensuite un second, BLEU, et se met immédiatement en `halt` —
   * celui-là ne doit jamais arriver, puisqu'un CPU endormi gèle le transfert.
   *
   * Trois choses tombent donc d'un coup : le transfert HBlank existe, HDMA5 se
   * relit correctement, et le `halt` le gèle. Rouge = le premier n'a pas eu
   * lieu ; bleu = le second a eu lieu alors qu'il ne devait pas.
   */
  it('peint l\'écran entièrement en vert', () => {
    const screen = runRom('hblank_vram_dma');
    const counts = census(screen);

    expect(counts.get(ROUGE), 'rouge = le transfert HBlank n\'a pas eu lieu').toBeUndefined();
    expect(counts.get(BLEU), 'bleu = le `halt` n\'a pas gelé le second transfert').toBeUndefined();
    expect(counts.get(VERT), `écran : ${describeColors(counts)}`).toBe(160 * 144);
  });
});

describe.skipIf(!existsSync(rom('bg_oam_priority')))('bg_oam_priority : la table du lot 5', () => {
  /**
   * Huit carrés de 8×8, un par combinaison des trois drapeaux de priorité
   * (LCDC bit 0, bit 7 de l'étiquette de tuile, bit 7 des attributs OAM). Cinq
   * doivent finir tout verts — l'objet passe — et trois mi-verts mi-bleus : le
   * fond reprend la moitié basse. Le rouge est la couleur de l'erreur, elle ne
   * doit apparaître nulle part.
   */
  it('cinq carrés verts, trois mi-verts mi-bleus, aucune ligne rouge', () => {
    const counts = census(runRom('bg_oam_priority'));
    const carre = 8 * 8;

    expect(counts.get(ROUGE), 'la ROM peint en rouge ce qu\'elle juge faux').toBeUndefined();
    expect(counts.get(VERT), `5 carrés pleins + 3 demis : ${describeColors(counts)}`)
      .toBe(5 * carre + 3 * (carre / 2));
    expect(counts.get(BLEU), '3 demi-carrés').toBe(3 * (carre / 2));
  });
});

describe.skipIf(!existsSync(rom('oam_internal_priority')))(
  'oam_internal_priority : l\'ordre entre objets, en CGB',
  () => {
    /**
     * CE QUE LA ROM POSE, lu dans sa source plutôt que deviné à l'image. Deux
     * motifs de triangle rectangle, l'un en teinte 1 (vert), l'autre en teinte 2
     * (rouge), et quatre objets qui les portent deux par deux :
     *
     *     Y=40 X=46 tuile rouge (index 0)    Y=60 X=40 tuile verte (index 2)
     *     Y=40 X=40 tuile verte (index 1)    Y=60 X=46 tuile rouge (index 3)
     *
     * Les deux paires sont la même image, avec l'ordre OAM inversé. Elles
     * doivent donc rendre PAREIL, et surtout : leurs colonnes se recouvrent sur
     * six pixels, où le motif prioritaire est TRANSPARENT. C'est là que tout se
     * joue — un PPU qui réserverait la colonne à l'objet prioritaire sans
     * regarder si son pixel est opaque laisserait un trou blanc, et les deux
     * triangles cesseraient de se toucher. C'est le « connected or touching »
     * du dépôt.
     */
    const PAIRES = [24, 44]; // les deux ordonnées écran (Y de l'OAM moins 16)

    it('les deux moitiés de chaque paire se touchent, et les deux paires sont identiques', () => {
      const screen = runRom('oam_internal_priority');
      const counts = census(screen);
      expect([...counts.keys()].sort(), `blanc, vert et rouge : ${describeColors(counts)}`)
        .toEqual([BLANC, ROUGE, VERT].sort());

      // Le motif attendu, reconstruit depuis les tuiles de la ROM : à la rangée
      // r du triangle, le vert court de 39-r à 38 et le rouge de 45-r à 44.
      const attendu = [];
      for (let r = 0; r < 8; r++) {
        let ligne = '';
        for (let x = 30; x < 48; x++) {
          const vert = r >= 1 && r <= 6 && x >= 39 - r && x <= 38;
          const rouge = r >= 1 && r <= 6 && x >= 45 - r && x <= 44;
          ligne += vert ? 'V' : rouge ? 'R' : '.';
        }
        attendu.push(ligne);
      }

      const nom = (color) => (color === VERT ? 'V' : color === ROUGE ? 'R' : '.');
      for (const y0 of PAIRES) {
        const rendu = [];
        for (let r = 0; r < 8; r++) {
          let ligne = '';
          for (let x = 30; x < 48; x++) ligne += nom(screen[(y0 + r) * 160 + x]);
          rendu.push(ligne);
        }
        expect(rendu, `la paire en y=${y0}`).toEqual(attendu);
      }

      expect(
        attendu[6],
        'la rangée la plus large : les deux triangles se touchent, sans blanc entre eux',
      ).toContain('VR');
    });
  },
);
