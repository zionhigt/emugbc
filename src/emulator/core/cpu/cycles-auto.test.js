import { describe, it, expect } from 'vitest';

import CPU from './CPU';
import buildInstructions from './instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';

/**
 * LA FACTURATION AUTOMATIQUE, SEULE.
 *
 * Ce fichier ne couvre QUE les instructions dont le coût est intégralement expliqué par
 * les accès au bus : fetch de l'opcode, préfixe CB, octets d'opérande, lectures et
 * écritures de données. Aucun cycle interne, aucune branche conditionnelle.
 *
 * Autrement dit : tout ce qui doit être JUSTE avec le seul port sur cpu.memory, sans
 * qu'une ligne soit ajoutée dans instructions.js. C'est le test du port lui-même.
 *
 * Hors périmètre (voir cycles-internes.test.js) :
 *   - les 18 identifiants à cycle interne (INC rr, ADD HL,rr, les sauts, la pile...)
 *   - les 4 conditionnels, qui créditent encore extraCycle depuis la config
 *
 * L'attendu vient de `instructions[id].cycle`. Ce n'est pas une tautologie tant que la
 * mesure ne consulte pas la config : le dernier test le vérifie sur une table truquée.
 */

const instructions = buildInstructions();

// Le programme est posé via cpu.memory.write, qui FACTURE depuis le port :
// d'où le resetCycles() avant de mesurer.
const makeCpu = (program, at = 0xc000) => {
  const cpu = new CPU(buildMemory());
  program.forEach((b, i) => cpu.memory.write(at + i, b));
  cpu.registers.PC.setValue(at);
  cpu.registers.SP.setValue(0xdff0);
  return cpu;
};

/** Ce que le CPU a réellement dépensé. step() remet à zéro en sortant : on photographie avant. */
const measureWith = (table, program, setup = () => {}) => {
  const cpu = makeCpu(program);
  setup(cpu);
  cpu.resetCycles();

  const Decoder = buildDecoder(cpu, table);
  const decoder = new Decoder();

  let mesure = null;
  const reset = cpu.resetCycles.bind(cpu);
  cpu.resetCycles = () => {
    if (mesure === null) mesure = cpu.cycles;
    reset();
  };

  decoder.step();
  expect(mesure, 'step() doit remettre le compteur à zéro pour que la mesure soit lisible').not.toBe(null);
  return mesure;
};

const measure = (program, setup) => measureWith(instructions, program, setup);
const config = (id) => instructions[id].cycle;
const pointeHL = (cpu) => cpu.registers.HL.setValue(0xd000);

