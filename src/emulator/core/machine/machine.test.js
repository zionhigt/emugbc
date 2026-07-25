import { describe, it, expect } from 'vitest';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';

const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

const instructions = buildInstructions();

// Le budget d'une trame : fréquence machine exacte / cadence d'image exacte.
const BUDGET = Math.floor(1048576 / 59.7275); // 17 556 cycles

// Une clock espionne : le contrat onTick/start/stop/tick, plus des témoins.
const buildFakeClock = () => {
  const cbs = [];
  return {
    cbs,
    started: false,
    onTick(cb) { cbs.push(cb); },
    start() { this.started = true; },
    stop() { this.started = false; },
    tick() { cbs.forEach((cb) => cb({ detail: 'tick' })); }, // la manivelle
  };
};

// Une cartouche factice : 32 Ko, un programme optionnel posé à 0x0100.
const buildFakeCartridge = (program = []) => {
  const rom = new Uint8Array(0x8000);
  program.forEach((b, i) => { rom[0x0100 + i] = b; });
  return { mbc: { read: (addr) => rom[addr], write: () => {} } };
};

// Le contrôleur série maître : un organe de la console, injecté à la factory.
const buildFakeSerial = () => ({
  reads: [],
  writes: [],
  echos: [],
  read(addr) { this.reads.push(addr); },
  write(addr, value) { this.writes.push([addr, value]); },
  echo(buffer) { this.echos.push(buffer); },
});

// Un timer factice : le contrat read/write du contrôleur, réponses neutres
// (un octet, TOUJOURS — le bus ne tolère pas les locataires muets).
const buildFakeTimer = () => ({
  read: () => 0,
  write: () => {},
});

// Un PPU factice pour la mémoire initiale (celle d'avant plugCartridge) :
// même contrat, mêmes réponses neutres.
const buildFakePPU = () => ({
  read: () => 0,
  write: () => {},
  check: () => {},
  // le verrou VRAM/OAM consulte le mode et l'état LCD ; écran éteint = accès
  // toujours ouvert, ce qui rend ce mock inoffensif pour les tests machine.
  mode: 0,
  LCDC: { isOn: false },
});

// Un joypad factice : 0xFF = aucune touche pressée (actif bas).
const buildFakeJoypad = () => ({
  read: () => 0xff,
  write: () => {},
});

const buildAll = () => {
  const serial = buildFakeSerial();
  const timer = buildFakeTimer();
  // Le bus NU : la machine (et donc le PPU) le reçoit tel quel, le CPU en reçoit une vue
  // qui facture. Sans ça, chaque lecture de VRAM du PPU serait débitée au CPU.
  const memory = buildMemory(undefined, serial, timer, buildFakePPU(), buildFakeJoypad());
  const cpu = new CPU(memory);
  const Decoder = buildDecoder(cpu, instructions);
  const decoder = new Decoder();
  const clock = buildFakeClock();
  const Machine = buildMachine(memory, cpu, decoder, clock, serial, timer);
  const machine = new Machine();
  return { cpu, decoder, clock, serial, timer, machine };
};

