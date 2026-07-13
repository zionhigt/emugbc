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
    // un bus muet : check() peint des lignes en passant, il lui faut une VRAM
    cpu: { memory: { read: () => 0, write: () => {} } },
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

  describe('LCDC bit 7 : l\'interrupteur de l\'écran — le temps du PPU se gèle et renaît', () => {
    const ON = 0b1001_0001; // le LCDC post-boot : écran + BG + adressage 0x8000
    const OFF = 0b0001_0001; // les mêmes réglages, écran coupé

    it('LCDC naît à 0x91 : la boot ROM laisse l\'écran ALLUMÉ derrière elle', () => {
      const { ppu } = makePPU();
      expect(ppu.read(0xff40), 'l\'état post-boot, comme les registres du CPU').toBe(0x91);
    });

    it('éteint : LY gèle à 0, quel que soit le temps qui passe', () => {
      const { machine, ppu } = makePPU();
      ppu.write(0xff40, OFF);
      machine.totalCycles = 114 * 50;
      expect(ppu.read(LY), 'le faisceau est physiquement arrêté').toBe(0);
    });

    it('éteint : le VBlank se tait — aucune frappe, même après des trames entières', () => {
      const { machine, knocks, ppu } = makePPU();
      ppu.write(0xff40, OFF);
      machine.totalCycles = TRAME * 3;
      ppu.check();
      expect(knocks, 'un écran éteint n\'a pas de battement').toEqual([]);
    });

    it('éteindre efface la dalle en blanc (teinte 0) — pas de fossiles de la dernière image', () => {
      const { ppu } = makePPU();
      ppu.screen.fill(3); // une image quelconque à l\'écran
      ppu.write(0xff40, OFF);
      expect(ppu.screen.every((p) => p === 0), 'LCD coupé = dalle laiteuse').toBe(true);
    });

    it('rallumer : la trame repart de ZÉRO — l\'ancre renaît', () => {
      const { machine, ppu } = makePPU();
      ppu.write(0xff40, OFF);
      machine.totalCycles = 1000; // du temps passe, écran noir... blanc
      ppu.write(0xff40, ON);
      machine.totalCycles = 1000 + 114 * 5 + 3;
      expect(
        ppu.read(LY),
        'ligne 5 depuis le RALLUMAGE — pas la ligne 8 de l\'horloge brute',
      ).toBe(5);
    });

    it('rallumer : le VBlank reprend sur la nouvelle grille (144 lignes après l\'ancre)', () => {
      const { machine, knocks, ppu } = makePPU();
      ppu.write(0xff40, OFF);
      machine.totalCycles = 1000;
      ppu.write(0xff40, ON);
      machine.totalCycles = 1000 + VBLANK_AT - 1;
      ppu.check();
      expect(knocks.length, 'pas encore : la 144e ligne de la nouvelle trame n\'est pas là').toBe(0);
      machine.totalCycles = 1000 + VBLANK_AT;
      ppu.check();
      expect(knocks.length, 'la frappe, recalée sur l\'ancre du rallumage').toBe(1);
    });

    it('réécrire LCDC SANS toucher au bit 7 ne ré-ancre RIEN — seule la transition compte', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = 114 * 4; // la trame court depuis 0, ligne 4
      ppu.write(0xff40, 0b1011_0001); // toujours allumé, on a juste ouvert la fenêtre (bit 5)
      expect(
        ppu.read(LY),
        'les jeux réécrivent LCDC sans arrêt : un ré-ancrage ici gèlerait la trame pour toujours',
      ).toBe(4);
    });
  });

  describe('les pixels : le décor, tuile par tuile', () => {
    // Le gréement : une vraie ram de 64 Ko derrière un bus minimal, la
    // machine factice par-dessus — le PPU lit la VRAM par le bus, comme convenu.
    const makeRig = () => {
      const ram = new Uint8Array(0x10000);
      const knocks = [];
      const machine = {
        totalCycles: 0,
        _if: 0,
        get IF() { return this._if; },
        set IF(v) { knocks.push(v); this._if = v; },
        cpu: { memory: { read: (a) => ram[a], write: (a, v) => { ram[a] = v; } } },
      };
      const PPU = buildPPU(machine);
      const ppu = new PPU();
      // réglage de base : ÉCRAN allumé (bit 7 !), BG allumé, adressage 0x8000, carte 0x9800
      ppu.write(0xff40, 0b1001_0001);
      ppu.write(0xff47, 0b1110_0100); // BGP identité : 0=0, 1=1, 2=2, 3=3
      return { ram, machine, knocks, ppu };
    };

    // Encode 8 rangées de 8 teintes (0-3) au format 2bpp : par rangée,
    // l'octet des bits FAIBLES puis l'octet des bits FORTS.
    const poseTuile = (ram, id, rows, base = 0x8000) => {
      rows.forEach((row, r) => {
        let lo = 0;
        let hi = 0;
        row.forEach((c, x) => {
          lo |= (c & 1) << (7 - x);
          hi |= ((c >> 1) & 1) << (7 - x);
        });
        ram[base + id * 16 + r * 2] = lo;
        ram[base + id * 16 + r * 2 + 1] = hi;
      });
    };

    const RAMPE = [0, 1, 2, 3, 0, 1, 2, 3]; // la rangée-témoin
    const tuileRampe = Array(8).fill(RAMPE);

    it('ppu.screen : 160 × 144 teintes, blanc (0) à la naissance', () => {
      const { ppu } = makeRig();
      expect(ppu.screen.length, 'un pixel par point d\'écran').toBe(160 * 144);
      expect(ppu.screen.every((p) => p === 0), 'écran vierge').toBe(true);
    });

    it('décodage 2bpp : la tuile 0 en case (0,0), renderLine(0) déroule ses teintes', () => {
      const { ram, ppu } = makeRig();
      poseTuile(ram, 0, tuileRampe);
      ram[0x9800] = 0; // case (0,0) = tuile 0
      ppu.renderLine(0);
      expect(
        Array.from(ppu.screen.slice(0, 8)),
        'bits faibles + bits forts recombinés, pixel par pixel',
      ).toEqual(RAMPE);
    });

    it('chaque ligne lit SA rangée : rangée 1 distincte, renderLine(1) la retrouve', () => {
      const { ram, ppu } = makeRig();
      const rows = Array(8).fill([0, 0, 0, 0, 0, 0, 0, 0]);
      rows[1] = [3, 3, 0, 0, 1, 1, 2, 2];
      poseTuile(ram, 0, rows);
      ppu.renderLine(1);
      expect(Array.from(ppu.screen.slice(160, 168)), 'la rangée 1 de la tuile').toEqual(rows[1]);
    });

    it('BGP traduit : palette inversée, les teintes se retournent', () => {
      const { ram, ppu } = makeRig();
      poseTuile(ram, 0, tuileRampe);
      ppu.write(0xff47, 0b0001_1011); // 0→3, 1→2, 2→1, 3→0
      ppu.renderLine(0);
      expect(
        Array.from(ppu.screen.slice(0, 8)),
        'teinte finale = (BGP >> teinte×2) & 3',
      ).toEqual([3, 2, 1, 0, 3, 2, 1, 0]);
    });

    it('la carte : case (1,0) = autre tuile → pixels 8-15 ; ligne 8 = rangée suivante de la carte', () => {
      const { ram, ppu } = makeRig();
      poseTuile(ram, 1, Array(8).fill([1, 1, 1, 1, 1, 1, 1, 1]));
      poseTuile(ram, 2, Array(8).fill([2, 2, 2, 2, 2, 2, 2, 2]));
      ram[0x9800 + 1] = 1; // case (1,0)
      ram[0x9800 + 32] = 2; // case (0,1) — la carte fait 32 cases de large
      ppu.renderLine(0);
      expect(Array.from(ppu.screen.slice(8, 16)), 'la deuxième case de la première rangée').toEqual(Array(8).fill(1));
      ppu.renderLine(8);
      expect(Array.from(ppu.screen.slice(8 * 160, 8 * 160 + 8)), 'la ligne 8 tombe sur la rangée 1 de la carte').toEqual(Array(8).fill(2));
    });

    it('SCX décale l\'échantillonnage : scroll de 3, l\'écran commence au pixel 3 de la tuile', () => {
      const { ram, ppu } = makeRig();
      poseTuile(ram, 0, tuileRampe);
      ppu.write(0xff42 + 1, 3); // SCX (0xFF43)
      ppu.renderLine(0);
      expect(
        Array.from(ppu.screen.slice(0, 5)),
        'la rampe décalée de 3 : on lit (x + SCX) dans le décor',
      ).toEqual([3, 0, 1, 2, 3]);
    });

    it('SCY décale les lignes : scroll de 9, la ligne 0 lit la rangée 1 de la carte, rangée 1 de la tuile', () => {
      const { ram, ppu } = makeRig();
      const rows = Array(8).fill([0, 0, 0, 0, 0, 0, 0, 0]);
      rows[1] = [2, 2, 2, 2, 2, 2, 2, 2]; // 9 mod 8 = rangée 1
      poseTuile(ram, 5, rows);
      ram[0x9800 + 32] = 5; // 9 ÷ 8 = rangée 1 de la carte
      ppu.write(0xff42, 9); // SCY
      ppu.renderLine(0);
      expect(Array.from(ppu.screen.slice(0, 8)), '(y + SCY) : carte ET rangée décalées').toEqual(rows[1]);
    });

    it('adressage SIGNÉ (LCDC bit 4 = 0) : l\'id 0xFF pointe 0x9000 − 16 = 0x8FF0', () => {
      const { ram, ppu } = makeRig();
      ppu.write(0xff40, 0b0000_0001); // bit 4 éteint : mode signé
      // la tuile vit à 0x9000 + sign8(0xFF) × 16 = 0x8FF0
      const rows = Array(8).fill([3, 0, 3, 0, 3, 0, 3, 0]);
      rows.forEach((row, r) => {
        let lo = 0; let hi = 0;
        row.forEach((c, x) => { lo |= (c & 1) << (7 - x); hi |= ((c >> 1) & 1) << (7 - x); });
        ram[0x8ff0 + r * 2] = lo;
        ram[0x8ff0 + r * 2 + 1] = hi;
      });
      ram[0x9800] = 0xff;
      ppu.renderLine(0);
      expect(
        Array.from(ppu.screen.slice(0, 8)),
        'sign8(0xFF) = −1 : la moitié haute des ids vit SOUS 0x9000 — le piège classique',
      ).toEqual(rows[0]);
    });

    it('BG éteint (LCDC bit 0 = 0) : la ligne se peint en blanc', () => {
      const { ram, ppu } = makeRig();
      poseTuile(ram, 0, tuileRampe);
      ppu.renderLine(0); // d'abord peinte...
      ppu.write(0xff40, 0b0001_0000); // ...puis BG coupé
      ppu.renderLine(0);
      expect(ppu.screen.slice(0, 8).every((p) => p === 0), 'décor coupé = blanc').toBe(true);
    });

    it('check() par ligne : l\'horloge à la ligne 3 a peint les lignes 0-2, pas la 3', () => {
      const { ram, machine, ppu } = makeRig();
      poseTuile(ram, 0, Array(8).fill(Array(8).fill(3)));
      ram[0x9800] = 0;
      machine.totalCycles = 114 * 2 + 10; // en plein milieu de la ligne 2
      ppu.check();
      expect(ppu.screen[0], 'ligne 0 peinte').toBe(3);
      expect(ppu.screen[160], 'ligne 1 peinte').toBe(3);
      expect(ppu.screen[2 * 160], 'ligne 2 peinte (entamée = peinte à son entrée)').toBe(3);
      expect(ppu.screen[3 * 160], 'ligne 3 pas encore').toBe(0);
    });
  });

  describe('DMA (0xFF46) : le bouton-copie qui remplit l\'OAM en un geste', () => {
    // Un PPU adossé à une VRAI ram de 64 Ko (le DMA lit la source et écrit
    // l'OAM, les deux par le bus).
    const makeDMA = () => {
      const ram = new Uint8Array(0x10000);
      const machine = {
        totalCycles: 0,
        _if: 0,
        get IF() { return this._if; },
        set IF(v) { this._if = v; },
        cpu: { memory: { read: (a) => ram[a], write: (a, v) => { ram[a] = v; } } },
      };
      const PPU = buildPPU(machine);
      return { ram, ppu: new PPU() };
    };

    it('écrire 0xC0 copie 0xC000-0xC09F vers l\'OAM 0xFE00-0xFE9F (160 octets)', () => {
      const { ram, ppu } = makeDMA();
      // on tatoue la source : chaque octet = son rang
      for (let i = 0; i < 0xa0; i++) ram[0xc000 + i] = i;
      ppu.write(0xff46, 0xc0); // « appuie » sur le DMA

      expect(hex(ram[0xfe00], 2), 'premier octet de l\'OAM').toBe('0x00');
      expect(hex(ram[0xfe9f], 2), 'dernier octet (le 160e) — gare à la borne !').toBe('0x9F');
    });

    it('la valeur écrite est l\'octet HAUT de la source : 0xD0 copie depuis 0xD000', () => {
      const { ram, ppu } = makeDMA();
      ram[0xd000] = 0x42;
      ram[0xd09f] = 0x99;
      ppu.write(0xff46, 0xd0);
      expect(hex(ram[0xfe00], 2), 'source 0xD000').toBe('0x42');
      expect(hex(ram[0xfe9f], 2), 'source 0xD09F').toBe('0x99');
    });

    it('EXACTEMENT 160 octets : 0xFEA0 n\'est jamais touché (fin exclusive)', () => {
      const { ram, ppu } = makeDMA();
      ram[0xfea0] = 0x55; // un témoin juste après l'OAM
      for (let i = 0; i < 0xb0; i++) ram[0xc000 + i] = 0xff; // la source déborde exprès
      ppu.write(0xff46, 0xc0);
      expect(
        hex(ram[0xfea0], 2),
        '0xA0 octets = indices 0x00 à 0x9F ; 0xFEA0 est HORS OAM, il doit survivre',
      ).toBe('0x55');
    });

    it('le registre est relisible : read(0xFF46) rend la dernière valeur écrite', () => {
      const { ppu } = makeDMA();
      ppu.write(0xff46, 0xc0);
      expect(hex(ppu.read(0xff46), 2), 'DMA garde sa valeur').toBe('0xC0');
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
