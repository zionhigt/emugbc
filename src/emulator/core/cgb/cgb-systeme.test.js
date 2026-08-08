import { describe, it, expect } from 'vitest';

import buildCgbSystem from './index';
import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from '../machine';
import { DMG, CGB } from '../models';

/**
 * LOT 7 — CE QUI RESTE DU CGB HORS PPU.
 *
 * Deux choses sans rapport l'une avec l'autre, sinon qu'elles vivent toutes les
 * deux dans le plan $FFxx et qu'aucune n'est du dessin :
 *
 *  a) SIX REGISTRES INDOCUMENTÉS ($FF72-$FF77). Personne ne sait à quoi servent
 *     les quatre premiers ; ils existent, ils se relisent d'une certaine façon,
 *     et c'est tout ce qu'on peut en dire. Les deux derniers, eux, ont fini par
 *     être compris : PCM12 et PCM34 donnent la sortie NUMÉRIQUE des quatre voies
 *     de l'APU, un demi-octet chacune. C'est une fenêtre sur l'APU, pas un
 *     registre à ranger quelque part.
 *
 *  b) SVBK ($FF70), les banques de WRAM. Même geste qu'au lot 2 pour la VRAM :
 *     la moitié basse (0xC000) ne bouge jamais, la moitié haute (0xD000) est
 *     commutable entre sept banques. Un jeu CGB qui n'y a pas droit se cogne à
 *     un plafond de 8 Ko de RAM.
 *
 * POURQUOI CE N'EST PAS DANS LE PPU. Les registres du CGB déjà posés (VBK, les
 * palettes, OPRI, HDMA) sont tous du ressort de l'affichage, et c'est le PPU qui
 * les déclare. Ceux-ci ne le sont pas. Ils ont donc leur propre propriétaire, qui
 * DÉCLARE sa table exactement comme le PPU déclare la sienne — la carte mémoire
 * ne connaît toujours pas de « si CGB », elle route ce qu'on lui déclare.
 */

const SVBK = 0xFF70;
const PCM12 = 0xFF76;
const PCM34 = 0xFF77;

const silentApu = () => ({
  channel1: { amplitude: () => 0 },
  channel2: { amplitude: () => 0 },
  channel3: { amplitude: () => 0 },
  channel4: { amplitude: () => 0 },
});

const makeSystem = (apu = silentApu()) => {
  // La banque 1 vit dans la mémoire plate, comme la banque 0 de VRAM au lot 2 :
  // le banc d'essai doit donc en fournir une.
  const ram = new Uint8Array(0x10000);
  const machine = {
    totalCycles: 0,
    apu,
    memory: { _read: (a) => ram[a], _write: (a, v) => { ram[a] = v; } },
  };
  return new (buildCgbSystem(machine))();
};

describe('les registres indocumentés', () => {
  it('$FF72, $FF73 et $FF74 sont libres en lecture comme en écriture', () => {
    const cgb = makeSystem();
    for (const addr of [0xFF72, 0xFF73, 0xFF74]) {
      expect(cgb.read(addr), `${addr.toString(16)} vaut 0 au départ`).toBe(0x00);
      cgb.write(addr, 0xA5);
      expect(cgb.read(addr), `${addr.toString(16)} garde ce qu'on y met`).toBe(0xA5);
    }
  });

  it('$FF75 ne retient que ses bits 4-6 ; les cinq autres se lisent à 1', () => {
    // `unused_hwio-C` : test $FF75 %11111111 %00000000 %10001111
    const cgb = makeSystem();
    cgb.write(0xFF75, 0x00);
    expect(cgb.read(0xFF75)).toBe(0b1000_1111);
    cgb.write(0xFF75, 0xFF);
    expect(cgb.read(0xFF75)).toBe(0xFF);
    cgb.write(0xFF75, 0b0101_0000);
    expect(cgb.read(0xFF75), 'seuls 4-6 ont bougé').toBe(0b1101_1111);
  });

  it('PCM12 et PCM34 recopient la sortie numérique des quatre voies', () => {
    // Voie 1 dans le quartet bas, voie 2 dans le haut, puis 3 et 4.
    const cgb = makeSystem({
      channel1: { amplitude: () => 0x3 },
      channel2: { amplitude: () => 0xC },
      channel3: { amplitude: () => 0xF },
      channel4: { amplitude: () => 0x1 },
    });

    expect(cgb.read(PCM12)).toBe(0xC3);
    expect(cgb.read(PCM34)).toBe(0x1F);
  });

  it('PCM12 et PCM34 sont en LECTURE SEULE', () => {
    const cgb = makeSystem();
    cgb.write(PCM12, 0xFF);
    cgb.write(PCM34, 0xFF);

    expect(cgb.read(PCM12), 'l\'APU est muet, rien à lire').toBe(0x00);
    expect(cgb.read(PCM34)).toBe(0x00);
  });
});

