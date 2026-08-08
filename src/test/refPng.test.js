import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { decodePalettePng, toRgb555, comparePixels } from './refPng';

/**
 * L'OUTIL AVANT L'ORACLE.
 *
 * `reference.png` va servir de juge aux lots 4 et 5. Un décodeur qui se trompe
 * transformerait un émulateur juste en émulateur rouge, et on chercherait le bug
 * dans le PPU pendant des heures. Le décodeur se teste donc AVANT de juger quoi
 * que ce soit — sur des propriétés vérifiables sans rien connaître de l'image :
 * ses dimensions, sa palette, la cohérence de sa sortie.
 */

const REFERENCE = resolve(process.cwd(), 'src/test/fixtures/reference.png');

describe.skipIf(!existsSync(REFERENCE))('le décodeur des images de référence', () => {
  it('lit une dalle Game Boy : 160x144', () => {
    const { width, height, indices } = decodePalettePng(REFERENCE);
    expect([width, height]).toEqual([160, 144]);
    expect(indices.length).toBe(160 * 144);
  });

  it('rend une palette, et tous les index y pointent', () => {
    const { palette, indices } = decodePalettePng(REFERENCE);
    expect(palette.length, 'cgb-acid2 : huit couleurs').toBe(8);
    for (const [r, g, b] of palette) {
      expect([r, g, b].every((c) => c >= 0 && c <= 255), 'composantes valides').toBe(true);
    }
    const max = Math.max(...indices);
    expect(max, 'aucun index ne sort de la palette').toBeLessThan(palette.length);
  });

  it("l'image n'est ni vide ni unie", () => {
    // Le même garde-fou que pour nos propres instantanés : une image décodée de
    // travers a de bonnes chances de sortir uniforme, et passerait tout le reste.
    const { indices } = decodePalettePng(REFERENCE);
    expect(new Set(indices).size).toBeGreaterThan(2);
  });

  it('toRgb555 rend un pixel par case, dans les bornes de 15 bits', () => {
    const { width, height, pixels } = toRgb555(REFERENCE);
    expect(pixels.length).toBe(width * height);
    expect(Math.max(...pixels)).toBeLessThanOrEqual(0x7fff);
  });

  it('toRgb555 préserve les frontières : deux index différents restent différents', () => {
    // Le repli le plus vicieux d'un décodeur cassé est de tout ramener à une
    // seule couleur. On vérifie que la palette reste distinguable après RGB555.
    const { palette } = decodePalettePng(REFERENCE);
    const encoded = palette.map(([r, g, b]) => ((b >> 3) << 10) | ((g >> 3) << 5) | (r >> 3));
    expect(new Set(encoded).size, 'huit couleurs, huit valeurs RGB555').toBe(palette.length);
  });

  describe('comparePixels : le compteur qui servira de mesure', () => {
    it('deux images identiques : aucun écart', () => {
      const { pixels } = toRgb555(REFERENCE);
      expect(comparePixels(pixels, pixels).wrong).toBe(0);
    });

    it('compte les écarts et situe le premier', () => {
      const { pixels } = toRgb555(REFERENCE);
      const abime = Uint16Array.from(pixels);
      abime[0] = pixels[0] ^ 0x7fff;
      abime[161] = pixels[161] ^ 0x7fff;

      const { wrong, first } = comparePixels(abime, pixels);
      expect(wrong).toBe(2);
      expect([first.x, first.y], 'le premier écart, en coordonnées écran').toEqual([0, 0]);
    });
  });
});
