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

describe('Blocage VRAM/OAM : le PPU verrouille l\'accès CPU selon son mode', () => {
  // Une mémoire avec un PPU PILOTABLE : on force son mode et l'état LCD.
  // La section lit le mode via `computeState` (dot-précis) ; ici on le rend
  // constant quel que soit l'offset, donc le blocage se réduit à « ce mode bloque-t-il ? ».
  // (serial/timer/joypad restent undefined : les tests ne touchent que VRAM/OAM.)
  const buildMem = (mode, isOn = true) => buildMemory(
    buildFakeCartridge(),
    undefined,
    undefined,
    { computeState: () => ({ mode }), totalMachineCycles: 0, LCDC: { isOn }, read: () => 0, write: () => {}, check: () => {} },
    undefined,
  );

  it('VRAM : lecture CPU rend 0xFF en mode 3 (dessin)', () => {
    const mem = buildMem(3);
    mem._write(0x8000, 0x3c); // valeur réelle posée en BRUT (le PPU, lui, y accède)
    expect(hex(mem.read(0x8000), 2), 'VRAM verrouillée en mode 3').toBe('0xFF');
  });

  it('VRAM : écriture CPU ignorée en mode 3', () => {
    const mem = buildMem(3);
    mem.write(0x8000, 0x3c);
    expect(mem._read(0x8000), 'rien n\'a atteint la ram').toBe(0);
  });

  it('VRAM : ouverte hors mode 3 (modes 0 et 2)', () => {
    for (const mode of [0, 2]) {
      const mem = buildMem(mode);
      mem.write(0x8000, 0x3c);
      expect(hex(mem.read(0x8000), 2), `mode ${mode} : accès libre`).toBe('0x3C');
    }
  });

  it('OAM : verrouillée en modes 2 ET 3 (scan + dessin)', () => {
    for (const mode of [2, 3]) {
      const mem = buildMem(mode);
      mem._write(0xfe00, 0x11);
      expect(hex(mem.read(0xfe00), 2), `OAM bloquée en mode ${mode}`).toBe('0xFF');
    }
  });

  it('OAM : ouverte en mode 0 (HBlank)', () => {
    const mem = buildMem(0);
    mem.write(0xfe00, 0x11);
    expect(hex(mem.read(0xfe00), 2), 'HBlank : OAM libre').toBe('0x11');
  });

  it('écran éteint : tout ouvert, même mode 3 (le mode est figé, sans le LCD c\'est faux)', () => {
    const mem = buildMem(3, false); // mode 3 MAIS écran coupé
    mem.write(0x8000, 0x3c);
    expect(hex(mem.read(0x8000), 2), 'LCD off = VRAM ouverte').toBe('0x3C');
    mem.write(0xfe00, 0x11);
    expect(hex(mem.read(0xfe00), 2), 'LCD off = OAM ouverte').toBe('0x11');
  });

  it('le contournement PPU (_read/_write) ignore le verrou', () => {
    const mem = buildMem(3); // tout bloqué côté CPU
    mem._write(0x8000, 0xab);
    expect(hex(mem._read(0x8000), 2), 'le PPU lit sa VRAM malgré le mode 3').toBe('0xAB');
    expect(hex(mem.read(0x8000), 2), 'mais le CPU, lui, reste dehors').toBe('0xFF');
  });
});

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

