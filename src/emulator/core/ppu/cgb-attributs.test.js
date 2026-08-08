import { describe, it, expect } from 'vitest';

import buildPPU, { Fetcher, DMG_COLORS, toRgb555 } from './index';
import buildCGBPPU from './cgb';

/**
 * LOT 4 — L'ÉTIQUETTE DE TUILE, ET LE FOND CGB.
 *
 * L'astuce du CGB tient en une phrase : la carte de tuiles n'a pas bougé d'un
 * octet, on a mis un SECOND TIROIR derrière. À la même adresse, dans la banque 1,
 * un octet dit quelle palette prendre, dans quelle banque va chercher le motif,
 * s'il faut le retourner, et s'il passe devant les sprites.
 *
 * Le trajet du pixel est inchangé. Ce sont les coutures du lot 0 qui rendent
 * autre chose : `tileAttributes` ne rend plus 0, et `patternRow`/`patternBank`/
 * `patternBit` ne sont plus l'identité.
 */

const BCPS = 0xFF68;
const BCPD = 0xFF69;
const VBK = 0xFF4F;
const MAP = 0x9800;

const makeBench = (build) => {
  const ram = new Uint8Array(0x10000);
  const machine = {
    totalCycles: 0, _if: 0,
    // Vitesse simple : les deux montres portent le même nombre (jalon KEY1, lot 0).
    get systemCycles() { return this.totalCycles; },
    get IF() { return this._if; }, set IF(v) { this._if = v; },
    memory: {
      read: (a) => ram[a], write: (a, v) => { ram[a] = v; },
      _read: (a) => ram[a], _write: (a, v) => { ram[a] = v; },
    },
  };
  const ppu = new (build(machine))(Fetcher);
  ppu.write(0xFF40, 0b1001_0001); // écran + fond + adressage 0x8000, carte 0x9800
  ppu.write(0xFF47, 0b1110_0100); // BGP identité (pour le DMG)
  return { ram, ppu };
};

/** Une tuile unie, posée dans la banque voulue. */
const solidTile = (ppu, id, shade, bank = 0) => {
  const previous = ppu.registersMapping[VBK] ? ppu.read(VBK) & 1 : 0;
  if (ppu.registersMapping[VBK]) ppu.write(VBK, bank);
  for (let row = 0; row < 8; row++) {
    ppu.vramWrite(0x8000 + id * 16 + row * 2, (shade & 1) ? 0xFF : 0x00);
    ppu.vramWrite(0x8000 + id * 16 + row * 2 + 1, (shade >> 1) ? 0xFF : 0x00);
  }
  if (ppu.registersMapping[VBK]) ppu.write(VBK, previous);
};

/** Poser l'étiquette d'une case de la carte (banque 1, même adresse). */
const setAttrs = (ppu, cell, attrs) => {
  ppu.write(VBK, 1);
  ppu.vramWrite(MAP + cell, attrs);
  ppu.write(VBK, 0);
};

/** Verser une couleur dans une palette de fond. */
const setBgColor = (ppu, palette, shade, color) => {
  ppu.write(BCPS, 0x80 | (palette * 8 + shade * 2));
  ppu.write(BCPD, color & 0xFF);
  ppu.write(BCPD, (color >> 8) & 0xFF);
};

const cgb = () => makeBench(buildCGBPPU);

describe('l\'étiquette : le second tiroir', () => {
  it('se lit à la MÊME adresse que l\'identifiant, dans la banque 1', () => {
    const { ppu } = cgb();
    setAttrs(ppu, 0, 0x2F);
    expect(ppu.tileAttributes(MAP)).toBe(0x2F);
  });

  it('la banque 0 garde l\'identifiant, intact', () => {
    const { ppu } = cgb();
    ppu.write(VBK, 0);
    ppu.vramWrite(MAP, 0x42);
    setAttrs(ppu, 0, 0xFF);
    expect(ppu.vramReadBank(MAP, 0), 'l\'identifiant n\'a pas bougé').toBe(0x42);
  });

  it('reste 0 en DMG — le neutre', () => {
    expect(makeBench(buildPPU).ppu.tileAttributes(MAP)).toBe(0);
  });
});

