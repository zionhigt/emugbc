import { describe, it, expect } from 'vitest';

import buildPPU, { Fetcher } from './index';
import buildCGBPPU from './cgb';

/**
 * LOT 6 — HDMA, LA COPIE VERS LA VRAM (0xFF51-0xFF55).
 *
 * Le DMG a déjà un bouton-copie, mais il ne remplit que l'OAM et il part
 * toujours de la même longueur. Le CGB en ajoute un second, qui vise la VRAM, et
 * qui sait faire une chose que l'autre ne sait pas : **se découper en tranches**.
 *
 * L'analogie : un déménagement. Le transfert général, c'est le camion qui part
 * une fois, plein, et on attend qu'il revienne — le programme est à l'arrêt
 * pendant ce temps. Le transfert HBlank, c'est le même chargement porté carton
 * par carton, un carton de 16 octets à chaque fois que le PPU souffle en fin de
 * ligne. Le jeu continue de tourner entre deux cartons, et c'est tout l'intérêt :
 * on recharge des tuiles PENDANT l'affichage, sans jamais bloquer la trame.
 *
 * Deux règles s'attrapent mal si on ne les nomme pas :
 *
 *  - il n'y a pas de HBlank en VBlank. Le transfert s'arrête aux lignes 144-153
 *    et reprend tout seul à la ligne 0 ;
 *  - le CPU en `halt` gèle le transfert. Le DMA emprunte le bus au PROCESSEUR ;
 *    processeur endormi, plus personne pour porter les cartons. C'est
 *    exactement ce que mesure `hblank_vram_dma.gbc`.
 */

const HDMA1 = 0xFF51;
const HDMA2 = 0xFF52;
const HDMA3 = 0xFF53;
const HDMA4 = 0xFF54;
const HDMA5 = 0xFF55;
const VBK = 0xFF4F;
const LCDC = 0xFF40;

/** Une ligne complète du PPU, en cycles machine. */
const LINE = 114;

const makeBench = (build) => {
  const ram = new Uint8Array(0x10000);
  const machine = {
    totalCycles: 0, _if: 0,
    // Vitesse simple : les deux montres portent le même nombre (jalon KEY1, lot 0).
    get systemCycles() { return this.totalCycles; },
    cpu: { halted: false },
    get IF() { return this._if; }, set IF(v) { this._if = v; },
    memory: {
      read: (a) => ram[a], write: (a, v) => { ram[a] = v; },
      _read: (a) => ram[a], _write: (a, v) => { ram[a] = v; },
    },
  };
  const ppu = new (build(machine))(Fetcher);
  ppu.write(LCDC, 0b1001_0001);
  return { ram, machine, ppu };
};

const cgb = () => makeBench(buildCGBPPU);

/** Une source reconnaissable en WRAM : l'octet i vaut i. */
const fillSource = (ram, start, length) => {
  for (let i = 0; i < length; i++) ram[start + i] = i & 0xFF;
};

/** Un octet qu'on ne confondra pas avec de la VRAM restée vide. */
const MARQUE = 0xAA;

/** Armer les quatre demi-adresses, sans démarrer. */
const aim = (ppu, source, destination) => {
  ppu.write(HDMA1, source >> 8);
  ppu.write(HDMA2, source & 0xFF);
  ppu.write(HDMA3, destination >> 8);
  ppu.write(HDMA4, destination & 0xFF);
};

const blocks = (n) => n - 1; // la longueur s'écrit en blocs de 16, moins un

/** Faire tourner le PPU d'un nombre entier de lignes, par son horloge à lui. */
const advanceLines = (bench, lines) => {
  for (let i = 0; i < lines; i++) {
    bench.machine.totalCycles += LINE;
    bench.ppu.check();
  }
};

describe('les cinq registres', () => {
  it('n\'existent qu\'en CGB', () => {
    const { ppu } = cgb();
    for (const addr of [HDMA1, HDMA2, HDMA3, HDMA4, HDMA5]) {
      expect(ppu.registersMapping[addr], `${addr.toString(16)} routé en CGB`).toBeDefined();
    }
    const plain = makeBench(buildPPU).ppu;
    for (const addr of [HDMA1, HDMA2, HDMA3, HDMA4, HDMA5]) {
      expect(plain.registersMapping[addr], `${addr.toString(16)} inconnu du DMG`).toBeUndefined();
    }
  });

  it('les quatre demi-adresses sont en ÉCRITURE SEULE', () => {
    const { ppu } = cgb();
    aim(ppu, 0xC000, 0x8000);
    for (const addr of [HDMA1, HDMA2, HDMA3, HDMA4]) {
      expect(ppu.read(addr), 'rien derrière en lecture : 0xFF').toBe(0xFF);
    }
  });

  it('HDMA5 au repos vaut 0xFF — bit 7 à 1 : aucun transfert en cours', () => {
    expect(cgb().ppu.read(HDMA5)).toBe(0xFF);
  });
});

