import { describe, it, expect } from 'vitest';

import buildPPU, { Fetcher, DMG_COLORS, toRgb555 } from './index';
import buildCGBPPU from './cgb';
import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from '../machine';
import { DMG, CGB } from '../models';

/**
 * LOT 3 — LES PALETTES CGB, ET LA SORTIE COULEUR.
 *
 * L'analogie : le CGB ne donne pas 64 adresses à sa RAM de palette, il en donne
 * DEUX — une MEURTRIÈRE. Un registre d'index dit où l'on est, un registre de
 * donnée lit ou écrit là. Le bit 7 de l'index demande d'avancer tout seul après
 * chaque écriture, ce qui permet de verser une palette entière d'affilée sans
 * jamais retoucher l'index.
 *
 * LE PIÈGE : l'auto-incrément n'avance QU'À L'ÉCRITURE. Un émulateur qui avance
 * aussi en lecture décale toutes les palettes d'un cran dès qu'un jeu relit ce
 * qu'il vient d'écrire — et le décalage ne se voit qu'à l'image, longtemps après.
 */

const BCPS = 0xFF68;
const BCPD = 0xFF69;
const OCPS = 0xFF6A;
const OCPD = 0xFF6B;

const makeBench = (build) => {
  const ram = new Uint8Array(0x10000);
  const machine = {
    totalCycles: 0, _if: 0,
    get IF() { return this._if; }, set IF(v) { this._if = v; },
    memory: {
      read: (a) => ram[a], write: (a, v) => { ram[a] = v; },
      _read: (a) => ram[a], _write: (a, v) => { ram[a] = v; },
    },
  };
  return { ram, ppu: new (build(machine))(Fetcher) };
};

const cgb = () => makeBench(buildCGBPPU);

describe('la sortie couleur : RGB555 pour les deux modèles (décision D1)', () => {
  it('le tampon écran porte des couleurs 15 bits, plus des teintes', () => {
    const { ppu } = makeBench(buildPPU);
    expect(ppu.screen.BYTES_PER_ELEMENT, 'deux octets par pixel').toBe(2);
    expect(ppu.screen.length).toBe(160 * 144);
  });

  it('le DMG traverse sa palette DANS le PPU : le front n\'a plus de cas à part', () => {
    const { ppu } = makeBench(buildPPU);
    ppu.write(0xFF47, 0b1110_0100); // BGP identité
    for (let shade = 0; shade < 4; shade++) {
      expect(ppu.backgroundColor(shade, 0), `teinte ${shade}`).toBe(DMG_COLORS[shade]);
    }
  });

  it('les quatre verts DMG sont distincts et tiennent sur 15 bits', () => {
    expect(new Set(DMG_COLORS).size).toBe(4);
    expect(Math.max(...DMG_COLORS)).toBeLessThanOrEqual(0x7FFF);
  });
});

describe('la meurtrière : index et donnée', () => {
  it('n\'existe pas en DMG', () => {
    const { ppu } = makeBench(buildPPU);
    for (const addr of [BCPS, BCPD, OCPS, OCPD]) {
      expect(ppu.registersMapping[addr], `${addr.toString(16)} absent`).toBeUndefined();
    }
  });

  it('le bit 6 de l\'index se lit à 1, des deux côtés', () => {
    // `unused_hwio-C` l'arbitre : test $FF68 %01000000 et test $FF6A %01000000.
    const { ppu } = cgb();
    for (const spec of [BCPS, OCPS]) {
      ppu.write(spec, 0x00);
      expect(ppu.read(spec) & 0x40, `${spec.toString(16)} bit 6`).toBe(0x40);
      ppu.write(spec, 0xFF);
      expect(ppu.read(spec) & 0x40).toBe(0x40);
    }
  });

  it('l\'index retient six bits, l\'auto-incrément le septième', () => {
    const { ppu } = cgb();
    ppu.write(BCPS, 0x80 | 0x1F);
    expect(ppu.read(BCPS) & 0x3F, 'index conservé').toBe(0x1F);
    expect(ppu.read(BCPS) & 0x80, 'auto-incrément armé').toBe(0x80);
  });

  it('la donnée écrite à un index se relit au même index', () => {
    const { ppu } = cgb();
    ppu.write(BCPS, 5);
    ppu.write(BCPD, 0xAB);
    ppu.write(BCPS, 5);
    expect(ppu.read(BCPD)).toBe(0xAB);
  });
});