describe('Machine : le chef d\'orchestre', () => {
  it('la factory rend la classe : new Machine() expose start, stop et plugCartridge', () => {
    const { machine } = buildAll();
    for (const m of ['start', 'stop', 'plugCartridge']) {
      expect(typeof machine[m], `${m} doit être appelable`).toBe('function');
    }
  });

  describe('le temps : abonnée à la clock, mais maîtresse du départ', () => {
    it('la construction s\'abonne au tick SANS démarrer la clock', () => {
      const { clock } = buildAll();
      expect(clock.cbs.length, 'un abonnement posé').toBe(1);
      expect(clock.started, 'mais le temps ne coule pas encore').toBe(false);
    });

    it('start() et stop() délèguent à la clock', () => {
      const { clock, machine } = buildAll();
      machine.start();
      expect(clock.started, 'start relayé').toBe(true);
      machine.stop();
      expect(clock.started, 'stop relayé').toBe(false);
    });
  });

  describe('la trame : chaque tick dépense le budget, exactement', () => {
    it(`un tick fait avancer un NOP slide de ${BUDGET} adresses (1 cycle = 1 octet)`, () => {
      const { cpu, clock } = buildAll();
      // mémoire plate vierge = que des 0x00 = que des NOP à 1 cycle
      cpu.registers.PC.setValue(0x0000);
      clock.tick();
      expect(
        hex(cpu.registers.PC.getValue()),
        'PC est le compteur de cycles du NOP slide',
      ).toBe(hex(BUDGET));
    });

    it('deux ticks = deux budgets : rien ne fuit, rien ne se perd', () => {
      const { cpu, clock } = buildAll();
      cpu.registers.PC.setValue(0x0000);
      clock.tick();
      clock.tick();
      expect(hex(cpu.registers.PC.getValue()), 'le double exact').toBe(hex(BUDGET * 2));
    });
  });

  describe('plugCartridge : insérer, recâbler, préparer', () => {
    it('recâble le bus : la ROM de la cartouche répond sur 0x0000-0x7FFF', () => {
      const { cpu, machine } = buildAll();
      machine.plugCartridge(buildFakeCartridge([0x42]));
      expect(
        hex(cpu.memory.read(0x0100), 2),
        'l\'octet posé à 0x0100 dans la ROM factice',
      ).toBe('0x42');
    });

    it('installe l\'état post-boot : les registres que la boot ROM laisse derrière elle', () => {
      const { cpu, machine } = buildAll();
      machine.plugCartridge(buildFakeCartridge());
      expect(hex(cpu.registers.PC.getValue()), 'PC au point d\'entrée').toBe(hex(0x0100));
      expect(hex(cpu.registers.SP.getValue()), 'SP en haut de la HRAM').toBe(hex(0xfffe));
      expect(hex(cpu.registers.AF.getValue()), 'AF post-boot DMG').toBe(hex(0x01b0));
      expect(hex(cpu.registers.BC.getValue()), 'BC post-boot').toBe(hex(0x0013));
      expect(hex(cpu.registers.DE.getValue()), 'DE post-boot').toBe(hex(0x00d8));
      expect(hex(cpu.registers.HL.getValue()), 'HL post-boot (= 0x014D, l\'adresse du checksum !)').toBe(hex(0x014d));
    });

    it('la Stack suit le recâblage : un push après plug atterrit dans la NOUVELLE mémoire', () => {
      const { cpu, machine } = buildAll();
      machine.plugCartridge(buildFakeCartridge());
      cpu.stack.push(0x1234); // SP post-boot = 0xFFFE
      expect(
        hex(cpu.memory.read(0xfffd), 2),
        'octet haut empilé — si tu lis 0x00, la Stack écrit encore dans la mémoire ORPHELINE',
      ).toBe('0x12');
      expect(hex(cpu.memory.read(0xfffc), 2), 'octet bas empilé').toBe('0x34');
    });
  });

  describe('getFisrtLowBit : l\'arbitre de priorité — rend le MASQUE isolé du bit levé le plus bas', () => {
    // Contrat figé : pas l'indice n, mais 1 << n — directement utilisable
    // pour l'acquittement (IF & ~masque). 0 = personne ne sonne.
    it.each([
      { n: 0b00001, exp: 0b00001, cas: 'bit 0 seul' },
      { n: 0b00010, exp: 0b00010, cas: 'bit 1 seul' },
      { n: 0b10000, exp: 0b10000, cas: 'bit 4 seul' },
      { n: 0b00101, exp: 0b00001, cas: 'bits 0 et 2 : le 0 est prioritaire' },
      { n: 0b00110, exp: 0b00010, cas: 'bits 1 et 2 : le 1 passe devant' },
      { n: 0b11000, exp: 0b01000, cas: 'bits 3 et 4 : le 3 gagne' },
      { n: 0b11111, exp: 0b00001, cas: 'tous levés : le 0 écrase tout le monde' },
    ].map((c) => ({
      ...c,
      label: `getFisrtLowBit(0b${c.n.toString(2).padStart(5, '0')})`,
      expLabel: `0b${c.exp.toString(2).padStart(5, '0')}`,
    })))(
      '$cas : $label = $expLabel',
      ({ n, exp, label }) => {
        const { machine } = buildAll();
        expect(machine.getFisrtLowBit(n), label).toBe(exp);
      },
    );

    it('0 : aucun bit levé, rien à servir — rend 0 (falsy)', () => {
      const { machine } = buildAll();
      expect(machine.getFisrtLowBit(0), 'la valeur « personne ne sonne »').toBe(0);
    });
  });

  describe('dispatch : le standardiste des interruptions', () => {
    // État de base : IME allumé (porte immédiate), PC et SP posés,
    // IE/IF écrits par le bus comme le ferait un programme.
    const armCpu = ({ ie = 0, iF = 0, ime = true } = {}) => {
      const all = buildAll();
      const { cpu } = all;
      cpu.registers.PC.setValue(0xc234);
      cpu.registers.SP.setValue(0xfffe);
      if (ime) cpu.start();
      cpu.memory.write(0xffff, ie);
      cpu.memory.write(0xff0f, iF);
      return all;
    };

    // dispatch() ne REND plus son coût, il le FACTURE. On mesure donc sur l'horloge du
    // monde — jamais remise à zéro, contrairement à cpu.cycles que step() vide.
    // Le repère est pris après armCpu, dont les écritures IE/IF passent par le port
    // et se facturent elles aussi.
    const coutDuDispatch = (machine) => {
      const avant = machine.totalCycles;
      machine.dispatch();
      return machine.totalCycles - avant;
    };

    it('personne ne sonne (IE=0, IF=0) : 0 cycle, rien ne bouge', () => {
      const { cpu, machine } = armCpu();
      expect(coutDuDispatch(machine), 'aucun coût').toBe(0);
      expect(hex(cpu.registers.PC.getValue()), 'PC intact').toBe(hex(0xc234));
      expect(cpu.ime, 'IME toujours allumé').toBe(true);
    });

    it('IME éteint : le disjoncteur coupe TOUT, même une frappe autorisée', () => {
      const { cpu, machine } = armCpu({ ie: 0b00100, iF: 0b00100, ime: false });
      expect(coutDuDispatch(machine), 'aucun service disjoncteur baissé').toBe(0);
      expect(hex(cpu.registers.PC.getValue()), 'PC intact').toBe(hex(0xc234));
      expect(cpu.memory.read(0xff0f), 'IF NON acquitté : la frappe attend').toBe(0b00100);
    });

    it("frappe sans autorisation (IF levé, IE muet) : on n'ouvre pas", () => {
      const { cpu, machine } = armCpu({ ie: 0b00000, iF: 0b00100 });
      expect(coutDuDispatch(machine)).toBe(0);
      expect(cpu.memory.read(0xff0f), 'la frappe reste en attente dans IF').toBe(0b00100);
    });

    it('service complet du Timer : 5 cycles, PC=0x50, IME coupé, IF acquitté, retour empilé', () => {
      const { cpu, machine } = armCpu({ ie: 0b00100, iF: 0b00100 });
      expect(coutDuDispatch(machine), 'le coût du saut').toBe(5);
      expect(hex(cpu.registers.PC.getValue()), 'PC au vecteur Timer').toBe(hex(0x0050));
      expect(cpu.ime, 'IME coupé dans le même souffle').toBe(false);
      expect(cpu.memory.read(0xff0f), 'IF acquitté : le bit servi est éteint').toBe(0);
      expect(cpu.memory.read(0xffff), 'IE JAMAIS modifié par le dispatch').toBe(0b00100);
      expect(hex(cpu.memory.read(0xfffd), 2), 'retour empilé, octet haut').toBe('0xC2');
      expect(hex(cpu.memory.read(0xfffc), 2), 'retour empilé, octet bas').toBe('0x34');
      expect(hex(cpu.registers.SP.getValue()), 'SP descendu de 2').toBe(hex(0xfffc));
    });

    it('priorité : VBlank (bit 0) passe devant le Timer (bit 2), qui RESTE en attente', () => {
      const { cpu, machine } = armCpu({ ie: 0b11111, iF: 0b00101 });
      machine.dispatch();
      expect(hex(cpu.registers.PC.getValue()), 'servi : VBlank, 0x40').toBe(hex(0x0040));
      expect(
        cpu.memory.read(0xff0f),
        'le Timer frappe toujours — SEUL le bit servi est acquitté',
      ).toBe(0b00100);
    });

    it.each([
      { mask: 0b00001, vecteur: 0x40, source: 'VBlank', label: '0x40' },
      { mask: 0b00010, vecteur: 0x48, source: 'LCD STAT', label: '0x48' },
      { mask: 0b00100, vecteur: 0x50, source: 'Timer', label: '0x50' },
      { mask: 0b01000, vecteur: 0x58, source: 'Serial', label: '0x58' },
      { mask: 0b10000, vecteur: 0x60, source: 'Joypad', label: '0x60' },
    ])('le vecteur de $source : masque $mask = PC $label', ({ mask, vecteur }) => {
      const { cpu, machine } = armCpu({ ie: 0b11111, iF: mask });
      machine.dispatch();
      expect(hex(cpu.registers.PC.getValue()), 'le bon guichet').toBe(hex(vecteur));
    });
  });

  describe('totalCycles : l\'horloge du monde — cumulée par la boucle, jamais remise à zéro', () => {
    it('démarre à 0 et encaisse exactement le budget d\'une trame de NOP', () => {
      const { cpu, clock, machine } = buildAll();
      expect(machine.totalCycles, 'au réveil').toBe(0);
      cpu.registers.PC.setValue(0x0000); // NOP slide
      clock.tick();
      expect(machine.totalCycles, 'une trame de NOP à 1 cycle pièce').toBe(BUDGET);
    });

    it('survit à la frontière de trame : deux ticks cumulent, rien ne remet à zéro', () => {
      const { cpu, clock, machine } = buildAll();
      cpu.registers.PC.setValue(0x0000);
      clock.tick();
      clock.tick();
      expect(machine.totalCycles, 'le double exact — c\'est l\'horloge que le timer lira').toBe(BUDGET * 2);
    });
  });

  describe('la promotion d\'EI : IME s\'allume APRÈS l\'instruction suivante — le sous-test #2 de Blargg', () => {
    // Programme posé en WRAM, interruption Timer déjà en attente (IE et IF
    // armés). Le moment du service se lit sur l'ADRESSE DE RETOUR empilée.
    const armProgram = (program) => {
      const all = buildAll();
      const { cpu } = all;
      program.forEach((b, i) => cpu.memory.write(0xc000 + i, b));
      cpu.registers.PC.setValue(0xc000);
      cpu.registers.SP.setValue(0xfffe);
      cpu.memory.write(0xffff, 0b00100); // IE : Timer autorisé
      cpu.memory.write(0xff0f, 0b00100); // IF : Timer frappe déjà
      return all;
    };

    it('EI puis NOP : le service attend la fin du NOP (retour = 0xC002, pas 0xC001)', () => {
      const { cpu, clock } = armProgram([0xfb, 0x00]); // EI ; NOP
      clock.tick();
      expect(
        cpu.memory.read(0xff0f) & 0b00100,
        'l\'interruption TIMER a bien été servie dans la trame (le bit VBlank du PPU vit sa vie)',
      ).toBe(0);
      const retour = (cpu.memory.read(0xfffd) << 8) | cpu.memory.read(0xfffc);
      expect(
        hex(retour),
        'retour empilé : APRÈS le NOP qui suit EI — un service dès la fin d\'EI (0xC001) est trop tôt',
      ).toBe(hex(0xc002));
    });

    it('EI puis DI : l\'allumage programmé est ANNULÉ, aucune interruption ne part', () => {
      const { cpu, clock } = armProgram([0xfb, 0xf3]); // EI ; DI
      clock.tick();
      expect(cpu.ime, 'IME jamais allumé').toBe(false);
      expect(
        cpu.memory.read(0xff0f) & 0b00100,
        'IF jamais acquitté : la frappe timer attend toujours, personne n\'a ouvert',
      ).toBe(0b00100);
    });
  });

  describe('HALT : le CPU dort, le monde continue — le dernier sous-test de Blargg', () => {
    // Programme en WRAM : HALT puis LD A,0x42 puis la boucle finale JR -2.
    // Selon IE/IF/IME, le réveil et le service racontent des histoires différentes.
    const armHalt = ({ ie = 0, iF = 0, ime = false } = {}) => {
      const all = buildAll();
      const { cpu } = all;
      [0x76, 0x3e, 0x42, 0x18, 0xfe].forEach((b, i) => cpu.memory.write(0xc000 + i, b));
      cpu.registers.PC.setValue(0xc000);
      cpu.registers.SP.setValue(0xfffe);
      if (ime) cpu.start();
      cpu.memory.write(0xffff, ie);
      cpu.memory.write(0xff0f, iF);
      return all;
    };

    it('garé sans réveil possible : PC gèle juste après le HALT, la trame se termine quand même', () => {
      const { cpu, clock } = armHalt(); // IE=0, IF=0 : personne ne viendra
      clock.tick(); // la boucle doit consommer son budget en cycles de sommeil, PAS pendre
      expect(cpu.halted, 'toujours garé en fin de trame').toBe(true);
      expect(
        hex(cpu.registers.PC.getValue()),
        'PC figé sur l\'instruction suivant le HALT — rien ne s\'exécute',
      ).toBe(hex(0xc001));
      expect(cpu.registers.A.getValue(), 'le LD A,0x42 n\'a PAS tourné').toBe(0);
    });

    it('le temps avance pendant le sommeil : totalCycles encaisse la trame entière', () => {
      const { clock, machine } = armHalt();
      clock.tick();
      expect(
        machine.totalCycles,
        'dormir coûte des cycles — sinon le timer qui doit réveiller ne battrait plus',
      ).toBeGreaterThanOrEqual(BUDGET);
    });

    it('réveil SANS service (IME éteint) : l\'exécution reprend après le HALT, IF intact', () => {
      const { cpu, clock } = armHalt({ ie: 0b00100, iF: 0b00100, ime: false });
      clock.tick();
      expect(cpu.halted, 'réveillé : IE & IF suffit, IME n\'a pas son mot à dire').toBe(false);
      expect(hex(cpu.registers.A.getValue(), 2), 'le LD A,0x42 a tourné').toBe('0x42');
      expect(
        cpu.memory.read(0xff0f) & 0b00100,
        'PAS de service : IF non acquitté, la frappe timer attend toujours',
      ).toBe(0b00100);
    });

    it('réveil AVEC service (IME allumé) : la frappe arrive PENDANT le sommeil, retour empilé après le HALT', () => {
      // Phase 1 : le CPU s'endort — IE et IME armés, mais personne ne frappe encore.
      const { cpu, clock } = armHalt({ ie: 0b00100, iF: 0, ime: true });
      clock.tick();
      expect(cpu.halted, 'endormi, la trame s\'est écoulée sans frappe').toBe(true);

      // Phase 2 : la frappe tombe pendant le sommeil, la trame suivante réveille ET sert.
      cpu.memory.write(0xff0f, 0b00100);
      clock.tick();
      expect(cpu.ime, 'IME coupé : le service a eu lieu').toBe(false);
      expect(cpu.memory.read(0xff0f) & 0b00100, 'IF acquitté').toBe(0);
      const retour = (cpu.memory.read(0xfffd) << 8) | cpu.memory.read(0xfffc);
      expect(
        hex(retour),
        'l\'adresse empilée pointe APRÈS le HALT (0xC001) — le réveil a précédé le service',
      ).toBe(hex(0xc001));
    });

    it('frappe déjà en attente au moment du HALT (IME allumé) : service immédiat, AVANT le HALT', () => {
      // Le contre-cas, celui du vrai matériel : l\'interruption part sur-le-champ,
      // le HALT n\'est même pas atteint — retour 0xC000.
      const { cpu, clock } = armHalt({ ie: 0b00100, iF: 0b00100, ime: true });
      clock.tick();
      const retour = (cpu.memory.read(0xfffd) << 8) | cpu.memory.read(0xfffc);
      expect(
        hex(retour),
        'le dispatch précède le step : le HALT n\'a jamais eu son tour',
      ).toBe(hex(0xc000));
    });
  });

  describe('intégration : la première cartouche qui tourne', () => {
    it('LD A,0x42 puis JR -2 : après un tick, A est chargé et PC gare sur sa boucle', () => {
      const { cpu, clock, machine } = buildAll();
      machine.plugCartridge(buildFakeCartridge([0x3e, 0x42, 0x18, 0xfe]));
      clock.tick(); // une trame entière : le programme s'exécute puis piétine sur son JR
      expect(hex(cpu.registers.A.getValue(), 2), 'le programme a tourné').toBe('0x42');
      expect(
        hex(cpu.registers.PC.getValue()),
        'PC garé sur le JR -2 (0x0102) — la boucle finale canonique',
      ).toBe(hex(0x0102));
    });

    it('la console PARLE : un programme écrit "P" sur le port série, le maître l\'entend', () => {
      const { clock, serial, machine } = buildAll();
      // LD A,'P' ; LDH [0xFF01],A ; LD A,0x81 ; LDH [0xFF02],A ; JR -2
      machine.plugCartridge(buildFakeCartridge([
        0x3e, 0x50, // LD A, 'P'
        0xe0, 0x01, // LDH [0xFF01], A — la lettre dans la boîte
        0x3e, 0x81, // LD A, 0x81
        0xe0, 0x02, // LDH [0xFF02], A — la sonnette
        0x18, 0xfe, // JR -2 — garé pour toujours
      ]));
      clock.tick();
      expect(
        serial.echos.at(-1),
        'le protocole complet a traversé cartouche = bus = cpu = décodeur = section = maître',
      ).toEqual(['P'.charCodeAt(0)]);
    });
  });
});
