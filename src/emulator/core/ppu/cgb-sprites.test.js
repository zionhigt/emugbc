import { describe, it, expect } from 'vitest';

import buildPPU, { Fetcher, DMG_COLORS, BLANK_COLOR, toRgb555 } from './index';
import buildCGBPPU from './cgb';
import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from '../machine';
import { DMG, CGB } from '../models';

/**
 * LOT 5 — LES SPRITES CGB, ET LA TABLE DE PRIORITÉS.
 *
 * Trois choses distinctes, qu'il vaut mieux ne pas confondre :
 *
 * 1. CE QU'ON LIT — un sprite CGB choisit sa palette sur les bits 0-2 de ses
 *    attributs (huit palettes d'objet, OBP0/OBP1 ignorés) et va chercher son
 *    motif dans la banque que désigne le bit 3. Même geste qu'au lot 4 pour le
 *    fond, appliqué à l'autre couche.
 *
 * 2. QUI PASSE DEVANT QUI, ENTRE OBJETS — en DMG le plus petit X gagne, en CGB
 *    c'est l'index OAM, sauf si OPRI (0xFF6C) réclame le comportement DMG.
 *
 * 3. QUI PASSE DEVANT LE FOND — une table à trois entrées : LCDC bit 0, le bit 7
 *    de l'étiquette de tuile, le bit 7 des attributs OAM. C'est la règle qu'on
 *    croit connaître : elle est recopiée ici depuis pandocs, ligne par ligne,
 *    plutôt que résumée en une condition qu'on croirait équivalente.
 *
 * Et un piège qui vaut pour LES DEUX modèles : la priorité entre objets se
 * résout AVANT qu'on regarde le fond. Le pixel d'objet retenu est le premier
 * opaque dans l'ordre de priorité, son bit « BG over OBJ » n'entre en jeu
 * qu'ensuite — un objet prioritaire qui perd contre le fond MASQUE donc les
 * objets de moindre priorité au lieu de leur laisser la place.
 */

const BCPS = 0xFF68;
const BCPD = 0xFF69;
const OCPS = 0xFF6A;
const OCPD = 0xFF6B;
const OPRI = 0xFF6C;
const VBK = 0xFF4F;
const LCDC = 0xFF40;
const MAP = 0x9800;
const OAM = 0xFE00;

/** écran + objets + LCDC bit 0 + adressage 0x8000, carte 0x9800 */
const LCDC_BASE = 0b1001_0011;

// Des couleurs qu'on reconnaît à l'œil dans un message d'échec, et qu'aucun
// chemin DMG ne peut produire par accident.
const ROUGE = toRgb555(255, 0, 0);
const VERT = toRgb555(0, 255, 0);
const BLEU = toRgb555(0, 0, 255);
const JAUNE = toRgb555(255, 255, 0);
const CYAN = toRgb555(0, 255, 255);

const makeBench = (build, lcdc = LCDC_BASE) => {
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
  ppu.write(LCDC, lcdc);
  ppu.write(0xFF47, 0b1110_0100); // BGP identité (le DMG)
  ppu.write(0xFF48, 0b1110_0100); // OBP0 identité
  ppu.write(0xFF49, 0b1110_0100); // OBP1 identité
  return { ram, ppu };
};

const cgb = (lcdc) => makeBench(buildCGBPPU, lcdc);
const dmg = (lcdc) => makeBench(buildPPU, lcdc);

const hasVBK = (ppu) => Boolean(ppu.registersMapping[VBK]);

/** Une tuile unie, posée dans la banque voulue. */
const solidTile = (ppu, id, shade, bank = 0) => {
  if (hasVBK(ppu)) ppu.write(VBK, bank);
  for (let row = 0; row < 8; row++) {
    ppu.vramWrite(0x8000 + id * 16 + row * 2, (shade & 1) ? 0xFF : 0x00);
    ppu.vramWrite(0x8000 + id * 16 + row * 2 + 1, (shade >> 1) ? 0xFF : 0x00);
  }
  if (hasVBK(ppu)) ppu.write(VBK, 0);
};

/** L'étiquette d'une case de la carte : banque 1, même adresse. */
const setAttrs = (ppu, cell, attrs) => {
  ppu.write(VBK, 1);
  ppu.vramWrite(MAP + cell, attrs);
  ppu.write(VBK, 0);
};

