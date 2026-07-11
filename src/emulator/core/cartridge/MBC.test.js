import { describe, it, expect } from 'vitest';

import buildMBC from './mbc';

const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

// Une ROM de `banks` banques de 16 Ko. Chaque banque est tatouée pour être
// reconnaissable à travers la fenêtre :
//   - premier octet  (offset 0x0000 dans la banque) = 0xA0 + numéro
//   - dernier octet  (offset 0x3FFF dans la banque) = 0xF0 + numéro
// Le MBC ne voit la ROM qu'à travers read(addr) — c'est tout son contrat.
const buildBankedRom = (banks = 8) => {
  const raw = new Uint8Array(banks * 0x4000);
  for (let b = 0; b < banks; b++) {
    raw[b * 0x4000] = 0xa0 + b;
    raw[b * 0x4000 + 0x3fff] = 0xf0 + b;
  }
  return { read: (addr) => raw[addr], length: raw.length };
};

describe('buildMBC : la factory choisit le mapper selon le type de cartouche', () => {
  it('type 0x00 et type 0x01 rendent chacun un mapper avec read/write', () => {
    for (const type of [0x00, 0x01]) {
      const mbc = buildMBC(type, buildBankedRom());
      expect(mbc, `buildMBC(${hex(type, 2)}) doit rendre une instance`).toBeDefined();
      expect(typeof mbc.read, `read manque sur le mapper ${hex(type, 2)}`).toBe('function');
      expect(typeof mbc.write, `write manque sur le mapper ${hex(type, 2)}`).toBe('function');
    }
  });
});

describe('type 0x00 (pas de MBC) : la ROM plate, rien à commander', () => {
  it('read est un miroir direct des 32 Ko', () => {
    const rom = buildBankedRom(2);
    const mbc = buildMBC(0x00, rom);
    expect(hex(mbc.read(0x0000), 2), 'début banque 0').toBe('0xA0');
    expect(hex(mbc.read(0x3fff), 2), 'fin banque 0').toBe('0xF0');
    expect(hex(mbc.read(0x4000), 2), 'début banque 1').toBe('0xA1');
    expect(hex(mbc.read(0x7fff), 2), 'fin banque 1').toBe('0xF1');
  });

  it("write est ignoré : rien ne bouge, même sur la plage de commande d'un MBC1", () => {
    const mbc = buildMBC(0x00, buildBankedRom(2));
    mbc.write(0x2000, 0x05);
    expect(
      hex(mbc.read(0x4000), 2),
      'sans mapper, écrire 5 en 0x2000 ne doit PAS déplacer la fenêtre',
    ).toBe('0xA1');
  });
});

describe('type 0x01 (MBC1) : la fenêtre 0x4000-0x7FFF est mobile', () => {
  it('au démarrage, la fenêtre présente la banque 1 (jamais la 0)', () => {
    const mbc = buildMBC(0x01, buildBankedRom());
    expect(hex(mbc.read(0x4000), 2), 'début de fenêtre').toBe('0xA1');
    expect(hex(mbc.read(0x7fff), 2), 'fin de fenêtre').toBe('0xF1');
  });

  it('la zone 0x0000-0x3FFF reste gravée sur la banque 0, même après un switch', () => {
    const mbc = buildMBC(0x01, buildBankedRom());
    mbc.write(0x2000, 0x03);
    expect(hex(mbc.read(0x0000), 2), 'la banque 0 ne bouge JAMAIS').toBe('0xA0');
    expect(hex(mbc.read(0x3fff), 2), 'jusqu’à sa dernière adresse').toBe('0xF0');
  });

  it('écrire un numéro de banque dans 0x2000-0x3FFF déplace la fenêtre', () => {
    const mbc = buildMBC(0x01, buildBankedRom());
    mbc.write(0x2000, 0x02);
    expect(hex(mbc.read(0x4000), 2), 'après write(0x2000, 2)').toBe('0xA2');
    expect(hex(mbc.read(0x7fff), 2), 'la fin de fenêtre suit aussi').toBe('0xF2');

    // les deux bornes de la plage de commande obéissent
    mbc.write(0x3fff, 0x05);
    expect(hex(mbc.read(0x4000), 2), 'write(0x3FFF, 5) commande aussi').toBe('0xA5');
  });

  it('la banque 0 est interdite de fenêtre : écrire 0 sélectionne la 1', () => {
    const mbc = buildMBC(0x01, buildBankedRom());
    mbc.write(0x2000, 0x03);
    mbc.write(0x2000, 0x00); // la bizarrerie matérielle du MBC1
    expect(
      hex(mbc.read(0x4000), 2),
      'la valeur 0 doit être promue en 1, pas mapper la banque 0',
    ).toBe('0xA1');
  });

  it('seuls les 5 bits bas comptent : 0xE2 sélectionne la banque 2', () => {
    const mbc = buildMBC(0x01, buildBankedRom());
    mbc.write(0x2000, 0xe2); // 0b111_00010 : les bits hauts sont du bruit
    expect(hex(mbc.read(0x4000), 2), '0xE2 & 0b11111 = 2').toBe('0xA2');
  });

  it('écrire dans 0x0000-0x1FFF (RAM enable) ne touche pas à la fenêtre', () => {
    const mbc = buildMBC(0x01, buildBankedRom());
    mbc.write(0x0000, 0x0a); // commande RAM — pas encore notre affaire
    mbc.write(0x1fff, 0x07);
    expect(
      hex(mbc.read(0x4000), 2),
      'la plage RAM enable ne doit pas être confondue avec le choix de banque',
    ).toBe('0xA1');
  });

  it('les switchs successifs fonctionnent (2 puis 7 puis retour à 1)', () => {
    const mbc = buildMBC(0x01, buildBankedRom());
    mbc.write(0x2000, 0x02);
    expect(hex(mbc.read(0x4000), 2)).toBe('0xA2');
    mbc.write(0x2000, 0x07);
    expect(hex(mbc.read(0x4000), 2)).toBe('0xA7');
    mbc.write(0x2000, 0x01);
    expect(hex(mbc.read(0x4000), 2)).toBe('0xA1');
  });
});
