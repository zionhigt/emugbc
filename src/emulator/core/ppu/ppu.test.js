import { describe, it, expect } from 'vitest';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from '../machine';
import buildPPU from './index';

const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

// La géométrie de l'écran, en cycles machine :
//   1 ligne = 114 cycles ; 1 trame = 154 lignes = 17 556 cycles (= le budget !)
//   lignes 0-143 : visibles ; lignes 144-153 : VBlank
//   la frappe VBlank (IF bit 0) part au PASSAGE à la ligne 144
const LIGNE = 114;
const TRAME = LIGNE * 154;
const VBLANK_AT = LIGNE * 144; // 16 416 cycles : le premier début de VBlank

const LY = 0xff44;

const makePPU = () => {
  const knocks = [];
  const machine = {
    totalCycles: 0,
    _if: 0,
    get IF() { return this._if; },
    set IF(v) { knocks.push(v); this._if = v; },
  };
  const PPU = buildPPU(machine);
  return { machine, knocks, ppu: new PPU() };
};

describe('PPU fantôme : il bat, il ne dessine pas', () => {
  it('la factory (machine injectée) rend la classe : read, write et check exposés', () => {
    const { ppu } = makePPU();
    for (const m of ['read', 'write', 'check']) {
      expect(typeof ppu[m], `${m} doit être appelable`).toBe('function');
    }
  });

  describe('les registres LCD ordinaires : stockage nu, en attendant leurs vrais rôles', () => {
    it.each([
      { addr: 0xff40, nom: 'LCDC' },
      { addr: 0xff42, nom: 'SCY' },
      { addr: 0xff45, nom: 'LYC' },
      { addr: 0xff47, nom: 'BGP' },
      { addr: 0xff4b, nom: 'WX (la dernière adresse du bloc)' },
    ])('$nom (écrit puis relu)', ({ addr }) => {
      const { ppu } = makePPU();
      ppu.write(addr, 0x42);
      expect(hex(ppu.read(addr), 2), 'la valeur doit survivre').toBe('0x42');
    });
  });

  describe('LY : le numéro de ligne, dérivé de l\'horloge — le DIV de l\'écran', () => {
    it('suit le balayage : ligne = totalCycles ÷ 114', () => {
      const { machine, ppu } = makePPU();
      expect(ppu.read(LY), 'trame naissante : ligne 0').toBe(0);
      machine.totalCycles = LIGNE; // 114 cycles
      expect(ppu.read(LY), 'une ligne complète balayée').toBe(1);
      machine.totalCycles = LIGNE * 5 + 57; // au milieu de la 6e ligne
      expect(ppu.read(LY), 'en plein milieu d\'une ligne : toujours la ligne 5').toBe(5);
      machine.totalCycles = LIGNE * 143;
      expect(ppu.read(LY), 'la dernière ligne visible').toBe(143);
      machine.totalCycles = VBLANK_AT;
      expect(ppu.read(LY), 'l\'entrée en VBlank').toBe(144);
    });

    it('boucle à 154 : la trame suivante repart à zéro', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = TRAME;
      expect(ppu.read(LY), 'ligne 154 = ligne 0 de la trame suivante').toBe(0);
      machine.totalCycles = TRAME + LIGNE * 6;
      expect(ppu.read(LY), 'et le balayage continue').toBe(6);
    });

    it('LY est en lecture seule : écrire ne change rien (le balayage n\'obéit à personne)', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = LIGNE * 10;
      ppu.write(LY, 0x77);
      expect(ppu.read(LY), 'le faisceau est à la ligne 10, point').toBe(10);
    });
  });

  describe('la frappe VBlank : IF bit 0 au passage à la ligne 144, une fois par trame', () => {
    it('avant la ligne 144 : aucun coup ne part', () => {
      const { machine, knocks, ppu } = makePPU();
      machine.totalCycles = VBLANK_AT - 1;
      ppu.check();
      expect(knocks, 'la 143e ligne se dessine encore').toEqual([]);
    });

    it('au passage : UNE frappe, IF bit 0', () => {
      const { machine, knocks, ppu } = makePPU();
      machine.totalCycles = VBLANK_AT;
      ppu.check();
      expect(knocks.length, 'le début du VBlank').toBe(1);
      expect(machine.IF & 0b00001, 'le bit VBlank levé').toBe(0b00001);
    });

    it('pas de re-frappe dans la même trame : le VBlank ne sonne qu\'à son entrée', () => {
      const { machine, knocks, ppu } = makePPU();
      machine.totalCycles = VBLANK_AT;
      ppu.check();
      machine.totalCycles = VBLANK_AT + 500; // toujours dans le VBlank (lignes 144-153)
      ppu.check();
      expect(knocks.length, 'une entrée = un coup, pas un par check').toBe(1);
    });

    it('rattrapage : trois trames enjambées = trois frappes', () => {
      const { machine, knocks, ppu } = makePPU();
      machine.totalCycles = VBLANK_AT + TRAME * 2 + 10; // 3 débuts de VBlank dépassés
      ppu.check();
      expect(knocks.length, 'chaque trame manquée doit son battement — un while').toBe(3);
    });
  });

  describe('intégration : le cœur de l\'écran réveille un jeu endormi', () => {
    it('HALT en attendant le VBlank : réveillé et servi au vecteur 0x40', () => {
      const serial = { read() {}, write() {}, echo() {} };
      const timer = { read: () => 0, write() {} };
      const cbs = [];
      const clock = {
        onTick(cb) { cbs.push(cb); },
        start() {}, stop() {},
        tick() { cbs.forEach((cb) => cb({ detail: 'tick' })); },
      };
      const cpu = new CPU(buildMemory(undefined, serial, timer));
      const Decoder = buildDecoder(cpu, buildInstructions());
      const Machine = buildMachine(cpu, new Decoder(), clock, serial, timer);
      const machine = new Machine();

      // une cartouche factice : HALT à l'entrée, et au vecteur VBlank (0x40)
      // le gestionnaire écrit A=0x42 puis boucle sur place
      const rom = new Uint8Array(0x8000);
      rom[0x0100] = 0x76; // HALT
      rom[0x0040] = 0x3e; rom[0x0041] = 0x42; // LD A, 0x42
      rom[0x0042] = 0x18; rom[0x0043] = 0xfe; // JR -2
      machine.plugCartridge({ mbc: { read: (a) => rom[a], write() {} } });

      cpu.start(); // IME allumé
      cpu.memory.write(0xffff, 0b00001); // IE : VBlank autorisé
      clock.tick(); // une trame entière : le faisceau atteint la ligne 144 en chemin

      expect(
        hex(cpu.registers.A.getValue(), 2),
        'le gestionnaire VBlank a tourné : l\'écran a réveillé la console',
      ).toBe('0x42');
    });
  });
});
