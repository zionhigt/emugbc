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

const buildAll = () => {
  const serial = buildFakeSerial();
  const cpu = new CPU(buildMemory(undefined, serial));
  const Decoder = buildDecoder(cpu, instructions);
  const decoder = new Decoder();
  const clock = buildFakeClock();
  const Machine = buildMachine(cpu, decoder, clock, serial);
  const machine = new Machine();
  return { cpu, decoder, clock, serial, machine };
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
      ).toBe('P');
    });
  });
});