describe('Memory + joypad : 0xFF00 est routé vers le contrôleur manette', () => {
  // Un contrôleur joypad espion : le bus doit lui déléguer read/write sur 0xFF00.
  // (le comportement de la matrice — sélection de colonne, actif bas — est
  // testé chez le contrôleur lui-même, pas ici.)
  const serial = { read() {}, write() {}, echo() {} };
  const timer = { read: () => 0, write() {} };
  const ppu = { read: () => 0, write() {}, check() {} };
  const buildFakeJoypad = () => {
    const writes = [];
    return { writes, read: () => 0xff, write: (addr, v) => writes.push([addr, v]) };
  };

  it('lire 0xFF00 délègue au contrôleur (ici 0xFF : aucune touche pressée)', () => {
    const joypad = buildFakeJoypad();
    const memory = buildMemory(undefined, serial, timer, ppu, joypad);
    expect(hex(memory.read(0xff00), 2), 'le contrôleur répond, pas la ram plate').toBe('0xFF');
  });

  it('écrire 0xFF00 (la sélection de colonne) est transmis au contrôleur', () => {
    const joypad = buildFakeJoypad();
    const memory = buildMemory(undefined, serial, timer, ppu, joypad);
    memory.write(0xff00, 0x20); // le jeu sélectionne une colonne de la matrice
    expect(
      joypad.writes,
      'la sélection doit atteindre le contrôleur (adresse + valeur)',
    ).toEqual([[0xff00, 0x20]]);
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
  const a = 'a'.charCodeAt(0);
  const s = 's'.charCodeAt(0);

  it('la sonnette : écrire le caractère en 0xFF01 puis 0x81 en 0xFF02 déclenche echo', () => {
    const serial = buildFakeSerial();
    const memory = buildMemory(undefined, serial);
    memory.write(0xff01, P);
    expect(serial.echos, 'pas encore : la lettre attend dans la boîte').toEqual([]);
    memory.write(0xff02, 0x81);
    expect(serial.echos, 'sonnette ! le maître reçoit le buffer, en OCTETS').toEqual([[P]]);
  });

  it('le buffer est cumulatif : chaque sonnette renvoie TOUT le message', () => {
    const serial = buildFakeSerial();
    const memory = buildMemory(undefined, serial);
    for (const c of 'Pas') {
      memory.write(0xff01, c.charCodeAt(0));
      memory.write(0xff02, 0x81);
    }
    expect(serial.echos, 'des instantanés qui grandissent').toEqual([[P], [P, a], [P, a, s]]);
  });

  // Ce qui déclenche un transfert, c'est le BIT 7 seul — les bits bas décrivent
  // l'horloge (interne/externe, normale/rapide) et ne disent rien du départ.
  // Tester l'égalité à 0x81 marchait tant que Blargg était la seule ROM d'essai :
  // mooneye écrit 0x83 (bit 7 + horloge rapide) et ne sonnait jamais.
  it.each([
    { sc: 0x00, nom: '0x00 — tout éteint' },
    { sc: 0x01, nom: '0x01 — horloge choisie, mais pas de départ' },
    { sc: 0x03, nom: '0x03 — horloge rapide choisie, toujours pas de départ' },
  ])('bit 7 à zéro : $nom ne sonne pas', ({ sc }) => {
    const serial = buildFakeSerial();
    const memory = buildMemory(undefined, serial);
    memory.write(0xff01, P);
    memory.write(0xff02, sc);
    expect(serial.echos, 'sans le bit 7, aucun transfert n\'est demandé').toEqual([]);
  });

  it.each([
    { sc: 0x80, nom: '0x80 — bit 7 nu' },
    { sc: 0x81, nom: '0x81 — celui de Blargg' },
    { sc: 0x83, nom: '0x83 — celui de mooneye, horloge rapide' },
  ])('bit 7 levé : $nom sonne, quels que soient les bits d\'horloge', ({ sc }) => {
    const serial = buildFakeSerial();
    const memory = buildMemory(undefined, serial);
    memory.write(0xff01, P);
    memory.write(0xff02, sc);
    expect(serial.echos, 'le bit 7 demande le transfert, à lui seul').toEqual([[P]]);
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
    const memory = buildMemory(
      buildFakeCartridge(),
      serial,
      { read: () => 0, write: () => {} },        // timer
      { read: () => 0, write: () => {}, check: () => {} }, // ppu
      { read: () => 0xff, write: () => {} },      // joypad
    );
    expect(memory.getSectionByTag('serial'), 'le tag doit exister').toBeDefined();
    // les voisins ne débordent pas sur la série : 0xFF00 (joypad) et 0xFF03 (ram plate)
    memory.write(0xff00, 0x30); // → joypad, pas série
    memory.write(0xff03, 0x42); // → ram plate, pas série
    expect(serial.writes, 'aucun trafic série pour les adresses voisines').toEqual([]);
    expect(hex(memory.read(0x0100), 2), 'et la cartouche répond toujours').toBe('0x42');
  });
});