const setColor = (ppu, spec, data, palette, shade, color) => {
  ppu.write(spec, 0x80 | (palette * 8 + shade * 2));
  ppu.write(data, color & 0xFF);
  ppu.write(data, (color >> 8) & 0xFF);
};
const setBgColor = (ppu, palette, shade, color) => setColor(ppu, BCPS, BCPD, palette, shade, color);
const setObjColor = (ppu, palette, shade, color) => setColor(ppu, OCPS, OCPD, palette, shade, color);

/** Poser un objet dans l'OAM. x et y sont les coordonnées ÉCRAN (+8 / +16 faits ici). */
const putSprite = (ram, index, { x, y = 0, tile = 1, attrs = 0 }) => {
  ram[OAM + index * 4] = y + 16;
  ram[OAM + index * 4 + 1] = x + 8;
  ram[OAM + index * 4 + 2] = tile;
  ram[OAM + index * 4 + 3] = attrs;
};

describe('OPRI (0xFF6C) : quel ordre de priorité entre objets', () => {
  it('n\'existe qu\'en CGB', () => {
    expect(cgb().ppu.registersMapping[OPRI], 'routé par bindAddresses, comme VBK').toBeDefined();
    expect(dmg().ppu.registersMapping[OPRI], 'le DMG ne le connaît pas').toBeUndefined();
  });

  it('un seul bit utile, les sept autres se lisent à 1', () => {
    const { ppu } = cgb();
    ppu.write(OPRI, 0x00);
    expect(ppu.read(OPRI)).toBe(0xFE);
    ppu.write(OPRI, 0xFF);
    expect(ppu.read(OPRI)).toBe(0xFF);
  });

  it('vaut 0 au démarrage : la priorité CGB, celle de l\'index OAM', () => {
    // Le boot ROM du CGB écrit 0 pour un jeu CGB, et 1 pour un jeu DMG qu'il
    // fait tourner en compatibilité. On démarre en CGB, donc 0.
    expect(cgb().ppu.read(OPRI) & 1).toBe(0);
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

    it('0xFF6C est routé au PPU en CGB — il tombait dans les trous', () => {
      const { memory } = makeMachine(CGB);
      memory.write(OPRI, 0x01);
      expect(memory.read(OPRI), 'relu par le bus').toBe(0xFF);
      memory.write(OPRI, 0x00);
      expect(memory.read(OPRI)).toBe(0xFE);
    });

    it('il reste un trou en DMG', () => {
      const { memory } = makeMachine(DMG);
      memory.write(OPRI, 0x00);
      expect(memory.read(OPRI), 'personne derrière : 0xFF').toBe(0xFF);
    });
  });
});

describe('ce que les attributs OAM commandent en CGB', () => {
  it('bits 0-2 : l\'une des huit palettes d\'objet', () => {
    const { ram, ppu } = cgb();
    setObjColor(ppu, 0, 1, ROUGE);
    setObjColor(ppu, 5, 1, BLEU);
    solidTile(ppu, 1, 1);
    putSprite(ram, 0, { x: 0, attrs: 5 });
    ppu.renderLine(0);

    expect(ppu.screen[0], 'palette d\'objet 5').toBe(BLEU);
  });

  it('OBP0 et OBP1 sont ignorés — le bit 4 ne choisit plus rien', () => {
    const { ram, ppu } = cgb();
    setObjColor(ppu, 0, 1, ROUGE);
    solidTile(ppu, 1, 1);
    putSprite(ram, 0, { x: 0, attrs: 0b0001_0000 }); // « OBP1 » en DMG
    ppu.renderLine(0);

    expect(ppu.screen[0], 'la palette vient des bits 0-2, pas du bit 4').toBe(ROUGE);
    expect(DMG_COLORS.includes(ppu.screen[0]), 'aucune teinte DMG à l\'écran').toBe(false);
  });

  it('bit 3 : le motif vient de la banque désignée', () => {
    const { ram, ppu } = cgb();
    setObjColor(ppu, 0, 1, ROUGE);
    setObjColor(ppu, 0, 2, VERT);
    solidTile(ppu, 1, 1, 0); // banque 0 : teinte 1
    solidTile(ppu, 1, 2, 1); // banque 1 : teinte 2

    putSprite(ram, 0, { x: 0, attrs: 0b0000 });
    ppu.renderLine(0);
    expect(ppu.screen[0], 'motif en banque 0').toBe(ROUGE);

    const second = cgb();
    setObjColor(second.ppu, 0, 1, ROUGE);
    setObjColor(second.ppu, 0, 2, VERT);
    solidTile(second.ppu, 1, 1, 0);
    solidTile(second.ppu, 1, 2, 1);
    putSprite(second.ram, 0, { x: 0, attrs: 0b1000 });
    second.ppu.renderLine(0);
    expect(second.ppu.screen[0], 'motif en banque 1').toBe(VERT);
  });

  it('le DMG, lui, n\'a pas de banque d\'objet', () => {
    expect(dmg().ppu.spriteBank({ attrs: 0xFF }), 'toujours la banque 0').toBe(0);
  });
});