describe('ce que l\'étiquette commande', () => {
  it('bits 0-2 : la palette de fond', () => {
    const { ppu } = cgb();
    const rouge = toRgb555(255, 0, 0);
    const bleu = toRgb555(0, 0, 255);
    setBgColor(ppu, 0, 1, rouge);
    setBgColor(ppu, 5, 1, bleu);
    solidTile(ppu, 0, 1);

    setAttrs(ppu, 0, 0);
    ppu.renderLine(0);
    expect(ppu.screen[0], 'palette 0').toBe(rouge);

    setAttrs(ppu, 0, 5);
    ppu.renderLine(0);
    expect(ppu.screen[0], 'palette 5').toBe(bleu);
  });

  it('bit 3 : le motif vient de la banque désignée', () => {
    // La même tuile 1, deux motifs différents dans les deux banques.
    const { ppu } = cgb();
    const c1 = toRgb555(255, 0, 0);
    const c2 = toRgb555(0, 255, 0);
    setBgColor(ppu, 0, 1, c1);
    setBgColor(ppu, 0, 2, c2);
    ppu.write(VBK, 0);
    ppu.vramWrite(MAP, 1);
    ppu.write(VBK, 0);
    solidTile(ppu, 1, 1, 0); // banque 0 : teinte 1
    solidTile(ppu, 1, 2, 1); // banque 1 : teinte 2

    setAttrs(ppu, 0, 0b0000);
    ppu.renderLine(0);
    expect(ppu.screen[0], 'motif en banque 0').toBe(c1);

    setAttrs(ppu, 0, 0b1000);
    ppu.renderLine(0);
    expect(ppu.screen[0], 'motif en banque 1').toBe(c2);
  });

  it('bit 5 : miroir horizontal', () => {
    const { ppu } = cgb();
    for (let s = 0; s < 4; s++) setBgColor(ppu, 0, s, toRgb555(s * 60, 0, 0));
    // une rangée 0,1,2,3,0,1,2,3 : le miroir doit la retourner
    ppu.write(VBK, 0);
    for (let row = 0; row < 8; row++) {
      ppu.vramWrite(0x8000 + row * 2, 0b01010101);
      ppu.vramWrite(0x8000 + row * 2 + 1, 0b00110011);
    }
    const lire = () => [...ppu.screen.slice(0, 8)];

    setAttrs(ppu, 0, 0);
    ppu.renderLine(0);
    const droit = lire();
    setAttrs(ppu, 0, 0b0010_0000);
    ppu.renderLine(0);

    expect(lire(), 'les huit pixels à l\'envers').toEqual([...droit].reverse());
  });

  it('bit 6 : miroir vertical', () => {
    const { ppu } = cgb();
    for (let s = 0; s < 4; s++) setBgColor(ppu, 0, s, toRgb555(s * 60, 0, 0));
    // rangée 0 = teinte 1, rangée 7 = teinte 2, le reste à 0
    ppu.write(VBK, 0);
    ppu.vramWrite(0x8000 + 0, 0xFF);       // rangée 0 : teinte 1
    ppu.vramWrite(0x8000 + 7 * 2 + 1, 0xFF); // rangée 7 : teinte 2
    setAttrs(ppu, 0, 0);
    ppu.renderLine(0);
    const sansMiroir = ppu.screen[0];

    setAttrs(ppu, 0, 0b0100_0000);
    ppu.renderLine(0);
    expect(ppu.screen[0], 'la ligne 0 lit désormais la rangée 7').not.toBe(sansMiroir);
    expect(ppu.screen[0]).toBe(toRgb555(2 * 60, 0, 0));
  });

  it('bit 7 : la priorité du fond, retenue pour le lot 5', () => {
    const { ppu } = cgb();
    solidTile(ppu, 0, 1);
    setAttrs(ppu, 0, 0b1000_0000);
    ppu.renderLine(0);
    expect(ppu.bgPriority[0], 'le plan de priorité retient le bit 7').toBe(1);

    setAttrs(ppu, 0, 0);
    ppu.renderLine(0);
    expect(ppu.bgPriority[0]).toBe(0);
  });

  it('les miroirs se combinent', () => {
    const { ppu } = cgb();
    for (let s = 0; s < 4; s++) setBgColor(ppu, 0, s, toRgb555(s * 60, 0, 0));
    ppu.write(VBK, 0);
    ppu.vramWrite(0x8000 + 0, 0b11110000); // rangée 0, moitié gauche à 1
    setAttrs(ppu, 0, 0b0110_0000);         // X et Y
    ppu.renderLine(7);
    expect(ppu.screen[7 * 160 + 7], 'miroir X : la moitié gauche part à droite')
      .toBe(toRgb555(60, 0, 0));
  });
});

describe('le DMG n\'a pas bougé', () => {
  it('aucune étiquette, aucun miroir, aucune banque', () => {
    const { ppu } = makeBench(buildPPU);
    expect(ppu.patternBank(0xFF), 'toujours la banque 0').toBe(0);
    expect(ppu.patternRow(3, 0xFF), 'jamais de miroir vertical').toBe(3);
    expect(ppu.patternBit(2, 0xFF), 'jamais de miroir horizontal').toBe(5);
    expect(ppu.tilePriority(0xFF), 'jamais de priorité de fond').toBe(0);
  });

  it('son fond passe toujours par BGP', () => {
    const { ppu } = makeBench(buildPPU);
    expect(ppu.backgroundColor(2, 0xFF), 'l\'étiquette est ignorée').toBe(DMG_COLORS[2]);
  });
});
