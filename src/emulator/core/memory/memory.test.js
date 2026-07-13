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

describe('Memory + joypad : 0xFF00, la logique INVERSÉE — le silence vaut 0xFF', () => {
  // Les boutons sont actifs à l'état BAS : un bit à 0 = pressé. Une ram
  // vierge qui lit 0x00 dit « TOUT est enfoncé » — dont A+B+Start+Select,
  // le combo de soft-reset de Tetris et de tant d'autres. Reset infini,
  // écran blanc éternel. Personne ne presse rien = tous les bits à 1.
  it('lire 0xFF00 sans manette branchée rend 0xFF, jamais 0x00', () => {
    const memory = buildMemory(undefined, { read() {}, write() {}, echo() {} });
    expect(
      hex(memory.read(0xff00), 2),
      '0x00 ici = tous les boutons pressés = le soft-reset en boucle',
    ).toBe('0xFF');
  });

  it('même après une écriture (la sélection de colonne), les bits de boutons restent hauts', () => {
    const memory = buildMemory(undefined, { read() {}, write() {}, echo() {} });
    memory.write(0xff00, 0x20); // le jeu sélectionne une colonne de la matrice
    expect(
      memory.read(0xff00) & 0x0f,
      'le nibble bas (les boutons) reste muet : 0b1111',
    ).toBe(0x0f);
  });
});

describe('Memory + série : la section 0xFF01-0xFF02 parle le protocole, le maître écoute', () => {
  // Le contrôleur maître : contrat read/write (reçus, jamais indispensables)
  // + echo(buffer), appelé PAR la section à chaque sonnette. Le buffer
  // transmis est CUMULATIF : la section renvoie tout ce qu'elle a vu.
  const buildFakeSerial = () => ({
    reads: [],
    writes: [],
    echos: [],
    read(addr) { this.reads.push(addr); },
    write(addr, value) { this.writes.push([addr, value]); },
    echo(buffer) { this.echos.push(buffer); },
  });

  const P = 'P'.charCodeAt(0); // 0x50

  it('la sonnette : écrire le caractère en 0xFF01 puis 0x81 en 0xFF02 déclenche echo', () => {
    const serial = buildFakeSerial();
    const memory = buildMemory(undefined, serial);
    memory.write(0xff01, P);
    expect(serial.echos, 'pas encore : la lettre attend dans la boîte').toEqual([]);
    memory.write(0xff02, 0x81);
    expect(serial.echos, 'sonnette ! le maître reçoit le buffer').toEqual(['P']);
  });

  it('le buffer est cumulatif : chaque sonnette renvoie TOUT le message', () => {
    const serial = buildFakeSerial();
    const memory = buildMemory(undefined, serial);
    for (const c of 'Pas') {
      memory.write(0xff01, c.charCodeAt(0));
      memory.write(0xff02, 0x81);
    }
    expect(serial.echos, 'des instantanés qui grandissent').toEqual(['P', 'Pa', 'Pas']);
  });

  it("écrire autre chose que 0x81 en 0xFF02 ne sonne pas", () => {
    const serial = buildFakeSerial();
    const memory = buildMemory(undefined, serial);
    memory.write(0xff01, P);
    memory.write(0xff02, 0x00);
    memory.write(0xff02, 0x80);
    expect(serial.echos, 'aucune sonnette sans 0x81').toEqual([]);
  });

  it('le maître reçoit aussi les write bruts (sans obligation de s\'en servir)', () => {
    const serial = buildFakeSerial();
    const memory = buildMemory(undefined, serial);
    memory.write(0xff01, P);
    memory.write(0xff02, 0x81);
    expect(serial.writes, 'le trafic brut, adresse et valeur').toEqual([
      [0xff01, P],
      [0xff02, 0x81],
    ]);
  });

  it('lire 0xFF01 rend le latch (write-through vers la ram) et notifie le maître', () => {
    const serial = buildFakeSerial();
    const memory = buildMemory(undefined, serial);
    memory.write(0xff01, P);
    expect(hex(memory.read(0xff01), 2), 'la lettre en attente est relisible').toBe('0x50');
    expect(serial.reads, 'le maître a vu passer la lecture').toEqual([0xff01]);
  });

  it('la section est récupérable par son tag "serial", et cohabite avec la cartouche', () => {
    const serial = buildFakeSerial();
    const memory = buildMemory(buildFakeCartridge(), serial);
    expect(memory.getSectionByTag('serial'), 'le tag doit exister').toBeDefined();
    // les voisins ne débordent pas : 0xFF00 (joypad) et 0xFF03 restent de la ram plate
    memory.write(0xff00, 0x30);
    memory.write(0xff03, 0x42);
    expect(serial.writes, 'aucun trafic série pour les adresses voisines').toEqual([]);
    expect(hex(memory.read(0x0100), 2), 'et la cartouche répond toujours').toBe('0x42');
  });
});
