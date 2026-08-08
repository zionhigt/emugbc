import { describe, it, expect } from 'vitest';

import buildPPU, { Fetcher } from './index';
import buildCGBPPU from './cgb';
import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from '../machine';
import { DMG, CGB } from '../models';

/**
 * LOT 2 — LA VRAM DOUBLE ET VBK.
 *
 * L'analogie du cahier : le CGB, c'est le même atelier avec un SECOND TIROIR.
 * VBK dit quel tiroir le PROCESSEUR a ouvert — et lui seul. Le PPU, lui, ne
 * consulte jamais VBK : il va chercher dans l'un ou l'autre selon ce qu'il lit.
 * Confondre les deux ferait clignoter le fond au rythme des écritures du jeu,
 * et c'est le genre de bug qu'on met une soirée à voir.
 */

const VRAM = 0x8000;
const VBK = 0xFF4F;

const makeBench = (build) => {
  const ram = new Uint8Array(0x10000);
  const machine = {
    totalCycles: 0,
    // Vitesse simple : les deux montres portent le même nombre (jalon KEY1, lot 0).
    get systemCycles() { return this.totalCycles; },
    _if: 0,
    get IF() { return this._if; },
    set IF(v) { this._if = v; },
    memory: {
      read: (a) => ram[a], write: (a, v) => { ram[a] = v; },
      _read: (a) => ram[a], _write: (a, v) => { ram[a] = v; },
    },
  };
  const PPUClass = build(machine);
  return { ram, ppu: new PPUClass(Fetcher) };
};

const cgb = () => makeBench(buildCGBPPU);
const dmg = () => makeBench(buildPPU);

describe('le PPU CGB : une surcharge du DMG', () => {
  it('hérite du DMG plutôt que de le doubler', () => {
    // La contrainte de conception du jalon, tenue par un test : si un jour
    // quelqu'un réécrit un PPU CGB à côté, celui-ci tombe.
    const { ppu } = cgb();
    for (const m of ['read', 'write', 'check', 'backgroundColor', 'tileAttributes', 'spriteOrder']) {
      expect(typeof ppu[m], `${m} vient du DMG`).toBe('function');
    }
  });
});

describe('VBK (0xFF4F) : l\'aiguillage de banque, côté processeur', () => {
  it('n\'existe pas en DMG : l\'adresse ne lui est pas routée', () => {
    expect(dmg().ppu.registersMapping[VBK]).toBeUndefined();
  });

  it('existe en CGB, et s\'ajoute aux registres du DMG', () => {
    const { ppu } = cgb();
    expect(ppu.registersMapping[VBK], 'VBK est déclaré').toBeDefined();
    expect(ppu.registersMapping[0xFF40], 'LCDC est toujours là').toBeDefined();
  });

  it('un seul bit utile : les sept autres se lisent à 1', () => {
    // `unused_hwio-C` l'arbitre : test $FF4F %11111110.
    const { ppu } = cgb();
    ppu.write(VBK, 0x00);
    expect(ppu.read(VBK)).toBe(0xFE);
    ppu.write(VBK, 0xFF);
    expect(ppu.read(VBK)).toBe(0xFF);
  });

  it('ne retient que le bit 0, quoi qu\'on lui écrive', () => {
    const { ppu } = cgb();
    ppu.write(VBK, 0xFE); // tous les bits SAUF le 0
    expect(ppu.vramBank, 'les bits morts ne choisissent pas la banque').toBe(0);
  });
});

describe('les deux banques', () => {
  it('la même adresse porte deux octets différents', () => {
    const { ppu } = cgb();
    ppu.write(VBK, 0);
    ppu.vramWrite(VRAM, 0x11);
    ppu.write(VBK, 1);
    ppu.vramWrite(VRAM, 0x22);

    ppu.write(VBK, 0);
    expect(ppu.vramRead(VRAM), 'banque 0').toBe(0x11);
    ppu.write(VBK, 1);
    expect(ppu.vramRead(VRAM), 'banque 1').toBe(0x22);
  });

  it('la banque 0 reste dans la mémoire plate — le DMG continue de la lire', () => {
    // Ce n'est pas un détail d'implémentation : tout le reste de l'émulateur
    // (le DMA, les tests, le PPU DMG) lit la VRAM par `memory._read`.
    const { ram, ppu } = cgb();
    ppu.write(VBK, 0);
    ppu.vramWrite(VRAM + 0x10, 0x5A);
    expect(ram[VRAM + 0x10]).toBe(0x5A);
  });

  it('la banque 1 ne fuit PAS dans la mémoire plate', () => {
    const { ram, ppu } = cgb();
    ppu.write(VBK, 1);
    ppu.vramWrite(VRAM + 0x10, 0x5A);
    expect(ram[VRAM + 0x10], 'la banque 1 vit à part').toBe(0);
  });

  it('les deux banques font 8 Ko, et se referment sur elles-mêmes', () => {
    const { ppu } = cgb();
    ppu.write(VBK, 1);
    ppu.vramWrite(0x9FFF, 0x77);
    expect(ppu.vramRead(0x9FFF), 'le dernier octet de la banque 1').toBe(0x77);
  });
});

