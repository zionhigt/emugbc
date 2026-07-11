import { describe, it, expect } from 'vitest';

import buildMemory from './index';

const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

// Une cartouche factice : la factory reçoit la CARTOUCHE et va chercher
// elle-même son contrôleur sur la propriété .mbc — le strict contrat
// read/write. Le mbc sert sa propre ROM tatouée et enregistre chaque
// commande reçue : c'est l'espion qui prouve QUI a été appelé, avec
// QUELS arguments.
const buildFakeCartridge = () => {
  const rom = new Uint8Array(0x8000);
  rom[0x0000] = 0x11;
  rom[0x0100] = 0x42;
  rom[0x7fff] = 0x77;
  const writes = [];
  return {
    mbc: {
      writes,
      read: (addr) => rom[addr],
      write: (addr, value) => writes.push([addr, value]),
    },
  };
};

describe('Memory sans cartouche : le tableau plat de secours', () => {
  it('write puis read se répondent sur TOUT l\'espace, plage ROM comprise', () => {
    const memory = buildMemory();
    // les 507 tests d'instructions comptent sur ce comportement plat,
    // y compris SOUS 0x8000 quand aucune cartouche n'est branchée
    for (const addr of [0x0000, 0x4321, 0x7fff, 0x8000, 0xc000]) {
      memory.write(addr, 0x5a);
      expect(hex(memory.read(addr), 2), `aller-retour en ${hex(addr)}`).toBe('0x5A');
    }
  });

  it('0xFFFF est adressable : le registre IE vit à la toute dernière adresse', () => {
    const memory = buildMemory();
    memory.write(0xffff, 0x1f);
    expect(
      hex(memory.read(0xffff), 2),
      'une borne stop à 0xFFFE laisserait IE orphelin',
    ).toBe('0x1F');
  });

  it('une adresse jamais écrite rend 0', () => {
    const memory = buildMemory();
    expect(memory.read(0xd123), 'la ram démarre vierge').toBe(0);
  });
});

describe('Memory avec MBC : la plage 0x0000-0x7FFF appartient à la cartouche', () => {
  it('la section MBC est récupérable par son tag et couvre les 32 Ko entiers', () => {
    const memory = buildMemory(buildFakeCartridge());
    const section = memory.getSectionByTag('MBC');
    expect(section, 'le tag "MBC" doit exister').toBeDefined();
    expect(hex(section.start), 'début de plage').toBe('0x0000');
    expect(hex(section.stop), 'fin de plage — gare au F manquant !').toBe('0x7FFF');
  });

  it('read délègue au mbc sur toute la plage, bornes comprises', () => {
    const memory = buildMemory(buildFakeCartridge());
    expect(hex(memory.read(0x0000), 2), 'première adresse').toBe('0x11');
    expect(hex(memory.read(0x0100), 2), 'le point d\'entrée').toBe('0x42');
    expect(hex(memory.read(0x7fff), 2), 'dernière adresse de la plage').toBe('0x77');
  });

  it('à 0x8000 la frontière est franchie : la ram interne reprend la main', () => {
    const memory = buildMemory(buildFakeCartridge());
    memory.write(0x8000, 0x3c);
    expect(
      hex(memory.read(0x8000), 2),
      '0x8000 est la VRAM, plus la cartouche',
    ).toBe('0x3C');
  });

  it('write sur la plage ROM est transmis au mbc tel quel : adresse ET valeur', () => {
    const cart = buildFakeCartridge();
    const memory = buildMemory(cart);
    memory.write(0x2000, 0x03);
    memory.write(0x0000, 0x0a);
    memory.write(0x7fff, 0x1f);
    expect(
      cart.mbc.writes,
      'chaque commande doit arriver intacte, sans translation d\'adresse',
    ).toEqual([
      [0x2000, 0x03],
      [0x0000, 0x0a],
      [0x7fff, 0x1f],
    ]);
  });

  it('write sur la plage ROM est commande SEULE : aucun miroir dans la ram', () => {
    const memory = buildMemory(buildFakeCartridge());
    memory.write(0x0100, 0x99);
    expect(
      hex(memory.read(0x0100), 2),
      'relire doit rendre la valeur du mapper (0x42), pas un écho de la ram (0x99)',
    ).toBe('0x42');
  });

  it('écrire au-dessus de 0x8000 ne dérange jamais le mbc', () => {
    const cart = buildFakeCartridge();
    const memory = buildMemory(cart);
    memory.write(0xc000, 0x12);
    memory.write(0xffff, 0x01);
    expect(cart.mbc.writes, 'aucune commande ne doit fuiter hors plage').toEqual([]);
    expect(hex(memory.read(0xc000), 2), 'la WRAM fonctionne normalement').toBe('0x12');
    expect(hex(memory.read(0xffff), 2), 'IE aussi, cartouche branchée').toBe('0x01');
  });
});