describe('Facturation automatique : le coût entièrement expliqué par le bus', () => {
  describe('le fetch seul : rien d\'autre ne se passe', () => {
    it('NOP (0x00) : 1 fetch', () => {
      expect(measure([0x00])).toBe(config('NOP'));
    });

    it('LD B,C (0x41) : registre à registre, le transfert est gratuit', () => {
      expect(measure([0x41])).toBe(config('LD_r8_r8'));
    });

    it('INC B (0x04) : l\'ALU 8 bits est gratuite', () => {
      expect(measure([0x04])).toBe(config('INC_r8'));
    });

    it('CPL (0x2F) : idem pour les opérations sur A', () => {
      expect(measure([0x2f])).toBe(config('CPL'));
    });

    it('JP HL (0xE9) : le saut est gratuit, le fetch suivant est adressé par HL', () => {
      expect(measure([0xe9], (cpu) => cpu.registers.HL.setValue(0xc000))).toBe(config('JP_HL'));
    });
  });

  describe('les octets d\'opérande : 1 cycle chacun', () => {
    it('LD B,n8 (0x06) : fetch + 1 opérande', () => {
      expect(measure([0x06, 0x42])).toBe(config('LD_r8_n8'));
    });

    it('ADD A,n8 (0xC6) : fetch + 1 opérande, l\'addition ne coûte rien', () => {
      expect(measure([0xc6, 0x42])).toBe(config('ADD_A_n8'));
    });

    it('LD BC,nn (0x01) : fetch + 2 opérandes', () => {
      expect(measure([0x01, 0x34, 0x12])).toBe(config('LD_r16_n16'));
    });
  });

  describe('les accès aux données : 1 cycle par aller-retour sur le bus', () => {
    it('LD A,[HL] (0x7E) : fetch + 1 lecture', () => {
      expect(measure([0x7e], pointeHL)).toBe(config('LD_r8_HL'));
    });

    it('LD [HL],A (0x77) : fetch + 1 écriture', () => {
      expect(measure([0x77], pointeHL)).toBe(config('LD_HL_r8'));
    });

    it('LD A,[BC] (0x0A) : même profil, autre pointeur', () => {
      expect(measure([0x0a], (cpu) => cpu.registers.BC.setValue(0xd000))).toBe(config('LD_A_r16'));
    });

    it('LD [HL+],A (0x22) : l\'incrément de HL passe par l\'IDU, il ne coûte rien ici', () => {
      expect(measure([0x22], pointeHL)).toBe(config('LD_HLI_A'));
    });

    it('ADD A,[HL] (0x86) : fetch + 1 lecture', () => {
      expect(measure([0x86], pointeHL)).toBe(config('ADD_A_HL'));
    });

    it('LD [HL],n8 (0x36) : fetch + 1 opérande + 1 écriture', () => {
      expect(measure([0x36, 0x42], pointeHL)).toBe(config('LD_HL_n8'));
    });

    it('INC [HL] (0x34) : fetch + 1 lecture + 1 écriture — lire et réécrire se paient à part', () => {
      expect(measure([0x34], pointeHL)).toBe(config('INC_HL'));
    });

    it('LDH A,[C] (0xF2) : fetch + 1 lecture dans la page 0xFF00', () => {
      expect(measure([0xf2], (cpu) => cpu.registers.C.setValue(0x80))).toBe(config('LDH_A_C'));
    });

    it('LDH [n],A (0xE0) : fetch + 1 opérande + 1 écriture', () => {
      expect(measure([0xe0, 0x80])).toBe(config('LDH_n16_A'));
    });

    it('LD A,[nn] (0xFA) : fetch + 2 opérandes + 1 lecture', () => {
      expect(measure([0xfa, 0x00, 0xd0])).toBe(config('LD_A_n16'));
    });

    it('LD [nn],A (0xEA) : fetch + 2 opérandes + 1 écriture', () => {
      expect(measure([0xea, 0x00, 0xd0])).toBe(config('LD_n16_A'));
    });

    it('LD [nn],SP (0x08) : fetch + 2 opérandes + 2 écritures — 16 bits = deux passages', () => {
      expect(measure([0x08, 0x00, 0xd0])).toBe(config('LD_n16_SP'));
    });

    it('POP BC (0xC1) : fetch + 2 lectures pile, AUCUN interne (contrairement à PUSH)', () => {
      expect(measure([0xc1])).toBe(config('POP_r16'));
    });
  });

  describe('le préfixe CB : un opcode qui en cache un autre, donc deux fetchs', () => {
    it('BIT 0,B (0xCB 0x40) : deux fetchs, rien de plus', () => {
      expect(measure([0xcb, 0x40])).toBe(config('BIT_u3_r8'));
    });

    it('SWAP B (0xCB 0x30) : deux fetchs, l\'échange de quartets est gratuit', () => {
      expect(measure([0xcb, 0x30])).toBe(config('SWAP_r8'));
    });

    it('BIT 0,[HL] (0xCB 0x46) : deux fetchs + 1 lecture — BIT ne réécrit pas', () => {
      expect(measure([0xcb, 0x46], pointeHL)).toBe(config('BIT_u3_HL'));
    });

    it('RLC [HL] (0xCB 0x06) : deux fetchs + 1 lecture + 1 écriture', () => {
      expect(measure([0xcb, 0x06], pointeHL)).toBe(config('RLC_HL'));
    });
  });

  describe('anti-tautologie : la mesure ne doit pas venir de la config', () => {
    it('fausser instructions.LD_r8_HL.cycle ne change pas ce que le CPU dépense', () => {
      const vrai = measure([0x7e], pointeHL);

      // Table forgée par recopie : `instructions` est un singleton de module, le muter
      // polluerait tous les autres fichiers de test.
      const forgee = {
        ...instructions,
        LD_r8_HL: { ...instructions.LD_r8_HL, cycle: instructions.LD_r8_HL.cycle + 7 },
      };
      const truque = measureWith(forgee, [0x7e], pointeHL);

      expect(
        truque,
        'cpu.cycles a suivi la config truquée : la dépense est recopiée, pas mesurée'
      ).toBe(vrai);
    });
  });
});