describe('l\'auto-incrément', () => {
  it('avance après une ÉCRITURE : huit écritures remplissent une palette', () => {
    const { ppu } = cgb();
    ppu.write(BCPS, 0x80 | 0); // index 0, auto
    for (let i = 0; i < 8; i++) ppu.write(BCPD, 0x10 + i);

    for (let i = 0; i < 8; i++) {
      ppu.write(BCPS, i);
      expect(ppu.read(BCPD), `octet ${i}`).toBe(0x10 + i);
    }
  });

  it('N\'AVANCE PAS après une lecture — le piège du lot', () => {
    // Un curseur qui avance aussi en lecture décale toutes les palettes dès
    // qu'un jeu relit ce qu'il vient d'écrire, et ça ne se voit qu'à l'image.
    const { ppu } = cgb();
    ppu.write(BCPS, 0x80 | 3);
    ppu.read(BCPD);
    ppu.read(BCPD);
    expect(ppu.read(BCPS) & 0x3F, 'le curseur n\'a pas bougé').toBe(3);
  });

  it('reste immobile quand le bit 7 est éteint', () => {
    const { ppu } = cgb();
    ppu.write(BCPS, 3); // sans auto
    ppu.write(BCPD, 0x11);
    ppu.write(BCPD, 0x22);
    expect(ppu.read(BCPS) & 0x3F).toBe(3);
    expect(ppu.read(BCPD), 'la seconde écriture a écrasé la première').toBe(0x22);
  });

  it('boucle sur 64 sans emporter le bit d\'auto-incrément', () => {
    const { ppu } = cgb();
    ppu.write(BCPS, 0x80 | 0x3F); // dernier octet
    ppu.write(BCPD, 0x99);
    expect(ppu.read(BCPS) & 0x3F, 'retour à 0').toBe(0);
    expect(ppu.read(BCPS) & 0x80, 'l\'auto-incrément survit au tour').toBe(0x80);
  });
});

describe('les couleurs : huit palettes de quatre, en RGB555 petit-boutiste', () => {
  const poser = (ppu, spec, data, palette, shade, color) => {
    ppu.write(spec, 0x80 | (palette * 8 + shade * 2));
    ppu.write(data, color & 0xFF);
    ppu.write(data, (color >> 8) & 0xFF);
  };

  it('recompose la couleur depuis ses deux octets', () => {
    const { ppu } = cgb();
    const rouge = toRgb555(255, 0, 0);
    poser(ppu, BCPS, BCPD, 0, 1, rouge);
    expect(ppu.bgPalettes.color(0, 1)).toBe(rouge);
  });

  it('huit palettes de quatre couleurs, sans se marcher dessus', () => {
    const { ppu } = cgb();
    for (let p = 0; p < 8; p++) {
      for (let s = 0; s < 4; s++) poser(ppu, BCPS, BCPD, p, s, toRgb555(p * 30, s * 80, 0));
    }
    for (let p = 0; p < 8; p++) {
      for (let s = 0; s < 4; s++) {
        expect(ppu.bgPalettes.color(p, s), `palette ${p} teinte ${s}`).toBe(toRgb555(p * 30, s * 80, 0));
      }
    }
  });

  it('le bit 15 est ignoré : une couleur tient sur quinze bits', () => {
    const { ppu } = cgb();
    poser(ppu, BCPS, BCPD, 0, 0, 0xFFFF);
    expect(ppu.bgPalettes.color(0, 0)).toBe(0x7FFF);
  });

  it('fond et objets sont deux RAM distinctes', () => {
    // Deux meurtrières, deux tiroirs : écrire d'un côté ne doit rien changer de
    // l'autre, même à l'index identique.
    const { ppu } = cgb();
    poser(ppu, BCPS, BCPD, 0, 0, toRgb555(255, 0, 0));
    poser(ppu, OCPS, OCPD, 0, 0, toRgb555(0, 0, 255));

    expect(ppu.bgPalettes.color(0, 0)).toBe(toRgb555(255, 0, 0));
    expect(ppu.objPalettes.color(0, 0)).toBe(toRgb555(0, 0, 255));
  });
});

describe('de bout en bout : par le bus', () => {
  const instructions = buildInstructions();

  const makeMachine = (model) => {
    const serial = { read() {}, write() {}, echo() {} };
    const memory = buildMemory(undefined, serial);
    const cpu = new CPU(memory);
    const Decoder = buildDecoder(cpu, instructions);
    const Machine = buildMachine(memory, cpu, new Decoder(), { onTick() {}, start() {}, stop() {} }, serial);
    const machine = new Machine(model);
    machine.plugCartridge({ header: { supportsCgb: model === CGB }, mbc: null, read: () => 0, write: () => {} });
    return machine;
  };

  it('les quatre registres sont routés en CGB — ils tombaient dans les trous', () => {
    const { memory } = makeMachine(CGB);
    memory.write(BCPS, 0x80);
    memory.write(BCPD, 0x5A);
    memory.write(BCPS, 0x00);
    expect(memory.read(BCPD), 'relu par le bus').toBe(0x5A);
  });

  it('ils restent des trous en DMG', () => {
    const { memory } = makeMachine(DMG);
    for (const addr of [BCPS, BCPD, OCPS, OCPD]) {
      memory.write(addr, 0x00);
      expect(memory.read(addr), `${addr.toString(16)} reste vide`).toBe(0xFF);
    }
  });
});