describe('le transfert général (bit 7 = 0) : tout, d\'un coup', () => {
  it('copie les blocs demandés dès l\'écriture de HDMA5', () => {
    const { ram, ppu } = cgb();
    fillSource(ram, 0xC000, 0x40);
    aim(ppu, 0xC000, 0x8000);
    ppu.write(HDMA5, blocks(3)); // trois blocs = 48 octets

    for (let i = 0; i < 0x30; i++) {
      expect(ppu.vramReadBank(0x8000 + i, 0), `octet ${i}`).toBe(i & 0xFF);
    }
    expect(ppu.vramReadBank(0x8030, 0), 'et pas un octet de plus').toBe(0);
  });

  it('rend la main tout de suite : HDMA5 relu vaut 0xFF', () => {
    const { ram, ppu } = cgb();
    fillSource(ram, 0xC000, 0x40);
    aim(ppu, 0xC000, 0x8000);
    ppu.write(HDMA5, blocks(4));

    expect(ppu.read(HDMA5), 'terminé').toBe(0xFF);
  });

  it('les quatre bits bas des deux adresses sont ignorés', () => {
    const { ram, ppu } = cgb();
    fillSource(ram, 0xC000, 0x40);
    ram[0xC000] = MARQUE;
    aim(ppu, 0xC00F, 0x801F);
    ppu.write(HDMA5, blocks(1));

    expect(ppu.vramReadBank(0x800F, 0), 'rien avant 0x8010').toBe(0);
    expect(ppu.vramReadBank(0x8010, 0), 'destination alignée sur 0x8010, source sur 0xC000')
      .toBe(MARQUE);
    expect(ppu.vramReadBank(0x8011, 0), 'la source repart de 0xC000, pas de 0xC00F').toBe(1);
  });

  it('la destination est TOUJOURS en VRAM : seuls les bits 12-4 comptent', () => {
    // 0x1234 -> 0x8000 | 0x1230 = 0x9230. Les trois bits hauts sont jetés,
    // le CGB ne sait copier que vers 0x8000-0x9FF0.
    const { ram, ppu } = cgb();
    fillSource(ram, 0xC000, 0x10);
    ram[0xC000] = MARQUE;
    aim(ppu, 0xC000, 0x1234);
    ppu.write(HDMA5, blocks(1));

    expect(ppu.vramReadBank(0x9230, 0)).toBe(MARQUE);
    expect(ppu.vramReadBank(0x923F, 0)).toBe(0x0F);
  });

  it('la destination suit VBK : la banque 1 se remplit aussi', () => {
    const { ram, ppu } = cgb();
    fillSource(ram, 0xC000, 0x10);
    aim(ppu, 0xC000, 0x8000);
    ppu.write(VBK, 1);
    ppu.write(HDMA5, blocks(1));

    expect(ppu.vramReadBank(0x8005, 1), 'écrit en banque 1').toBe(5);
    expect(ppu.vramReadBank(0x8005, 0), 'la banque 0 est intacte').toBe(0);
  });
});

