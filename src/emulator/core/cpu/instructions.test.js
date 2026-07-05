import { describe, it, expect } from 'vitest';

import CPU from './CPU';
import buildInstructions from './instructions';

// Formatage lisible pour le debug : binaire et hexa plutôt que décimal
const bin = (n, width = 8) => '0b' + (n >>> 0).toString(2).padStart(width, '0');
const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

const dumpFlags = (F) =>
  `F = ${bin(F.getValue())} (` +
  ['Z', 'N', 'H', 'C'].map((k) => `${k}=${F[k] ? 1 : 0}`).join(' ') +
  ')';

const instructions = buildInstructions();

describe('instructions', () => {
  it('expose ADC_A_r8 avec son id et une méthode run', () => {
    expect(instructions.ADC_A_r8, 'instructions.ADC_A_r8 est absent').toBeDefined();
    expect(instructions.ADC_A_r8.id, "l'id doit reprendre le nom de la doc").toBe('ADC_A_r8');
    expect(typeof instructions.ADC_A_r8.run, 'run doit être appelable').toBe('function');
  });

  describe('ADC_A_r8 : A = A + r8 + C', () => {
    it.each([
      { cas: 'addition simple, sans retenue entrante', A: 0x01, r8: 0x02, cIn: 0, expA: 0x03, Z: 0, H: 0, C: 0 },
      { cas: 'la retenue entrante participe au résultat (+1)', A: 0x01, r8: 0x02, cIn: 1, expA: 0x04, Z: 0, H: 0, C: 0 },
      { cas: 'half-carry : les nibbles bas débordent (8+9=17)', A: 0x28, r8: 0x19, cIn: 0, expA: 0x41, Z: 0, H: 1, C: 0 },
      { cas: 'la retenue entrante pousse le nibble à la charnière (0+15+1=16)', A: 0x10, r8: 0x0f, cIn: 1, expA: 0x20, Z: 0, H: 1, C: 0 },
      { cas: 'débordement complet : A wrappe à 0, Z H C levés', A: 0xff, r8: 0x01, cIn: 0, expA: 0x00, Z: 1, H: 1, C: 1 },
      { cas: 'la retenue entrante provoque à elle seule le débordement', A: 0xff, r8: 0x00, cIn: 1, expA: 0x00, Z: 1, H: 1, C: 1 },
      { cas: 'la retenue est consommée, pas reconduite (0+0+1=1, C retombe)', A: 0x00, r8: 0x00, cIn: 1, expA: 0x01, Z: 0, H: 0, C: 0 },
      { cas: 'zéro plat : 0+0+0=0 lève Z sans aucune retenue', A: 0x00, r8: 0x00, cIn: 0, expA: 0x00, Z: 1, H: 0, C: 0 },
    ].map((c) => ({ ...c, label: `ADC_A_r8(A=${hex(c.A, 2)}, r8=${hex(c.r8, 2)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ A, r8, cIn, expA, Z, H, C, label }) => {
        const cpu = new CPU();
        cpu.registers.A.setValue(A);
        cpu.registers.B.setValue(r8);
        cpu.registers.F.N = 1; // ADC est une addition : N doit repasser à 0
        cpu.registers.F.C = cIn;
        instructions.ADC_A_r8.run(cpu, cpu.registers.B);
        const F = cpu.registers.F;
        expect(hex(cpu.registers.A.getValue(), 2), `${label} → A, ${dumpFlags(F)}`).toBe(hex(expA, 2));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N doit valoir 0 après une addition, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H, ${dumpFlags(F)}`).toBe(H);
        expect(+!!F.C, `${label} → C, ${dumpFlags(F)}`).toBe(C);
      },
    );

    it('ne modifie pas le registre source', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0x01);
      cpu.registers.B.setValue(0x02);
      instructions.ADC_A_r8.run(cpu, cpu.registers.B);
      expect(hex(cpu.registers.B.getValue(), 2), 'B ne doit pas bouger').toBe('0x02');
    });

    it('ADC A,A : le registre source peut être A lui-même', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0x80);
      instructions.ADC_A_r8.run(cpu, cpu.registers.A);
      // 0x80 + 0x80 = 0x100 → A=0x00, Z=1, H=0 (0+0 au nibble bas), C=1
      const F = cpu.registers.F;
      expect(hex(cpu.registers.A.getValue(), 2), `A doit être lu AVANT d'être écrit, ${dumpFlags(F)}`).toBe('0x00');
      expect(+!!F.Z, dumpFlags(F)).toBe(1);
      expect(+!!F.H, dumpFlags(F)).toBe(0);
      expect(+!!F.C, dumpFlags(F)).toBe(1);
    });
  });

  // Helper commun aux additions 8 bits vers A : vérifie A et les 4 flags
  const expectA = (cpu, label, { expA, Z, H, C }) => {
    const F = cpu.registers.F;
    expect(hex(cpu.registers.A.getValue(), 2), `${label} → A, ${dumpFlags(F)}`).toBe(hex(expA, 2));
    expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
    expect(+!!F.N, `${label} → N doit valoir 0 après une addition, ${dumpFlags(F)}`).toBe(0);
    expect(+!!F.H, `${label} → H, ${dumpFlags(F)}`).toBe(H);
    expect(+!!F.C, `${label} → C, ${dumpFlags(F)}`).toBe(C);
  };

  const setupA = ({ A, cIn = 0 }) => {
    const cpu = new CPU();
    cpu.registers.A.setValue(A);
    cpu.registers.F.N = 1; // une addition doit rabaisser N
    cpu.registers.F.C = cIn;
    return cpu;
  };

  describe('ADD_A_r8 : A = A + r8 — sans retenue entrante', () => {
    it('expose ADD_A_r8 avec son id et une méthode run', () => {
      expect(instructions.ADD_A_r8, 'instructions.ADD_A_r8 est absent').toBeDefined();
      expect(instructions.ADD_A_r8.id).toBe('ADD_A_r8');
      expect(typeof instructions.ADD_A_r8.run).toBe('function');
    });

    it.each([
      { cas: 'addition simple', A: 0x01, r8: 0x02, cIn: 0, expA: 0x03, Z: 0, H: 0, C: 0 },
      { cas: 'IGNORE la retenue entrante (toute la différence avec ADC)', A: 0x01, r8: 0x02, cIn: 1, expA: 0x03, Z: 0, H: 0, C: 0 },
      { cas: 'half-carry : les nibbles bas débordent (8+9=17)', A: 0x28, r8: 0x19, cIn: 0, expA: 0x41, Z: 0, H: 1, C: 0 },
      { cas: 'débordement complet : A wrappe à 0, Z H C levés', A: 0xff, r8: 0x01, cIn: 0, expA: 0x00, Z: 1, H: 1, C: 1 },
    ].map((c) => ({ ...c, label: `ADD_A_r8(A=${hex(c.A, 2)}, r8=${hex(c.r8, 2)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ A, r8, cIn, expA, Z, H, C, label }) => {
        const cpu = setupA({ A, cIn });
        cpu.registers.B.setValue(r8);
        instructions.ADD_A_r8.run(cpu, cpu.registers.B);
        expectA(cpu, label, { expA, Z, H, C });
      },
    );

    it('ADD A,A : le registre source peut être A lui-même', () => {
      const cpu = setupA({ A: 0x80 });
      instructions.ADD_A_r8.run(cpu, cpu.registers.A);
      expectA(cpu, 'ADD_A_r8(A=0x80, r8=A)', { expA: 0x00, Z: 1, H: 0, C: 1 });
    });
  });

  describe("ADC_A_n8 / ADD_A_n8 : l'opérande immédiat est passé en argument de run", () => {
    it('expose ADC_A_n8 et ADD_A_n8', () => {
      for (const id of ['ADC_A_n8', 'ADD_A_n8']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it.each([
      { cas: 'ADC_A_n8 : addition simple', instr: 'ADC_A_n8', A: 0x01, n8: 0x02, cIn: 0, expA: 0x03, Z: 0, H: 0, C: 0 },
      { cas: 'ADC_A_n8 : la retenue entrante participe (+1)', instr: 'ADC_A_n8', A: 0x01, n8: 0x02, cIn: 1, expA: 0x04, Z: 0, H: 0, C: 0 },
      { cas: 'ADC_A_n8 : débordement complet', instr: 'ADC_A_n8', A: 0xff, n8: 0x01, cIn: 0, expA: 0x00, Z: 1, H: 1, C: 1 },
      { cas: 'ADD_A_n8 : addition simple', instr: 'ADD_A_n8', A: 0x01, n8: 0x02, cIn: 0, expA: 0x03, Z: 0, H: 0, C: 0 },
      { cas: 'ADD_A_n8 : IGNORE la retenue entrante', instr: 'ADD_A_n8', A: 0x01, n8: 0x02, cIn: 1, expA: 0x03, Z: 0, H: 0, C: 0 },
      { cas: 'ADD_A_n8 : half-carry', instr: 'ADD_A_n8', A: 0x0f, n8: 0x01, cIn: 0, expA: 0x10, Z: 0, H: 1, C: 0 },
    ].map((c) => ({ ...c, label: `${c.instr}(A=${hex(c.A, 2)}, n8=${hex(c.n8, 2)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ instr, A, n8, cIn, expA, Z, H, C, label }) => {
        const cpu = setupA({ A, cIn });
        instructions[instr].run(cpu, n8);
        expectA(cpu, label, { expA, Z, H, C });
      },
    );
  });

  describe('ADD_HL_r16 : HL = HL + r16 — 16 bits, frontières 12 et 16, Z PRÉSERVÉ', () => {
    it('expose ADD_HL_r16 et ADD_HL_SP', () => {
      for (const id of ['ADD_HL_r16', 'ADD_HL_SP']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it.each([
      { cas: 'addition simple', HL: 0x1234, r16: 0x0111, expHL: 0x1345, H: 0, C: 0 },
      { cas: 'half-carry du bit 11 (0xFFF+0x001)', HL: 0x0fff, r16: 0x0001, expHL: 0x1000, H: 1, C: 0 },
      { cas: 'carry du bit 15, wrap 16 bits', HL: 0x8000, r16: 0x8000, expHL: 0x0000, H: 0, C: 1 },
      { cas: 'wrap complet : H et C ensemble', HL: 0xffff, r16: 0x0001, expHL: 0x0000, H: 1, C: 1 },
    ].map((c) => ({ ...c, label: `ADD_HL_r16(HL=${hex(c.HL)}, r16=${hex(c.r16)})` })))(
      '$cas : $label',
      ({ HL, r16, expHL, H, C, label }) => {
        const cpu = new CPU();
        cpu.registers.HL.setValue(HL);
        cpu.registers.BC.setValue(r16);
        cpu.registers.F.N = 1; // doit repasser à 0
        cpu.registers.F.Z = 1; // ne doit PAS bouger (Z absent des flags de la doc)
        instructions.ADD_HL_r16.run(cpu, cpu.registers.BC);
        const F = cpu.registers.F;
        expect(hex(cpu.registers.HL.getValue()), `${label} → HL, ${dumpFlags(F)}`).toBe(hex(expHL));
        expect(+!!F.Z, `${label} → Z doit être PRÉSERVÉ (il était à 1), ${dumpFlags(F)}`).toBe(1);
        expect(+!!F.N, `${label} → N doit valoir 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H (frontière bit 11), ${dumpFlags(F)}`).toBe(H);
        expect(+!!F.C, `${label} → C (frontière bit 15), ${dumpFlags(F)}`).toBe(C);
      },
    );

    it('Z reste à 0 même quand le résultat vaut 0x0000 (Z=0 avant, Z=0 après)', () => {
      const cpu = new CPU();
      cpu.registers.HL.setValue(0xffff);
      cpu.registers.BC.setValue(0x0001);
      // Z vaut 0 à l'initialisation : le résultat 0x0000 ne doit PAS le lever
      instructions.ADD_HL_r16.run(cpu, cpu.registers.BC);
      expect(
        +!!cpu.registers.F.Z,
        `HL=0x0000 mais ADD HL,r16 ne calcule pas Z : ${dumpFlags(cpu.registers.F)}`,
      ).toBe(0);
    });

    it('ADD HL,HL : source = destination (doublement)', () => {
      const cpu = new CPU();
      cpu.registers.HL.setValue(0x1234);
      instructions.ADD_HL_r16.run(cpu, cpu.registers.HL);
      expect(hex(cpu.registers.HL.getValue()), dumpFlags(cpu.registers.F)).toBe(hex(0x2468));
    });

    it('ADD_HL_SP : SP est la source implicite', () => {
      const cpu = new CPU();
      cpu.registers.HL.setValue(0x1234);
      cpu.registers.SP.setValue(0x0111);
      cpu.registers.F.N = 1;
      instructions.ADD_HL_SP.run(cpu);
      const F = cpu.registers.F;
      expect(hex(cpu.registers.HL.getValue()), `HL, ${dumpFlags(F)}`).toBe(hex(0x1345));
      expect(hex(cpu.registers.SP.getValue()), 'SP ne doit pas bouger').toBe(hex(0x0111));
      expect(+!!F.N, `N doit valoir 0, ${dumpFlags(F)}`).toBe(0);
    });
  });

  describe('ADD_SP_e8 : SP = SP + e8 signé — octet brut interprété par l\'instruction', () => {
    // Bizarrerie hardware assumée par la doc : le résultat est 16 bits signé,
    // mais H et C se calculent sur l\'octet BAS, en NON-SIGNÉ (frontières 4 et 8),
    // et Z est FORCÉ à 0 quoi qu\'il arrive.
    it('expose ADD_SP_e8', () => {
      expect(instructions.ADD_SP_e8, 'instructions.ADD_SP_e8 est absent').toBeDefined();
      expect(instructions.ADD_SP_e8.id).toBe('ADD_SP_e8');
      expect(typeof instructions.ADD_SP_e8.run).toBe('function');
    });

    it.each([
      { cas: 'e8 positif simple', SP: 0xc000, e8: 0x05, expSP: 0xc005, H: 0, C: 0 },
      { cas: 'e8 positif, half-carry sur l\'octet bas (F+1)', SP: 0xc00f, e8: 0x01, expSP: 0xc010, H: 1, C: 0 },
      { cas: 'e8 positif, carry sur l\'octet bas (FF+1)', SP: 0xc0ff, e8: 0x01, expSP: 0xc100, H: 1, C: 1 },
      { cas: 'e8 négatif : 0xFE = -2 (H et C en non-signé sur l\'octet bas !)', SP: 0xc005, e8: 0xfe, expSP: 0xc003, H: 1, C: 1 },
      { cas: 'e8 négatif : 0xFF = -1 depuis 0x0000, wrap bas SANS retenues', SP: 0x0000, e8: 0xff, expSP: 0xffff, H: 0, C: 0 },
    ].map((c) => ({
      ...c,
      label: `ADD_SP_e8(SP=${hex(c.SP)}, e8=${hex(c.e8, 2)}${c.e8 > 0x7f ? ` soit ${c.e8 - 0x100}` : ''})`,
    })))(
      '$cas : $label',
      ({ SP, e8, expSP, H, C, label }) => {
        const cpu = new CPU();
        cpu.registers.SP.setValue(SP);
        cpu.registers.F.N = 1; // doit repasser à 0
        cpu.registers.F.Z = 1; // doit être FORCÉ à 0
        instructions.ADD_SP_e8.run(cpu, e8);
        const F = cpu.registers.F;
        expect(hex(cpu.registers.SP.getValue()), `${label} → SP, ${dumpFlags(F)}`).toBe(hex(expSP));
        expect(+!!F.Z, `${label} → Z doit être forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.N, `${label} → N doit valoir 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H (octet bas, non-signé), ${dumpFlags(F)}`).toBe(H);
        expect(+!!F.C, `${label} → C (octet bas, non-signé), ${dumpFlags(F)}`).toBe(C);
      },
    );

    it('Z reste forcé à 0 même quand SP tombe pile à 0x0000', () => {
      const cpu = new CPU();
      cpu.registers.SP.setValue(0x0001);
      instructions.ADD_SP_e8.run(cpu, 0xff); // -1 → SP = 0x0000
      const F = cpu.registers.F;
      expect(hex(cpu.registers.SP.getValue()), dumpFlags(F)).toBe(hex(0x0000));
      expect(+!!F.Z, `SP=0x0000 mais Z est forcé à 0 par la doc : ${dumpFlags(F)}`).toBe(0);
    });
  });
});
