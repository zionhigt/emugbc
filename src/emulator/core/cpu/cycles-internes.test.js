import { describe, it, expect } from 'vitest';

import CPU from './CPU';
import buildInstructions from './instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';

/**
 * LES CYCLES INTERNES.
 *
 * La facturation automatique (fetch + port sur cpu.memory) couvre les accès au bus.
 * Reste ce qu'aucun accès n'explique : l'ALU 16 bits, le rechargement de PC sur un saut
 * pris, le décrément de SP, la décision d'un conditionnel. 18 identifiants, listés dans
 * docs/cpu-cycles.md, dérivés de gbctr (gekkio) chapitre 6.
 *
 * L'ATTENDU VIENT DE LA CONFIG (`instructions[id].cycle`), pas d'un littéral. Ce n'est
 * pas une tautologie tant que la MESURE ne consulte pas la config — et c'est exactement
 * ce que le dernier test de ce fichier vérifie, en faisant tourner le décodeur sur une
 * table truquée.
 *
 * On mesure `cpu.cycles`, jamais le retour de step() : step() rend aujourd'hui
 * `cpu.cycles + instructions[id].cycle`, ce qui compterait deux fois.
 */

const instructions = buildInstructions();

// Le programme est posé via cpu.memory.write, qui FACTURE depuis le port.
// D'où le resetCycles() : la mise en place n'est pas de la dépense d'instruction.
const makeCpu = (program, at = 0xc000) => {
  const cpu = new CPU(buildMemory());
  program.forEach((b, i) => cpu.memory.write(at + i, b));
  cpu.registers.PC.setValue(at);
  cpu.registers.SP.setValue(0xdff0);
  return cpu;
};

/**
 * Rend ce que le CPU a réellement dépensé pendant l'instruction.
 * step() remet le compteur à zéro en sortant : on photographie juste avant.
 */