describe('le transfert HBlank (bit 7 = 1) : un carton par fin de ligne', () => {
  const start = (bench, count) => {
    fillSource(bench.ram, 0xC000, 0x800);
    bench.ram[0xC000] = MARQUE;
    aim(bench.ppu, 0xC000, 0x8000);
    bench.ppu.write(HDMA5, 0x80 | blocks(count));
  };

  /** Compter les HBlank réellement traversées, sans toucher au décompte de cycles. */
  const countHBlanks = (bench) => {
    const counter = { hblanks: 0 };
    const original = bench.ppu.enterHBlank.bind(bench.ppu);
    bench.ppu.enterHBlank = () => {
      counter.hblanks++;
      original();
    };
    return counter;
  };

  it('ne copie RIEN à l\'écriture de HDMA5', () => {
    const bench = cgb();
    start(bench, 8);
    expect(bench.ppu.vramReadBank(0x8000, 0), 'il attend la première HBlank').toBe(0);
    expect(bench.ppu.read(HDMA5) & 0x80, 'bit 7 à 0 : occupé').toBe(0);
  });

  it('avance d\'un bloc à chaque HBlank, et pas plus', () => {
    // On compte les HBlank plutôt que les lignes : l'assertion tient alors
    // exactement, sans dépendre d'un décompte de cycles à la frontière.
    const bench = cgb();
    const counter = countHBlanks(bench);
    start(bench, 8);
    advanceLines(bench, 3);

    expect(counter.hblanks, 'trois lignes, trois HBlank').toBe(3);
    expect(bench.ppu.vramReadBank(0x8000, 0), 'le premier octet du premier bloc').toBe(MARQUE);
    for (let i = 1; i < counter.hblanks * 0x10; i++) {
      expect(bench.ppu.vramReadBank(0x8000 + i, 0), `octet ${i}`).toBe(i & 0xFF);
    }
    expect(bench.ppu.vramReadBank(0x8000 + counter.hblanks * 0x10, 0), 'rien au-delà').toBe(0);
  });

  it('HDMA5 rend les blocs restants, moins un, bit 7 éteint', () => {
    const bench = cgb();
    start(bench, 8);
    advanceLines(bench, 3);

    expect(bench.ppu.read(HDMA5), 'huit blocs, trois portés : cinq restants').toBe(5 - 1);
  });

  it('une fois fini, HDMA5 repasse à 0xFF', () => {
    const bench = cgb();
    start(bench, 4);
    advanceLines(bench, 10);

    expect(bench.ppu.read(HDMA5)).toBe(0xFF);
    expect(bench.ppu.vramReadBank(0x803F, 0), 'les quatre blocs sont là').toBe(0x3F);
    expect(bench.ppu.vramReadBank(0x8040, 0), 'et il s\'est arrêté').toBe(0);
  });

  it('ne transfère pas pendant le VBlank, et reprend tout seul à la ligne 0', () => {
    const bench = cgb();
    advanceLines(bench, 145); // on est entré dans le VBlank (lignes 144-153)
    const counter = countHBlanks(bench);
    start(bench, 4);
    advanceLines(bench, 8);   // toujours dedans

    expect(counter.hblanks, 'pas de fin de ligne en VBlank').toBe(0);
    expect(bench.ppu.vramReadBank(0x8000, 0), 'rien n\'a bougé').toBe(0);
    expect(bench.ppu.read(HDMA5), 'les quatre blocs attendent toujours').toBe(4 - 1);

    advanceLines(bench, 3);   // retour aux lignes visibles
    expect(counter.hblanks, 'le transfert reprend de lui-même').toBeGreaterThan(0);
    expect(bench.ppu.vramReadBank(0x8000, 0)).toBe(MARQUE);
  });

  it('le CPU en halt gèle le transfert', () => {
    // C'est ce que mesure `hblank_vram_dma.gbc`, et c'est contre-intuitif : le
    // PPU continue de souffler en fin de ligne, mais plus personne ne porte.
    const bench = cgb();
    start(bench, 8);
    bench.machine.cpu.halted = true;
    advanceLines(bench, 4);

    expect(bench.ppu.vramReadBank(0x8000, 0), 'rien n\'a bougé').toBe(0);
    expect(bench.ppu.read(HDMA5) & 0x80, 'toujours en cours, simplement gelé').toBe(0);

    bench.machine.cpu.halted = false;
    advanceLines(bench, 1);
    expect(bench.ppu.vramReadBank(0x8000, 0), 'et il reprend là où il en était').toBe(MARQUE);
    expect(bench.ppu.vramReadBank(0x800F, 0)).toBe(0x0F);
  });

  it('s\'interrompt si on écrit un bit 7 à 0 pendant qu\'il tourne', () => {
    const bench = cgb();
    start(bench, 8);
    advanceLines(bench, 3);
    bench.ppu.write(HDMA5, 0x00);

    expect(bench.ppu.read(HDMA5), 'bit 7 à 1, et les cinq blocs restants en dessous')
      .toBe(0x80 | (5 - 1));

    advanceLines(bench, 3);
    expect(bench.ppu.vramReadBank(0x8030, 0), 'plus rien ne bouge').toBe(0);
  });

  it('l\'écriture qui interrompt ne relance PAS un transfert général', () => {
    // Le piège du registre à deux usages : le même bit 7 à 0 démarre un
    // transfert général quand rien ne tourne, et en arrête un quand il tourne.
    const bench = cgb();
    start(bench, 8);
    advanceLines(bench, 1);
    bench.ppu.write(HDMA5, blocks(4));

    expect(bench.ppu.vramReadBank(0x8010, 0), 'aucune copie immédiate').toBe(0);
  });
});