describe('l\'ordre entre objets : X en DMG, index OAM en CGB', () => {
  // Deux objets qui se chevauchent, et dont X et index NE DISENT PAS la même
  // chose : l'objet 0 est plus à droite (X plus grand), l'objet 1 plus à gauche.
  // Zone commune : x = 4 à 7.
  const deuxObjets = ({ ram, ppu }) => {
    setObjColor(ppu, 0, 1, ROUGE); // objet 0
    setObjColor(ppu, 1, 1, BLEU);  // objet 1
    solidTile(ppu, 1, 1);
    putSprite(ram, 0, { x: 4, attrs: 0 });
    putSprite(ram, 1, { x: 0, attrs: 1 });
    ppu.renderLine(0);
    return ppu.screen[4];
  };

  it('CGB : l\'index OAM tranche, le X ne compte plus', () => {
    expect(deuxObjets(cgb()), 'l\'objet 0 est le premier dans l\'OAM').toBe(ROUGE);
  });

  it('CGB avec OPRI = 1 : on retombe sur l\'ordre DMG, le plus petit X gagne', () => {
    const bench = cgb();
    bench.ppu.write(OPRI, 1);
    expect(deuxObjets(bench), 'l\'objet 1 est le plus à gauche').toBe(BLEU);
  });

  it('DMG : le plus petit X gagne, l\'index départage les égalités', () => {
    const { ram, ppu } = dmg();
    solidTile(ppu, 1, 1);
    solidTile(ppu, 2, 2);
    putSprite(ram, 0, { x: 4, tile: 2 });
    putSprite(ram, 1, { x: 0, tile: 1 });
    ppu.renderLine(0);

    expect(ppu.screen[4], 'l\'objet 1, plus à gauche').toBe(DMG_COLORS[1]);
  });
});

/**
 * LA TABLE DE PRIORITÉS FOND/OBJET EN CGB.
 *
 * Recopiée de pandocs (« BG-to-OBJ Priority in CGB Mode ») sans être résumée :
 * c'est exactement le genre de règle dont une reformulation « équivalente »
 * cesse de l'être dans un cas sur huit.
 *
 *   LCDC.0 | OAM.7 | BG attr.7 | priorité
 *      0   |   x   |     x     | OBJ
 *      1   |   0   |     0     | OBJ
 *      1   |   0   |     1     | fond si sa teinte est 1-3, sinon OBJ
 *      1   |   1   |     0     | fond si sa teinte est 1-3, sinon OBJ
 *      1   |   1   |     1     | fond si sa teinte est 1-3, sinon OBJ
 *
 * Le piège de lecture, nommé par pandocs lui-même : le bit 7 des attributs OAM
 * donne la priorité à l'objet quand il est À ZÉRO, pas quand il est à 1.
 */