describe('SVBK et les banques de WRAM', () => {
  it('vaut 0 au départ, et ses cinq bits hauts se lisent à 1', () => {
    const cgb = makeSystem();
    expect(cgb.read(SVBK)).toBe(0xF8);
    cgb.write(SVBK, 0x03);
    expect(cgb.read(SVBK)).toBe(0xFB);
  });

  it('la banque 0 demandée donne la banque 1 — il n\'y a pas de banque 0 en haut', () => {
    const cgb = makeSystem();
    cgb.write(SVBK, 0);
    expect(cgb.wramBank).toBe(1);
    cgb.write(SVBK, 1);
    expect(cgb.wramBank).toBe(1);
    cgb.write(SVBK, 7);
    expect(cgb.wramBank).toBe(7);
  });

  it('sept banques distinctes en 0xD000, qui ne se marchent pas dessus', () => {
    const cgb = makeSystem();
    for (let bank = 1; bank <= 7; bank++) {
      cgb.write(SVBK, bank);
      cgb.wramWrite(0xD000, 0x10 + bank);
    }
    for (let bank = 1; bank <= 7; bank++) {
      cgb.write(SVBK, bank);
      expect(cgb.wramRead(0xD000), `banque ${bank}`).toBe(0x10 + bank);
    }
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

  it('les sept adresses sont routées en CGB', () => {
    const { memory } = makeMachine(CGB);
    memory.write(0xFF72, 0x5A);
    expect(memory.read(0xFF72), 'relu par le bus').toBe(0x5A);
    memory.write(SVBK, 0x02);
    expect(memory.read(SVBK)).toBe(0xFA);
    expect(memory.read(PCM12), 'APU au repos').toBe(0x00);
  });

  it('elles restent des trous en DMG', () => {
    const { memory } = makeMachine(DMG);
    for (const addr of [SVBK, 0xFF72, 0xFF73, 0xFF74, 0xFF75, PCM12, PCM34]) {
      memory.write(addr, 0x00);
      expect(memory.read(addr), `${addr.toString(16)} reste vide`).toBe(0xFF);
    }
  });

  it('0xC000-0xCFFF ne bouge jamais, quelle que soit la banque', () => {
    const { memory } = makeMachine(CGB);
    memory.write(0xC000, 0x11);
    memory.write(SVBK, 5);
    expect(memory.read(0xC000), 'la moitié basse n\'est pas commutée').toBe(0x11);
  });

  it('0xD000-0xDFFF suit SVBK, par le bus', () => {
    const { memory } = makeMachine(CGB);
    memory.write(SVBK, 1);
    memory.write(0xD000, 0xAA);
    memory.write(SVBK, 4);
    expect(memory.read(0xD000), 'une autre banque, une autre valeur').not.toBe(0xAA);
    memory.write(0xD000, 0xBB);
    memory.write(SVBK, 1);
    expect(memory.read(0xD000), 'la banque 1 est intacte').toBe(0xAA);
  });

  it('en DMG, 0xD000 reste de la RAM plate', () => {
    const { memory } = makeMachine(DMG);
    memory.write(0xD000, 0xAA);
    memory.write(SVBK, 4); // sans effet : le registre n'existe pas
    expect(memory.read(0xD000)).toBe(0xAA);
  });
});
