import { describe, it, expect } from 'vitest';

import buildJoypad from './index';

const Joypad = buildJoypad();
const make = () => new Joypad();

// La sélection de colonne, écrite par le jeu (actif bas) :
const SELECT_DIR = 0x20;  // bit 5 = 1 (boutons OFF), bit 4 = 0 (directions ON)
const SELECT_BTN = 0x10;  // bit 5 = 0 (boutons ON),   bit 4 = 1 (directions OFF)
const SELECT_BOTH = 0x00; // les deux colonnes sélectionnées

const low = (jp) => jp.read(0xff00) & 0x0f; // le nibble bas = les 4 boutons lus

describe('Joypad : la matrice 0xFF00, actif bas (0 = pressé)', () => {
  it('expose read, write, onPress, onRelease', () => {
    const jp = make();
    for (const m of ['read', 'write', 'onPress', 'onRelease']) {
      expect(typeof jp[m], `${m} manque`).toBe('function');
    }
  });

  it('au repos : aucune touche pressée → le nibble bas est tout à 1, quelle que soit la colonne', () => {
    const jp = make();
    jp.write(0xff00, SELECT_DIR);
    expect(low(jp), 'directions, rien pressé').toBe(0xf);
    jp.write(0xff00, SELECT_BTN);
    expect(low(jp), 'boutons, rien pressé').toBe(0xf);
  });

  describe('colonne DIRECTIONS (bit 4 = 0) : bit0=→ bit1=← bit2=↑ bit3=↓', () => {
    it.each([
      ['right', 0], ['left', 1], ['up', 2], ['down', 3],
    ])('presser "%s" met le bit %i à 0 (et lui seul)', (key, bit) => {
      const jp = make();
      jp.write(0xff00, SELECT_DIR);
      jp.onPress(key);
      expect(low(jp) & (1 << bit), `${key} → bit ${bit} bas`).toBe(0);
      expect(low(jp) | (1 << bit), 'seul ce bit tombe, les 3 autres restent hauts').toBe(0xf);
    });
  });

  describe('colonne BOUTONS (bit 5 = 0) : bit0=A bit1=B bit2=Select bit3=Start', () => {
    it.each([
      ['a', 0], ['b', 1], ['select', 2], ['start', 3],
    ])('presser "%s" met le bit %i à 0 (et lui seul)', (key, bit) => {
      const jp = make();
      jp.write(0xff00, SELECT_BTN);
      jp.onPress(key);
      expect(low(jp) & (1 << bit), `${key} → bit ${bit} bas`).toBe(0);
      expect(low(jp) | (1 << bit), 'seul ce bit tombe').toBe(0xf);
    });
  });

  it('ISOLATION : la colonne NON sélectionnée ne révèle rien', () => {
    const jp = make();
    jp.onPress('a'); // A est un BOUTON
    jp.write(0xff00, SELECT_DIR); // mais on lit les DIRECTIONS
    expect(low(jp), 'A ne doit PAS apparaître dans la colonne directions').toBe(0xf);
    jp.write(0xff00, SELECT_BTN); // on bascule sur les boutons
    expect(low(jp) & 0b0001, 'là, A se voit enfin : bit 0 bas').toBe(0);
  });

  it('l\'état physique SURVIT à la sélection : presser puis re-sélectionner ne perd pas l\'appui', () => {
    const jp = make();
    jp.write(0xff00, SELECT_DIR);
    jp.onPress('left');
    jp.write(0xff00, SELECT_BTN); // le jeu re-sélectionne (il le fait sans arrêt)
    jp.write(0xff00, SELECT_DIR);
    expect(low(jp) & 0b0010, '← est toujours pressé après les ré-écritures de sélection').toBe(0);
  });

  it('ET filaire : deux colonnes sélectionnées, ← (dir, bit 1) tire le bit 1', () => {
    const jp = make();
    jp.write(0xff00, SELECT_BOTH);
    jp.onPress('left');
    expect(low(jp) & 0b0010, 'bit 1 bas car ← est pressé (colonne dir)').toBe(0);
  });

  it('onRelease relève le bit', () => {
    const jp = make();
    jp.write(0xff00, SELECT_DIR);
    jp.onPress('down');
    expect(low(jp) & 0b1000, 'pressé').toBe(0);
    jp.onRelease('down');
    expect(low(jp), 'relâché → tout à 1').toBe(0xf);
  });

  it('une touche inconnue est ignorée sans planter', () => {
    const jp = make();
    expect(() => jp.onPress('turbo'), 'pas dans KEYS').not.toThrow();
  });
});