describe('la table de priorités fond/objet (CGB)', () => {
  const CAS = [
    // lcdc0, oam7, bgAttr7, teinte du fond, gagnant
    [0, 0, 0, 2, 'objet'],
    [0, 0, 1, 2, 'objet'],
    [0, 1, 0, 2, 'objet'],
    [0, 1, 1, 2, 'objet'],
    [1, 0, 0, 2, 'objet'],
    [1, 0, 1, 2, 'fond'],
    [1, 1, 0, 2, 'fond'],
    [1, 1, 1, 2, 'fond'],
    // teinte 0 : le fond est transparent, l'objet passe quoi qu'il arrive
    [1, 0, 1, 0, 'objet'],
    [1, 1, 0, 0, 'objet'],
    [1, 1, 1, 0, 'objet'],
  ];

  it.each(CAS)(
    'LCDC.0=%i OAM.7=%i étiquette.7=%i fond teinte %i -> %s',
    (lcdc0, oam7, bg7, teinte, gagnant) => {
      const { ram, ppu } = cgb(lcdc0 ? LCDC_BASE : LCDC_BASE & ~1);
      setBgColor(ppu, 0, teinte, JAUNE);
      setObjColor(ppu, 0, 1, ROUGE);
      solidTile(ppu, 0, teinte);   // la tuile de fond de la case 0
      solidTile(ppu, 1, 1);        // le motif de l'objet
      setAttrs(ppu, 0, bg7 << 7);
      putSprite(ram, 0, { x: 0, attrs: oam7 << 7 });
      ppu.renderLine(0);

      expect(ppu.screen[0]).toBe(gagnant === 'objet' ? ROUGE : JAUNE);
    },
  );

  it('LCDC.0 éteint n\'efface plus la ligne : le fond reste dessiné, il perd seulement la priorité', () => {
    // C'est le sens du bit qui change, pas le fond qui disparaît. Le DMG blanchit,
    // le CGB non — et confondre les deux peignait une bande entière en vert.
    const { ppu } = cgb(LCDC_BASE & ~1);
    setBgColor(ppu, 0, 2, JAUNE);
    solidTile(ppu, 0, 2);
    ppu.renderLine(0);

    expect(ppu.screen[0], 'le fond est peint, pas blanchi').toBe(JAUNE);
    expect(ppu.screen[0]).not.toBe(BLANK_COLOR);
  });

  it('la fenêtre reste commandée par le seul bit 5', () => {
    const { ppu } = cgb(LCDC_BASE & ~1);
    setBgColor(ppu, 0, 1, JAUNE);
    setBgColor(ppu, 1, 1, CYAN);
    solidTile(ppu, 0, 1);
    setAttrs(ppu, 0, 0);
    ppu.write(LCDC, (LCDC_BASE & ~1) | 0b0010_0000); // bit 5 : fenêtre
    ppu.write(0xFF4A, 0); // WY
    ppu.write(0xFF4B, 7); // WX = 7 : la fenêtre part de x = 0
    setAttrs(ppu, 0, 1);  // la case 0 de la carte, vue par la fenêtre : palette 1
    ppu.renderLine(0);

    expect(ppu.screen[0], 'LCDC.0 bas n\'empêche pas la fenêtre en CGB').toBe(CYAN);
  });
});

/**
 * LE MASQUAGE — la conséquence contre-intuitive de « la priorité entre objets se
 * résout d'abord ». Elle vaut pour les deux modèles.
 */
describe('un objet prioritaire qui perd contre le fond MASQUE ceux de derrière', () => {
  it('en CGB', () => {
    const { ram, ppu } = cgb();
    setBgColor(ppu, 0, 2, JAUNE);
    setObjColor(ppu, 0, 1, ROUGE);
    setObjColor(ppu, 1, 1, BLEU);
    solidTile(ppu, 0, 2); // le fond, opaque
    solidTile(ppu, 1, 1); // les deux objets
    setAttrs(ppu, 0, 0);
    putSprite(ram, 0, { x: 0, attrs: 0b1000_0000 }); // prioritaire, mais derrière le fond
    putSprite(ram, 1, { x: 0, attrs: 0b0000_0001 }); // devant le fond, mais moins prioritaire
    ppu.renderLine(0);

    expect(
      ppu.screen[0],
      'l\'objet 0 est retenu AVANT qu\'on regarde le fond, et il y perd : l\'objet 1 ne repasse pas',
    ).toBe(JAUNE);
  });

  it('en DMG', () => {
    const { ram, ppu } = dmg();
    solidTile(ppu, 0, 2); // le fond, opaque
    solidTile(ppu, 1, 1);
    putSprite(ram, 0, { x: 0, attrs: 0b1000_0000 }); // X égaux : l'index départage
    putSprite(ram, 1, { x: 0, attrs: 0b0000_0000 });
    ppu.renderLine(0);

    expect(ppu.screen[0], 'le fond, et non l\'objet 1').toBe(DMG_COLORS[2]);
  });
});

describe('LCDC bit 0 en DMG : le sens historique n\'a pas bougé', () => {
  it('la ligne se blanchit toujours', () => {
    const { ppu } = dmg(LCDC_BASE & ~1);
    solidTile(ppu, 0, 2);
    ppu.renderLine(0);

    expect(ppu.screen[0], 'décor coupé = blanc').toBe(BLANK_COLOR);
  });

  it('mais les objets, eux, restent dessinés', () => {
    // pandocs : « Only objects may still be displayed (if enabled in Bit 1) ».
    // On rendait la main avant de les dessiner — un trou de justesse DMG que le
    // lot 5 a trouvé en démêlant les deux sens du bit.
    const { ram, ppu } = dmg(LCDC_BASE & ~1);
    solidTile(ppu, 1, 1);
    putSprite(ram, 0, { x: 0, attrs: 0 });
    ppu.renderLine(0);

    expect(ppu.screen[0], 'l\'objet passe : le fond blanchi est transparent pour lui')
      .toBe(DMG_COLORS[1]);
  });
});