const measureWith = (table, program, setup = () => {}) => {
  const cpu = makeCpu(program);
  setup(cpu);
  cpu.resetCycles(); // la mise en place ne compte pas

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

// L'attendu, lu dans la config : total = cycle, et + extraCycle quand la branche est prise.
const attendu = (id, pris = false) =>
  instructions[id].cycle + (pris ? instructions[id].extraCycle : 0);

// Une adresse de retour posée sur la pile, pour RET / RET cc / RETI.
const empile = (cpu) => {
  cpu.memory.write(0xdfee, 0x34);
  cpu.memory.write(0xdfef, 0x12);
  cpu.registers.SP.setValue(0xdfee);
};

describe('Cycles internes : ce qu\'aucun accès au bus n\'explique', () => {
  describe('ALU et IDU 16 bits : le calcul ne tient pas dans le cycle du fetch', () => {
    it('INC BC (0x03) : fetch + 1 interne (incrément 16 bits par l\'IDU)', () => {
      expect(measure([0x03])).toBe(attendu('INC_r16'));
    });

    it('DEC BC (0x0B) : fetch + 1 interne', () => {
      expect(measure([0x0b])).toBe(attendu('DEC_r16'));
    });

    it('ADD HL,BC (0x09) : fetch + 1 interne (l\'ALU traite les deux moitiés)', () => {
      expect(measure([0x09])).toBe(attendu('ADD_HL_r16'));
    });

    it('LD SP,HL (0xF9) : fetch + 1 interne — même un transfert 16 bits paie son passage', () => {
      expect(measure([0xf9])).toBe(attendu('LD_SP_HL'));
    });

    it('LD HL,SP+e (0xF8) : fetch + 1 opérande + 1 interne', () => {
      expect(measure([0xf8, 0x05])).toBe(attendu('LD_HL_SP_e8'));
    });

    it('ADD SP,e (0xE8) : fetch + 1 opérande + 2 internes — le seul à en payer deux', () => {
      expect(measure([0xe8, 0x05])).toBe(attendu('ADD_SP_e8'));
    });
  });

  describe('les sauts : le rechargement de PC est un cycle interne', () => {
    it('JP nn (0xC3) : fetch + 2 opérandes + 1 interne', () => {
      expect(measure([0xc3, 0x00, 0xc0])).toBe(attendu('JP_n16'));
    });

    it('JR e (0x18) : fetch + 1 opérande + 1 interne', () => {
      expect(measure([0x18, 0x02])).toBe(attendu('JR_n16'));
    });

    it('JP NZ,nn (0xC2) pris : l\'interne est là', () => {
      expect(measure([0xc2, 0x00, 0xc0], (cpu) => (cpu.registers.F.Z = 0))).toBe(attendu('JP_cc_n16', true));
    });

    it('JP NZ,nn (0xC2) NON pris : l\'interne disparaît, les 2 opérandes se lisent quand même', () => {
      expect(measure([0xc2, 0x00, 0xc0], (cpu) => (cpu.registers.F.Z = 1))).toBe(attendu('JP_cc_n16'));
    });

    it('JR NZ,e (0x20) pris : fetch + 1 opérande + 1 interne', () => {
      expect(measure([0x20, 0x02], (cpu) => (cpu.registers.F.Z = 0))).toBe(attendu('JR_cc_n16', true));
    });

    it('JR NZ,e (0x20) NON pris : fetch + 1 opérande, rien de plus', () => {
      expect(measure([0x20, 0x02], (cpu) => (cpu.registers.F.Z = 1))).toBe(attendu('JR_cc_n16'));
    });
  });

  describe('la pile : le décrément de SP se paie, l\'incrément non', () => {
    it('PUSH BC (0xC5) : fetch + 1 interne (SP = SP-1) + 2 écritures', () => {
      expect(measure([0xc5])).toBe(attendu('PUSH_r16'));
    });

    it('CALL nn (0xCD) : fetch + 2 opérandes + 1 interne + 2 écritures', () => {
      expect(measure([0xcd, 0x00, 0xc0])).toBe(attendu('CALL_n16'));
    });

    it('CALL NZ,nn (0xC4) pris : l\'interne et les 2 écritures', () => {
      expect(measure([0xc4, 0x00, 0xc0], (cpu) => (cpu.registers.F.Z = 0))).toBe(attendu('CALL_cc_n16', true));
    });

    it('CALL NZ,nn (0xC4) NON pris : fetch + 2 opérandes, ni interne ni écriture', () => {
      expect(measure([0xc4, 0x00, 0xc0], (cpu) => (cpu.registers.F.Z = 1))).toBe(attendu('CALL_cc_n16'));
    });

    it('RST 0x00 (0xC7) : fetch + 1 interne + 2 écritures — un CALL sans opérandes', () => {
      expect(measure([0xc7])).toBe(attendu('RST_vec'));
    });

    it('RET (0xC9) : fetch + 2 lectures + 1 interne (PC = WZ)', () => {
      expect(measure([0xc9], empile)).toBe(attendu('RET'));
    });

    it('RETI (0xD9) : même profil que RET', () => {
      expect(measure([0xd9], empile)).toBe(attendu('RETI'));
    });
  });

  describe('RET cc : le cycle de DÉCISION, que la condition soit vraie ou fausse', () => {
    it('RET NZ (0xC0) pris : un cycle de plus que RET', () => {
      expect(
        measure([0xc0], (cpu) => {
          empile(cpu);
          cpu.registers.F.Z = 0;
        })
      ).toBe(attendu('RET_cc', true));
    });

    it('RET NZ (0xC0) NON pris : fetch + la seule décision, AUCUNE lecture', () => {
      expect(
        measure([0xc0], (cpu) => {
          empile(cpu);
          cpu.registers.F.Z = 1;
        })
      ).toBe(attendu('RET_cc'));
    });
  });

  describe('les deux pièges : là où la généralisation casse', () => {
    it('JP HL (0xE9) coûte 1 : ZÉRO interne — le fetch suivant est adressé par HL', () => {
      // « tout saut prend +1 interne » est faux : celui-ci ne paie que son opcode.
      expect(measure([0xe9], (cpu) => cpu.registers.HL.setValue(0xc000))).toBe(attendu('JP_HL'));
    });

    it('POP BC (0xC1) : fetch + 2 lectures, AUCUN interne — pas symétrique de PUSH', () => {
      expect(measure([0xc1], empile)).toBe(attendu('POP_r16'));
    });
  });

  describe('anti-tautologie : la mesure ne doit pas venir de la config', () => {
    it('fausser instructions.INC_r16.cycle ne change pas ce que le CPU dépense', () => {
      const vrai = measure([0x03]);

      // Table forgée par recopie : muter `instructions` polluerait tous les autres
      // fichiers, c'est un singleton de module réutilisé à chaque buildInstructions().
      const forgee = {
        ...instructions,
        INC_r16: { ...instructions.INC_r16, cycle: instructions.INC_r16.cycle + 7 },
      };
      const truque = measureWith(forgee, [0x03]);

      expect(
        truque,
        'cpu.cycles a suivi la config truquée : la dépense est recopiée, pas mesurée'
      ).toBe(vrai);
    });

    it('la même garde sur un conditionnel : fausser extraCycle ne déplace pas la mesure', () => {
      const vrai = measure([0x20, 0x02], (cpu) => (cpu.registers.F.Z = 0));

      const forgee = {
        ...instructions,
        JR_cc_n16: { ...instructions.JR_cc_n16, extraCycle: instructions.JR_cc_n16.extraCycle + 5 },
      };
      const truque = measureWith(forgee, [0x20, 0x02], (cpu) => (cpu.registers.F.Z = 0));

      expect(truque, 'le supplément de branche est recopié de la config, pas mesuré').toBe(vrai);
    });
  });
});
