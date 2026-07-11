import { describe, it, expect } from 'vitest';

import buildCartridge from './Cartridge';

const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

const Cartridge = buildCartridge();

// Le logo Nintendo : 48 octets, constante universelle de toutes les cartouches.
const NINTENDO_LOGO = [
  0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 0x00, 0x0d,
  0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e, 0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99,
  0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 0xec, 0xcc, 0xdd, 0xdc, 0x99, 0x9f, 0xbb, 0xb9, 0x33, 0x3e,
];

// Fabrique une ROM synthétique 32 Ko avec un en-tête valide (logo + checksums),
// comme rgbfix le ferait. Chaque test construit la cartouche dont il a besoin.
const buildRom = ({ title = 'TESTROM', type = 0x00, romSizeCode = 0x00 } = {}) => {
  const rom = new Uint8Array(0x8000);
  for (let i = 0; i < NINTENDO_LOGO.length; i++) rom[0x0104 + i] = NINTENDO_LOGO[i];
  for (let i = 0; i < title.length; i++) rom[0x0134 + i] = title.charCodeAt(i);
  rom[0x0147] = type;
  rom[0x0148] = romSizeCode;

  // checksum d'en-tête : somme roulante 8 bits sur 0x0134..0x014C (inclus)
  let ck = 0;
  for (let a = 0x0134; a <= 0x014c; a++) ck = (ck - rom[a] - 1) & 0xff;
  rom[0x014d] = ck;

  // checksum global : somme 16 bits de TOUT sauf ses deux propres octets,
  // stocké en BIG-endian (0x014E = octet HAUT) — l'unique exception au
  // little-endian de toute la console !
  let g = 0;
  for (let i = 0; i < rom.length; i++) {
    if (i !== 0x014e && i !== 0x014f) g = (g + rom[i]) & 0xffff;
  }
  rom[0x014e] = g >> 8;
  rom[0x014f] = g & 0xff;

  return rom;
};

describe("Cartridge (bootstrap) : parsing d'en-tête et lecture plate", () => {
  it('la factory rend une classe instanciable, qui expose header (public, sans underscore)', () => {
    const cart = new Cartridge(buildRom());
    expect(cart, 'new Cartridge(bytes) doit construire').toBeDefined();
    expect(cart.header, 'cartridge.header doit être exposé').toBeDefined();
  });

  describe('header : les champs parsés', () => {
    it('title : ASCII lu à 0x0134, zéros de fin retirés', () => {
      const cart = new Cartridge(buildRom({ title: 'CPU_INSTRS' }));
      expect(cart.header.title).toBe('CPU_INSTRS');
    });

    it('title : un titre de 15 caractères va jusqu\'à 0x0142 inclus (0x0143 = flag CGB)', () => {
      // 15 caractères : le dernier vit à 0x0142 — si un slice exclusif coupe
      // trop tôt, il manquera la fin.
      const cart = new Cartridge(buildRom({ title: 'ABCDEFGHIJKLMNO' }));
      expect(cart.header.title).toBe('ABCDEFGHIJKLMNO');
    });

    it("type : l'octet 0x0147 (0x00 = pas de MBC, 0x01 = MBC1)", () => {
      expect(new Cartridge(buildRom({ type: 0x00 })).header.type).toBe(0x00);
      expect(new Cartridge(buildRom({ type: 0x01 })).header.type).toBe(0x01);
    });

    it('romSize : calculé depuis le code 0x0148 (32 Ko × 2^code)', () => {
      expect(new Cartridge(buildRom({ romSizeCode: 0x00 })).header.romSize, 'code 0 = 32 Ko').toBe(0x8000);
      expect(new Cartridge(buildRom({ romSizeCode: 0x02 })).header.romSize, 'code 2 = 128 Ko').toBe(0x20000);
    });
  });

  describe('header : le logo Nintendo', () => {
    it('logoValid : vrai quand les 48 octets sont conformes', () => {
      expect(new Cartridge(buildRom()).header.logoValid).toBe(true);
    });

    it('logoValid : faux si un octet du logo diffère', () => {
      const rom = buildRom();
      rom[0x0110] ^= 0xff;
      expect(new Cartridge(rom).header.logoValid).toBe(false);
    });

    it('logoValid : faux si SEUL LE DERNIER octet (0x0133) diffère — gare aux bornes exclusives !', () => {
      const rom = buildRom();
      rom[0x0133] ^= 0xff; // le 48e octet, celui qu\'un slice(0x104, 0x133) oublie
      expect(
        new Cartridge(rom).header.logoValid,
        'le 48e octet du logo doit être comparé lui aussi',
      ).toBe(false);
    });
  });

  describe('header : les checksums', () => {
    it('headerChecksumValid : vrai pour un en-tête sain, faux après corruption', () => {
      expect(new Cartridge(buildRom()).header.headerChecksumValid).toBe(true);

      const rom = buildRom();
      rom[0x0134] ^= 0xff;
      expect(new Cartridge(rom).header.headerChecksumValid).toBe(false);
    });

    it("globalChecksumValid : vrai pour une ROM saine, faux après corruption n'importe où", () => {
      expect(new Cartridge(buildRom()).header.globalChecksumValid).toBe(true);

      const rom = buildRom();
      rom[0x5b1d] += 1; // un octet perdu au fin fond de la ROM — hors de l\'en-tête !
      expect(
        new Cartridge(rom).header.globalChecksumValid,
        'la validation globale doit voir TOUTE la ROM, pas seulement la tranche d\'en-tête',
      ).toBe(false);
    });

    it('globalChecksumValid : les DEUX octets stockés comptent (0x014F compris)', () => {
      const rom = buildRom();
      rom[0x014f] ^= 0xff; // seul l\'octet BAS du checksum stocké diffère
      expect(
        new Cartridge(rom).header.globalChecksumValid,
        'un slice qui s\'arrête à 0x014E ne verrait jamais cette corruption',
      ).toBe(false);
    });

    it('le checksum global est lu en BIG-endian (0x014E = octet haut)', () => {
      const rom = buildRom();
      if (rom[0x014e] !== rom[0x014f]) {
        const tmp = rom[0x014e];
        rom[0x014e] = rom[0x014f];
        rom[0x014f] = tmp;
        expect(
          new Cartridge(rom).header.globalChecksumValid,
          'octets échangés = checksum invalide (une lecture little-endian validerait à tort)',
        ).toBe(false);
      }
    });
  });

  describe('lecture / écriture (sans MBC pour l\'instant)', () => {
    it("read(addr) rend l'octet de la ROM à cette adresse", () => {
      const rom = buildRom();
      rom[0x0000] = 0x3c;
      rom[0x4321] = 0x99;
      rom[0x7fff] = 0x5a;
      const cart = new Cartridge(rom);
      expect(hex(cart.read(0x0000), 2), 'première adresse').toBe('0x3C');
      expect(hex(cart.read(0x4321), 2), 'au milieu').toBe('0x99');
      expect(hex(cart.read(0x7fff), 2), 'dernière adresse de la fenêtre').toBe('0x5A');
    });

    it('write est ignoré : la ROM est en lecture seule (pas de mapper à commander)', () => {
      const rom = buildRom();
      rom[0x1234] = 0x42;
      const cart = new Cartridge(rom);
      cart.write(0x1234, 0x99);
      expect(hex(cart.read(0x1234), 2), "l'octet ne doit pas avoir bougé").toBe('0x42');
    });
  });
});