describe('vramReadBank : le PPU lit la banque qu\'il veut, sans passer par VBK', () => {
  it('atteint les deux banques quel que soit le réglage de VBK', () => {
    // LE point du lot. VBK est un aiguillage pour le CPU ; le PPU doit pouvoir
    // lire la carte en banque 0 ET son étiquette en banque 1 dans le même souffle.
    const { ppu } = cgb();
    ppu.write(VBK, 0);
    ppu.vramWrite(0x9800, 0xAA);
    ppu.write(VBK, 1);
    ppu.vramWrite(0x9800, 0xBB);

    for (const bank of [0, 1]) {
      ppu.write(VBK, bank);
      expect(ppu.vramReadBank(0x9800, 0), `VBK=${bank}, lecture banque 0`).toBe(0xAA);
      expect(ppu.vramReadBank(0x9800, 1), `VBK=${bank}, lecture banque 1`).toBe(0xBB);
    }
  });

  it('le bus du PPU expose ce chemin', () => {
    const { ppu } = cgb();
    ppu.write(VBK, 1);
    ppu.vramWrite(0x8100, 0x3C);
    expect(ppu.bus.ppuReadBank(0x8100, 1)).toBe(0x3C);
    expect(ppu.bus.ppuReadBank(0x8100, 0), 'la banque 0 est restée vierge').toBe(0);
  });

  it('hors VRAM il n\'y a pas de banque : l\'OAM répond toujours pareil', () => {
    const { ram, ppu } = cgb();
    ram[0xFE00] = 0x42;
    expect(ppu.vramReadBank(0xFE00, 0)).toBe(0x42);
    expect(ppu.vramReadBank(0xFE00, 1), 'l\'OAM n\'est pas banquée').toBe(0x42);
  });

  it('en DMG, la banque demandée est ignorée', () => {
    const { ram, ppu } = dmg();
    ram[VRAM] = 0x99;
    expect(ppu.vramReadBank(VRAM, 0)).toBe(0x99);
    expect(ppu.vramReadBank(VRAM, 1), 'il n\'y a qu\'une VRAM').toBe(0x99);
  });
});

/**
 * DE BOUT EN BOUT — c'est ici que le lot se prouve vraiment.
 *
 * Les tests ci-dessus parlent au PPU directement. Mais entre le jeu et lui il y
 * a le bus, et rien ne garantissait que 0xFF4F lui soit ROUTÉ : cette adresse
 * tombe hors de la plage historique du PPU (0xFF40-0xFF4B), au milieu des trous
 * fermés au lot 1.5. Le PPU DÉCLARE ses registres, MemoryBuilder les lui route —
 * ce mécanisme-là n'existe que depuis ce lot, et il ne se voit que d'ici.
 */
describe('de bout en bout : le bus, la machine, le modèle', () => {
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

  it('le modèle CGB instancie le PPU CGB', () => {
    expect(makeMachine(CGB).ppu.registersMapping[VBK], 'VBK présent').toBeDefined();
    expect(makeMachine(DMG).ppu.registersMapping[VBK], 'absent en DMG').toBeUndefined();
  });

  it('0xFF4F est routé au PPU en CGB — pas laissé dans les trous', () => {
    const machine = makeMachine(CGB);
    machine.memory.write(VBK, 0x01);
    expect(machine.memory.read(VBK), 'VBK répond par le bus').toBe(0xFF);
    machine.memory.write(VBK, 0x00);
    expect(machine.memory.read(VBK)).toBe(0xFE);
  });

  it('0xFF4F reste un trou en DMG : 0xFF, et rien ne s\'y écrit', () => {
    const machine = makeMachine(DMG);
    machine.memory.write(VBK, 0x01);
    expect(machine.memory.read(VBK)).toBe(0xFF);
  });

  it('le CPU commute réellement de banque par le bus', () => {
    // Le geste que fait un vrai jeu CGB : poser VBK, écrire dans la VRAM,
    // rebasculer, écrire ailleurs, et retrouver les deux.
    const machine = makeMachine(CGB);
    const { memory } = machine;
    machine.ppu.LCDC.setValue(0x00); // écran éteint : pas de verrou de mode

    memory.write(VBK, 0);
    memory.write(0x8000, 0x11);
    memory.write(VBK, 1);
    memory.write(0x8000, 0x22);

    memory.write(VBK, 0);
    expect(memory.read(0x8000), 'banque 0 intacte').toBe(0x11);
    memory.write(VBK, 1);
    expect(memory.read(0x8000), 'banque 1 intacte').toBe(0x22);
  });

  it('le verrou du mode 3 s\'applique AUX DEUX banques', () => {
    // Le piège du lot : router la VRAM par le PPU ne doit pas contourner le
    // blocage dot-précis conquis au chapitre PPU.
    const machine = makeMachine(CGB);
    machine.ppu.LCDC.setValue(0x00);
    machine.memory.write(VBK, 1);
    machine.memory.write(0x8000, 0x22);

    machine.ppu.LCDC.setValue(0x80); // écran allumé
    machine.ppu.computeState = () => ({ mode: 3, line: 0 });
    expect(machine.memory.read(0x8000), 'mode 3 : verrouillé en banque 1 aussi').toBe(0xFF);
  });
});
