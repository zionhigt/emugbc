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

  describe('AND_A_r8 / AND_A_n8 : A = A & opérande — H TOUJOURS 1, C TOUJOURS 0', () => {
    it('expose AND_A_r8 et AND_A_n8', () => {
      for (const id of ['AND_A_r8', 'AND_A_n8']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    // Avant chaque run : N=1, H=0, C=1 — l'exact contraire des valeurs imposées
    // par la doc (N=0, H=1, C=0), pour vérifier que l'instruction les force bien.
    const setupAnd = (A) => {
      const cpu = new CPU();
      cpu.registers.A.setValue(A);
      cpu.registers.F.N = 1;
      cpu.registers.F.H = 0;
      cpu.registers.F.C = 1;
      return cpu;
    };

    const expectAnd = (cpu, label, { expA, Z }) => {
      const F = cpu.registers.F;
      expect(bin(cpu.registers.A.getValue()), `${label} → A, ${dumpFlags(F)}`).toBe(bin(expA));
      expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
      expect(+!!F.N, `${label} → N doit être forcé à 0, ${dumpFlags(F)}`).toBe(0);
      expect(+!!F.H, `${label} → H doit être forcé à 1 (bizarrerie du SM83), ${dumpFlags(F)}`).toBe(1);
      expect(+!!F.C, `${label} → C doit être forcé à 0, ${dumpFlags(F)}`).toBe(0);
    };

    it.each([
      { cas: 'ET bit à bit simple', instr: 'AND_A_r8', A: 0b1100_1010, val: 0b1010_0110, expA: 0b1000_0010, Z: 0 },
      { cas: 'aucun bit commun → résultat nul, Z levé', instr: 'AND_A_r8', A: 0b1111_0000, val: 0b0000_1111, expA: 0b0000_0000, Z: 1 },
      { cas: 'masquage classique : garder le nibble bas', instr: 'AND_A_r8', A: 0b1111_1111, val: 0b0000_1111, expA: 0b0000_1111, Z: 0 },
      { cas: 'immédiat : ET simple', instr: 'AND_A_n8', A: 0b1100_1010, val: 0b1010_0110, expA: 0b1000_0010, Z: 0 },
      { cas: 'immédiat : bits alternés opposés → nul', instr: 'AND_A_n8', A: 0b0101_0101, val: 0b1010_1010, expA: 0b0000_0000, Z: 1 },
    ].map((c) => ({ ...c, label: `${c.instr}(A=${bin(c.A)}, ${bin(c.val)})` })))(
      '$cas : $label',
      ({ instr, A, val, expA, Z, label }) => {
        const cpu = setupAnd(A);
        if (instr === 'AND_A_r8') {
          cpu.registers.B.setValue(val);
          instructions.AND_A_r8.run(cpu, cpu.registers.B);
        } else {
          instructions.AND_A_n8.run(cpu, val);
        }
        expectAnd(cpu, label, { expA, Z });
      },
    );

    it("AND A,A : A inchangé, flags posés (l'idiome GB pour tester si A est nul)", () => {
      const cpu = setupAnd(0b0100_0010);
      instructions.AND_A_r8.run(cpu, cpu.registers.A);
      expectAnd(cpu, 'AND_A_r8(A=0b01000010, A)', { expA: 0b0100_0010, Z: 0 });

      const cpu2 = setupAnd(0x00);
      instructions.AND_A_r8.run(cpu2, cpu2.registers.A);
      expectAnd(cpu2, 'AND_A_r8(A=0x00, A)', { expA: 0x00, Z: 1 });
    });
  });

  describe('CP_A_r8 / CP_A_n8 : compare A avec l\'opérande — flags de SUB, résultat JETÉ', () => {
    it('expose CP_A_r8 et CP_A_n8', () => {
      for (const id of ['CP_A_r8', 'CP_A_n8']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    const cpCases = [
      { cas: 'égalité → Z levé, aucun emprunt', A: 0x42, val: 0x42, Z: 1, H: 0, C: 0 },
      { cas: 'A plus grand, soustraction sage', A: 0x19, val: 0x05, Z: 0, H: 0, C: 0 },
      { cas: 'A plus petit → emprunt global ET de nibble (5-7)', A: 0x05, val: 0x07, Z: 0, H: 1, C: 1 },
      { cas: 'emprunt du nibble seulement (0x10-0x01)', A: 0x10, val: 0x01, Z: 0, H: 1, C: 0 },
      { cas: 'emprunt global sans emprunt de nibble (0x1F-0x2E)', A: 0x1f, val: 0x2e, Z: 0, H: 0, C: 1 },
    ];

    const expectCp = (cpu, label, { A, Z, H, C }) => {
      const F = cpu.registers.F;
      expect(hex(cpu.registers.A.getValue(), 2), `${label} → A doit rester INTACT (le résultat est jeté), ${dumpFlags(F)}`).toBe(hex(A, 2));
      expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
      expect(+!!F.N, `${label} → N doit valoir 1 (c'est une soustraction), ${dumpFlags(F)}`).toBe(1);
      expect(+!!F.H, `${label} → H (emprunt du nibble bas), ${dumpFlags(F)}`).toBe(H);
      expect(+!!F.C, `${label} → C (emprunt : val > A), ${dumpFlags(F)}`).toBe(C);
    };

    it.each(
      cpCases.map((c) => ({ ...c, instr: 'CP_A_r8', label: `CP_A_r8(A=${hex(c.A, 2)}, r8=${hex(c.val, 2)})` })),
    )('$cas : $label', ({ instr, A, val, Z, H, C, label }) => {
      const cpu = new CPU();
      cpu.registers.A.setValue(A);
      cpu.registers.B.setValue(val);
      cpu.registers.F.N = 0; // doit être forcé à 1
      instructions.CP_A_r8.run(cpu, cpu.registers.B);
      expectCp(cpu, label, { A, Z, H, C });
      expect(hex(cpu.registers.B.getValue(), 2), `${label} → B intact`).toBe(hex(val, 2));
    });

    it.each(
      cpCases.map((c) => ({ ...c, label: `CP_A_n8(A=${hex(c.A, 2)}, n8=${hex(c.val, 2)})` })),
    )('immédiat — $cas : $label', ({ A, val, Z, H, C, label }) => {
      const cpu = new CPU();
      cpu.registers.A.setValue(A);
      cpu.registers.F.N = 0;
      instructions.CP_A_n8.run(cpu, val);
      expectCp(cpu, label, { A, Z, H, C });
    });

    it("CP A,A : toujours égal — l'idiome « A est-il nul... non, égal à lui-même » : Z=1, H=0, C=0", () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0x9c);
      instructions.CP_A_r8.run(cpu, cpu.registers.A);
      expectCp(cpu, 'CP_A_r8(A=0x9C, A)', { A: 0x9c, Z: 1, H: 0, C: 0 });
    });
  });

  describe('CPL : A = ~A (complément bit à bit) — N=1, H=1, Z et C PRÉSERVÉS', () => {
    it('expose CPL avec son id et une méthode run', () => {
      expect(instructions.CPL, 'instructions.CPL est absent').toBeDefined();
      expect(instructions.CPL.id).toBe('CPL');
      expect(typeof instructions.CPL.run).toBe('function');
    });

    it.each([
      { cas: 'inversion de chaque bit', A: 0b1010_0101, expA: 0b0101_1010 },
      { cas: 'zéro devient tout-à-un', A: 0b0000_0000, expA: 0b1111_1111 },
      { cas: 'tout-à-un devient zéro', A: 0b1111_1111, expA: 0b0000_0000 },
    ].map((c) => ({ ...c, label: `CPL(A=${bin(c.A)})` })))(
      '$cas : $label',
      ({ A, expA, label }) => {
        const cpu = new CPU();
        cpu.registers.A.setValue(A);
        cpu.registers.F.N = 0; // doit être forcé à 1
        cpu.registers.F.H = 0; // doit être forcé à 1
        instructions.CPL.run(cpu);
        const F = cpu.registers.F;
        expect(bin(cpu.registers.A.getValue()), `${label} → A, ${dumpFlags(F)}`).toBe(bin(expA));
        expect(+!!F.N, `${label} → N doit être forcé à 1, ${dumpFlags(F)}`).toBe(1);
        expect(+!!F.H, `${label} → H doit être forcé à 1, ${dumpFlags(F)}`).toBe(1);
      },
    );

    it('Z et C sont préservés — même quand le résultat vaut 0x00', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0xff);
      cpu.registers.F.setValue(0b0001_0000); // Z=0, C=1
      instructions.CPL.run(cpu);
      const F = cpu.registers.F;
      expect(hex(cpu.registers.A.getValue(), 2), dumpFlags(F)).toBe('0x00');
      expect(+!!F.Z, `A vaut 0 mais CPL ne calcule PAS Z : ${dumpFlags(F)}`).toBe(0);
      expect(+!!F.C, `C était levé, il doit le rester : ${dumpFlags(F)}`).toBe(1);

      const cpu2 = new CPU();
      cpu2.registers.A.setValue(0x0f);
      cpu2.registers.F.setValue(0b1000_0000); // Z=1, C=0
      instructions.CPL.run(cpu2);
      expect(+!!cpu2.registers.F.Z, `Z était levé, il doit le rester : ${dumpFlags(cpu2.registers.F)}`).toBe(1);
      expect(+!!cpu2.registers.F.C, `C était éteint, il doit le rester : ${dumpFlags(cpu2.registers.F)}`).toBe(0);
    });

    it('est une involution : deux CPL rendent A intact', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0x5a);
      instructions.CPL.run(cpu);
      instructions.CPL.run(cpu);
      expect(hex(cpu.registers.A.getValue(), 2), 'CPL(CPL(A)) = A').toBe('0x5A');
    });
  });

  describe('DAA : ajuste A en BCD après une arithmétique — H=0, N préservé, C montant', () => {
    it('expose DAA avec son id et une méthode run', () => {
      expect(instructions.DAA, 'instructions.DAA est absent').toBeDefined();
      expect(instructions.DAA.id).toBe('DAA');
      expect(typeof instructions.DAA.run).toBe('function');
    });

    it.each([
      // ----- branche addition (N=0) -----
      { cas: 'addition déjà propre : rien à ajuster (12+34=46)', A: 0x46, N: 0, H: 0, C: 0, expA: 0x46, expZ: 0, expC: 0 },
      { cas: 'nibble bas réparé via H (28+19 : binaire 0x41, H=1 → 47)', A: 0x41, N: 0, H: 1, C: 0, expA: 0x47, expZ: 0, expC: 0 },
      { cas: 'nibble bas réparé via chiffre>9, sans H (15+27 : 0x3C → 42)', A: 0x3c, N: 0, H: 0, C: 0, expA: 0x42, expZ: 0, expC: 0 },
      { cas: 'nibble haut réparé via A>0x99, C se lève (50+60 : 0xB0 → 10, retenue)', A: 0xb0, N: 0, H: 0, C: 0, expA: 0x10, expZ: 0, expC: 1 },
      { cas: 'nibble haut réparé via C déjà levé (90+80 : 0x10 C=1 → 70, C reste)', A: 0x10, N: 0, H: 0, C: 1, expA: 0x70, expZ: 0, expC: 1 },
      { cas: 'double réparation (99+99 : 0x32 H=1 C=1 → 98, retenue)', A: 0x32, N: 0, H: 1, C: 1, expA: 0x98, expZ: 0, expC: 1 },
      { cas: 'résultat 00 : Z se lève (50+50 : 0xA0 → 00, retenue)', A: 0xa0, N: 0, H: 0, C: 0, expA: 0x00, expZ: 1, expC: 1 },
      // ----- branche soustraction (N=1) : C ne bouge JAMAIS -----
      { cas: 'soustraction propre : rien à ajuster (47-12=35)', A: 0x35, N: 1, H: 0, C: 0, expA: 0x35, expZ: 0, expC: 0 },
      { cas: 'emprunt de nibble réparé via H (41-19 : binaire 0x28, H=1 → 22)', A: 0x28, N: 1, H: 1, C: 0, expA: 0x22, expZ: 0, expC: 0 },
      { cas: 'emprunt complet (15-27 : 0xEE H=1 C=1 → 88, C reste levé)', A: 0xee, N: 1, H: 1, C: 1, expA: 0x88, expZ: 0, expC: 1 },
      { cas: 'zéro en soustraction (42-42=00) : Z levé, C intact', A: 0x00, N: 1, H: 0, C: 0, expA: 0x00, expZ: 1, expC: 0 },
    ].map((c) => ({ ...c, label: `DAA(A=${hex(c.A, 2)}, N=${c.N} H=${c.H} C=${c.C})` })))(
      '$cas : $label',
      ({ A, N, H, C, expA, expZ, expC, label }) => {
        const cpu = new CPU();
        cpu.registers.A.setValue(A);
        cpu.registers.F.N = N;
        cpu.registers.F.H = H;
        cpu.registers.F.C = C;
        instructions.DAA.run(cpu);
        const F = cpu.registers.F;
        expect(hex(cpu.registers.A.getValue(), 2), `${label} → A, ${dumpFlags(F)}`).toBe(hex(expA, 2));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(expZ);
        expect(+!!F.N, `${label} → N doit être PRÉSERVÉ, ${dumpFlags(F)}`).toBe(N);
        expect(+!!F.H, `${label} → H doit TOUJOURS finir à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.C, `${label} → C, ${dumpFlags(F)}`).toBe(expC);
      },
    );

    it('intégration : ADD réel puis DAA — le score BCD 28+19 affiche 47', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0x28);
      cpu.registers.B.setValue(0x19);
      instructions.ADD_A_r8.run(cpu, cpu.registers.B); // pose H=1 tout seul
      instructions.DAA.run(cpu);
      expect(
        hex(cpu.registers.A.getValue(), 2),
        `les post-it N/H laissés par ADD guident DAA : ${dumpFlags(cpu.registers.F)}`,
      ).toBe('0x47');
    });

    it('intégration : ADD avec retenue BCD — 99+99 affiche 98 avec C levé', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0x99);
      cpu.registers.B.setValue(0x99);
      instructions.ADD_A_r8.run(cpu, cpu.registers.B); // 0x32, H=1, C=1
      instructions.DAA.run(cpu);
      const F = cpu.registers.F;
      expect(hex(cpu.registers.A.getValue(), 2), dumpFlags(F)).toBe('0x98');
      expect(+!!F.C, `la retenue décimale (198 > 99) : ${dumpFlags(F)}`).toBe(1);
    });
  });

  describe('DEC_r8 : décrémente r8 — Z/N/H posés, C PRÉSERVÉ même sur wrap', () => {
    it('expose DEC_r8 avec son id et une méthode run', () => {
      expect(instructions.DEC_r8, 'instructions.DEC_r8 est absent').toBeDefined();
      expect(instructions.DEC_r8.id).toBe('DEC_r8');
      expect(typeof instructions.DEC_r8.run).toBe('function');
    });

    it.each([
      { cas: 'décrément simple', val: 0x43, cIn: 0, expVal: 0x42, Z: 0, H: 0 },
      { cas: 'tombe pile à zéro → Z levé (la fin des boucles DEC+JR NZ)', val: 0x01, cIn: 1, expVal: 0x00, Z: 1, H: 0 },
      { cas: 'emprunt de nibble (0x10 → 0x0F)', val: 0x10, cIn: 0, expVal: 0x0f, Z: 0, H: 1 },
      { cas: 'wrap 0x00 → 0xFF : H levé mais C INTACT (C=0 reste 0)', val: 0x00, cIn: 0, expVal: 0xff, Z: 0, H: 1 },
      { cas: 'wrap 0x00 → 0xFF : C=1 reste 1 (DEC ne touche jamais C)', val: 0x00, cIn: 1, expVal: 0xff, Z: 0, H: 1 },
    ].map((c) => ({ ...c, label: `DEC_r8(B=${hex(c.val, 2)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ val, cIn, expVal, Z, H, label }) => {
        const cpu = new CPU();
        cpu.registers.B.setValue(val);
        cpu.registers.F.N = 0; // doit être forcé à 1
        cpu.registers.F.C = cIn; // ne doit JAMAIS bouger
        instructions.DEC_r8.run(cpu, cpu.registers.B);
        const F = cpu.registers.F;
        expect(hex(cpu.registers.B.getValue(), 2), `${label} → B, ${dumpFlags(F)}`).toBe(hex(expVal, 2));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N doit valoir 1 (soustraction), ${dumpFlags(F)}`).toBe(1);
        expect(+!!F.H, `${label} → H (emprunt du nibble bas), ${dumpFlags(F)}`).toBe(H);
        expect(+!!F.C, `${label} → C doit être PRÉSERVÉ (il valait ${cIn}), ${dumpFlags(F)}`).toBe(cIn);
      },
    );

    it('fonctionne sur A aussi (r8 = n\'importe quel registre 8 bits)', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0x01);
      instructions.DEC_r8.run(cpu, cpu.registers.A);
      expect(hex(cpu.registers.A.getValue(), 2), dumpFlags(cpu.registers.F)).toBe('0x00');
      expect(+!!cpu.registers.F.Z, dumpFlags(cpu.registers.F)).toBe(1);
    });
  });

  describe('DEC_r16 / DEC_SP : décrémente un registre 16 bits — AUCUN flag touché', () => {
    it('expose DEC_r16 et DEC_SP', () => {
      for (const id of ['DEC_r16', 'DEC_SP']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it('DEC_r16 : décrément simple, flags intacts (tous levés le restent)', () => {
      const cpu = new CPU();
      cpu.registers.BC.setValue(0x1234);
      cpu.registers.F.setValue(0b1111_0000);
      instructions.DEC_r16.run(cpu, cpu.registers.BC);
      expect(hex(cpu.registers.BC.getValue()), dumpFlags(cpu.registers.F)).toBe(hex(0x1233));
      expect(bin(cpu.registers.F.getValue()), 'aucun flag ne doit bouger').toBe(bin(0b1111_0000));
    });

    it('DEC_r16 : wrap 0x0000 → 0xFFFF sans lever le moindre flag (même pas Z sur le 0 de départ)', () => {
      const cpu = new CPU();
      cpu.registers.DE.setValue(0x0000);
      instructions.DEC_r16.run(cpu, cpu.registers.DE);
      expect(hex(cpu.registers.DE.getValue()), dumpFlags(cpu.registers.F)).toBe(hex(0xffff));
      expect(bin(cpu.registers.F.getValue()), 'flags toujours vierges').toBe(bin(0b0000_0000));
    });

    it('DEC_SP : SP est la cible implicite, flags intacts', () => {
      const cpu = new CPU();
      cpu.registers.SP.setValue(0xfffe);
      cpu.registers.F.setValue(0b1111_0000);
      instructions.DEC_SP.run(cpu);
      expect(hex(cpu.registers.SP.getValue()), dumpFlags(cpu.registers.F)).toBe(hex(0xfffd));
      expect(bin(cpu.registers.F.getValue()), 'aucun flag ne doit bouger').toBe(bin(0b1111_0000));
    });
  });

  describe('famille interruptions : DI / EI / HALT — état interne du CPU, aucun flag', () => {
    it("état initial du CPU : ime éteint, aucun EI armé, pas endormi", () => {
      const cpu = new CPU();
      expect(cpu.ime, 'cpu.ime doit exister et démarrer à false').toBe(false);
      expect(cpu.imeScheduled, 'cpu.imeScheduled doit exister et démarrer à false').toBe(false);
      expect(cpu.halted, 'cpu.halted doit exister et démarrer à false').toBe(false);
    });

    it('expose DI, EI et HALT', () => {
      for (const id of ['DI', 'EI', 'HALT']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it('DI : éteint ime immédiatement', () => {
      const cpu = new CPU();
      // setup via l'état privé : aucun chemin public n'allume ime avant que la
      // boucle d'exécution (à venir) ne consomme imeScheduled — fidèle au hardware.
      cpu._ime = true;
      instructions.DI.run(cpu);
      expect(cpu.ime, 'DI doit couper ime').toBe(false);
    });

    it("EI : n'allume PAS ime tout de suite — il ARME l'allumage (délai d'une instruction)", () => {
      const cpu = new CPU();
      instructions.EI.run(cpu);
      expect(cpu.ime, "ime doit rester éteint juste après EI (c'est tout le délai)").toBe(false);
      expect(cpu.imeScheduled, "l'allumage doit être armé pour la boucle d'exécution").toBe(true);
    });

    it("DI annule aussi un EI en attente (EI puis DI : l'allumage n'aura jamais lieu)", () => {
      const cpu = new CPU();
      instructions.EI.run(cpu);
      instructions.DI.run(cpu);
      expect(cpu.ime, 'ime éteint').toBe(false);
      expect(cpu.imeScheduled, "l'armement doit être désamorcé par DI").toBe(false);
    });

    it('HALT : endort le CPU (cpu.halted) — le réveil viendra avec le chapitre interruptions', () => {
      const cpu = new CPU();
      instructions.HALT.run(cpu);
      expect(cpu.halted, 'le CPU doit être marqué endormi').toBe(true);
    });

    it('aucune des trois ne touche aux flags', () => {
      for (const id of ['DI', 'EI', 'HALT']) {
        const cpu = new CPU();
        cpu.registers.F.setValue(0b1111_0000);
        instructions[id].run(cpu);
        expect(
          bin(cpu.registers.F.getValue()),
          `${id} ne doit pas toucher aux flags : ${dumpFlags(cpu.registers.F)}`,
        ).toBe(bin(0b1111_0000));
      }
    });
  });

  describe('INC_r8 : incrémente r8 — Z/N/H posés, C PRÉSERVÉ même sur wrap', () => {
    it('expose INC_r8 avec son id et une méthode run', () => {
      expect(instructions.INC_r8, 'instructions.INC_r8 est absent').toBeDefined();
      expect(instructions.INC_r8.id).toBe('INC_r8');
      expect(typeof instructions.INC_r8.run).toBe('function');
    });

    it.each([
      { cas: 'incrément simple', val: 0x41, cIn: 0, expVal: 0x42, Z: 0, H: 0 },
      { cas: 'retenue de nibble (0x0F + 1 = 0x10)', val: 0x0f, cIn: 1, expVal: 0x10, Z: 0, H: 1 },
      { cas: 'wrap 0xFF → 0x00 : Z et H levés, C=0 INTACT', val: 0xff, cIn: 0, expVal: 0x00, Z: 1, H: 1 },
      { cas: 'wrap 0xFF → 0x00 : C=1 reste 1 (INC ne touche jamais C)', val: 0xff, cIn: 1, expVal: 0x00, Z: 1, H: 1 },
      { cas: 'borne exacte du nibble sans retenue (0x0E + 1)', val: 0x0e, cIn: 0, expVal: 0x0f, Z: 0, H: 0 },
    ].map((c) => ({ ...c, label: `INC_r8(B=${hex(c.val, 2)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ val, cIn, expVal, Z, H, label }) => {
        const cpu = new CPU();
        cpu.registers.B.setValue(val);
        cpu.registers.F.N = 1; // doit être forcé à 0 (addition)
        cpu.registers.F.C = cIn; // ne doit JAMAIS bouger
        instructions.INC_r8.run(cpu, cpu.registers.B);
        const F = cpu.registers.F;
        expect(hex(cpu.registers.B.getValue(), 2), `${label} → B, ${dumpFlags(F)}`).toBe(hex(expVal, 2));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N doit valoir 0 (addition), ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H (retenue du nibble bas), ${dumpFlags(F)}`).toBe(H);
        expect(+!!F.C, `${label} → C doit être PRÉSERVÉ (il valait ${cIn}), ${dumpFlags(F)}`).toBe(cIn);
      },
    );
  });

  describe('INC_r16 / INC_SP : incrémente un registre 16 bits — AUCUN flag touché', () => {
    it('expose INC_r16 et INC_SP', () => {
      for (const id of ['INC_r16', 'INC_SP']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it('INC_r16 : incrément simple, flags intacts (tous levés le restent)', () => {
      const cpu = new CPU();
      cpu.registers.BC.setValue(0x1234);
      cpu.registers.F.setValue(0b1111_0000);
      instructions.INC_r16.run(cpu, cpu.registers.BC);
      expect(hex(cpu.registers.BC.getValue()), dumpFlags(cpu.registers.F)).toBe(hex(0x1235));
      expect(bin(cpu.registers.F.getValue()), 'aucun flag ne doit bouger').toBe(bin(0b1111_0000));
    });

    it('INC_r16 : wrap 0xFFFF → 0x0000 sans lever le moindre flag (même pas Z sur le 0 final !)', () => {
      const cpu = new CPU();
      cpu.registers.DE.setValue(0xffff);
      instructions.INC_r16.run(cpu, cpu.registers.DE);
      expect(hex(cpu.registers.DE.getValue()), dumpFlags(cpu.registers.F)).toBe(hex(0x0000));
      expect(bin(cpu.registers.F.getValue()), 'flags toujours vierges').toBe(bin(0b0000_0000));
    });

    it('INC_SP : SP est la cible implicite, flags intacts', () => {
      const cpu = new CPU();
      cpu.registers.SP.setValue(0xfffd);
      cpu.registers.F.setValue(0b1111_0000);
      instructions.INC_SP.run(cpu);
      expect(hex(cpu.registers.SP.getValue()), dumpFlags(cpu.registers.F)).toBe(hex(0xfffe));
      expect(bin(cpu.registers.F.getValue()), 'aucun flag ne doit bouger').toBe(bin(0b1111_0000));
    });
  });

  describe('JP_n16 / JP_cc_n16 / JP_HL : sauts absolus — PC remplacé, aucun flag', () => {
    it('expose JP_n16, JP_cc_n16 et JP_HL', () => {
      for (const id of ['JP_n16', 'JP_cc_n16', 'JP_HL']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it('JP_n16 : PC = n16, flags intacts', () => {
      const cpu = new CPU();
      cpu.registers.PC.setValue(0xc003);
      cpu.registers.F.setValue(0b1111_0000);
      instructions.JP_n16.run(cpu, 0x1234);
      expect(hex(cpu.registers.PC.getValue()), 'PC remplacé').toBe(hex(0x1234));
      expect(bin(cpu.registers.F.getValue()), 'flags intacts').toBe(bin(0b1111_0000));
    });

    it.each([
      { cc: 'Z', F: 0b1000_0000, taken: true },
      { cc: 'Z', F: 0b0000_0000, taken: false },
      { cc: 'NC', F: 0b0000_0000, taken: true },
      { cc: 'C', F: 0b0000_0000, taken: false },
    ].map((c) => ({
      ...c,
      label: `JP_cc_n16("${c.cc}", 0x1234) avec F=${bin(c.F)}`,
      attendu: c.taken ? 'prise' : 'pas prise',
    })))('JP_cc_n16, condition $attendu : $label', ({ cc, F: flags, taken, label }) => {
      const cpu = new CPU();
      cpu.registers.PC.setValue(0xc003);
      cpu.registers.SP.setValue(0xfffe);
      cpu.registers.F.setValue(flags);
      instructions.JP_cc_n16.run(cpu, cc, 0x1234);
      const F = cpu.registers.F;
      expect(hex(cpu.registers.PC.getValue()), `${label} → PC, ${dumpFlags(F)}`).toBe(hex(taken ? 0x1234 : 0xc003));
      expect(hex(cpu.registers.SP.getValue()), `${label} → JP ne touche JAMAIS à la pile (pas un CALL !)`).toBe(hex(0xfffe));
      expect(bin(F.getValue()), `${label} → flags intacts`).toBe(bin(flags));
    });

    it('JP_HL : PC = valeur de HL, HL intact — le saut le moins cher du CPU (1 cycle)', () => {
      const cpu = new CPU();
      cpu.registers.PC.setValue(0xc003);
      cpu.registers.HL.setValue(0x8000);
      instructions.JP_HL.run(cpu);
      expect(hex(cpu.registers.PC.getValue()), 'PC reçoit la valeur de HL').toBe(hex(0x8000));
      expect(hex(cpu.registers.HL.getValue()), 'HL ne bouge pas').toBe(hex(0x8000));
    });
  });

  describe('JR_n16 / JR_cc_n16 : sauts relatifs — PC = PC + offset signé (octet brut)', () => {
    // Convention : PC pointe déjà après le JR (2 octets consommés par le décodeur).
    // L'offset reçu est l'octet encodé BRUT ; l'instruction l'interprète via sign8.
    it('expose JR_n16 et JR_cc_n16', () => {
      for (const id of ['JR_n16', 'JR_cc_n16']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it.each([
      { cas: 'saut avant', pc: 0xc002, offset: 0x05, expPC: 0xc007 },
      { cas: 'offset 0 : le no-op de la doc (JR vers l\'instruction suivante)', pc: 0xc002, offset: 0x00, expPC: 0xc002 },
      { cas: 'offset -2 (0xFE) : la boucle infinie de la doc (retour sur le JR lui-même)', pc: 0xc002, offset: 0xfe, expPC: 0xc000 },
      { cas: 'saut arrière maximal (-128)', pc: 0xc002, offset: 0x80, expPC: 0xbf82 },
      { cas: 'saut avant maximal (+127)', pc: 0xc002, offset: 0x7f, expPC: 0xc081 },
      { cas: 'wrap 16 bits vers le haut (PC bas + offset négatif)', pc: 0x0001, offset: 0xfe, expPC: 0xffff },
    ].map((c) => ({ ...c, label: `JR_n16(PC=${hex(c.pc)}, offset=${hex(c.offset, 2)})` })))(
      '$cas : $label',
      ({ pc, offset, expPC, label }) => {
        const cpu = new CPU();
        cpu.registers.PC.setValue(pc);
        cpu.registers.F.setValue(0b1111_0000);
        instructions.JR_n16.run(cpu, offset);
        expect(hex(cpu.registers.PC.getValue()), `${label} → PC`).toBe(hex(expPC));
        expect(bin(cpu.registers.F.getValue()), `${label} → flags intacts`).toBe(bin(0b1111_0000));
      },
    );

    it.each([
      { cc: 'NZ', F: 0b0000_0000, taken: true },
      { cc: 'NZ', F: 0b1000_0000, taken: false },
      { cc: 'C', F: 0b0001_0000, taken: true },
      { cc: 'NC', F: 0b0001_0000, taken: false },
    ].map((c) => ({
      ...c,
      label: `JR_cc_n16("${c.cc}", 0x05) avec F=${bin(c.F)}`,
      attendu: c.taken ? 'prise' : 'pas prise',
    })))('JR_cc_n16, condition $attendu : $label', ({ cc, F: flags, taken, label }) => {
      const cpu = new CPU();
      cpu.registers.PC.setValue(0xc002);
      cpu.registers.F.setValue(flags);
      instructions.JR_cc_n16.run(cpu, cc, 0x05);
      expect(hex(cpu.registers.PC.getValue()), `${label} → PC, ${dumpFlags(cpu.registers.F)}`).toBe(hex(taken ? 0xc007 : 0xc002));
      expect(bin(cpu.registers.F.getValue()), `${label} → flags intacts`).toBe(bin(flags));
    });
  });

  describe('famille LD (côté registres) : copies pures, aucun flag — sauf LD HL,SP+e8', () => {
    it('expose les LD registre-vers-registre et immédiats', () => {
      for (const id of ['LD_r8_r8', 'LD_r8_n8', 'LD_r16_n16', 'LD_SP_n16', 'LD_SP_HL', 'LD_HL_SP_e8']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it('LD_r8_r8 : copie src dans dest, src intact, flags intacts', () => {
      const cpu = new CPU();
      cpu.registers.B.setValue(0x42);
      cpu.registers.F.setValue(0b1111_0000);
      instructions.LD_r8_r8.run(cpu, cpu.registers.A, cpu.registers.B);
      expect(hex(cpu.registers.A.getValue(), 2), 'A reçoit la copie').toBe('0x42');
      expect(hex(cpu.registers.B.getValue(), 2), 'B (source) intact').toBe('0x42');
      expect(bin(cpu.registers.F.getValue()), 'flags intacts').toBe(bin(0b1111_0000));
    });

    it('LD_r8_r8 vers soi-même (LD B,B) : no-op parfait', () => {
      const cpu = new CPU();
      cpu.registers.B.setValue(0x42);
      instructions.LD_r8_r8.run(cpu, cpu.registers.B, cpu.registers.B);
      expect(hex(cpu.registers.B.getValue(), 2), 'B inchangé').toBe('0x42');
    });

    it('LD_r8_n8 : copie l\'immédiat dans le registre', () => {
      const cpu = new CPU();
      instructions.LD_r8_n8.run(cpu, cpu.registers.D, 0x99);
      expect(hex(cpu.registers.D.getValue(), 2)).toBe('0x99');
    });

    it('LD_r16_n16 : copie 16 bits — les deux moitiés sont justes', () => {
      const cpu = new CPU();
      instructions.LD_r16_n16.run(cpu, cpu.registers.BC, 0x1234);
      expect(hex(cpu.registers.BC.getValue()), 'valeur composée').toBe(hex(0x1234));
      expect(hex(cpu.registers.B.getValue(), 2), 'octet haut dans B').toBe('0x12');
      expect(hex(cpu.registers.C.getValue(), 2), 'octet bas dans C').toBe('0x34');
    });

    it("LD_SP_n16 : l'instruction qui installe la pile (LD SP, 0xFFFE)", () => {
      const cpu = new CPU();
      instructions.LD_SP_n16.run(cpu, 0xfffe);
      expect(hex(cpu.registers.SP.getValue())).toBe(hex(0xfffe));
    });

    it('LD_SP_HL : SP reçoit la valeur de HL, HL intact', () => {
      const cpu = new CPU();
      cpu.registers.HL.setValue(0xbeef);
      instructions.LD_SP_HL.run(cpu);
      expect(hex(cpu.registers.SP.getValue()), 'SP copié').toBe(hex(0xbeef));
      expect(hex(cpu.registers.HL.getValue()), 'HL intact').toBe(hex(0xbeef));
    });

    describe('LD_HL_SP_e8 : HL = SP + e8 signé — les flags bizarres de ADD SP,e8, et SP INTACT', () => {
      it.each([
        { cas: 'e8 positif simple', SP: 0xc000, e8: 0x05, expHL: 0xc005, H: 0, C: 0 },
        { cas: 'half-carry sur l\'octet bas (F+1)', SP: 0xc00f, e8: 0x01, expHL: 0xc010, H: 1, C: 0 },
        { cas: 'carry sur l\'octet bas (FF+1)', SP: 0xc0ff, e8: 0x01, expHL: 0xc100, H: 1, C: 1 },
        { cas: 'e8 négatif (0xFE = -2), H et C en non-signé', SP: 0xc005, e8: 0xfe, expHL: 0xc003, H: 1, C: 1 },
      ].map((c) => ({ ...c, label: `LD_HL_SP_e8(SP=${hex(c.SP)}, e8=${hex(c.e8, 2)})` })))(
        '$cas : $label',
        ({ SP, e8, expHL, H, C, label }) => {
          const cpu = new CPU();
          cpu.registers.SP.setValue(SP);
          cpu.registers.F.N = 1; // doit tomber à 0
          cpu.registers.F.Z = 1; // doit être FORCÉ à 0
          instructions.LD_HL_SP_e8.run(cpu, e8);
          const F = cpu.registers.F;
          expect(hex(cpu.registers.HL.getValue()), `${label} → HL, ${dumpFlags(F)}`).toBe(hex(expHL));
          expect(hex(cpu.registers.SP.getValue()), `${label} → SP ne doit PAS bouger (différence avec ADD SP,e8)`).toBe(hex(SP));
          expect(+!!F.Z, `${label} → Z forcé à 0, ${dumpFlags(F)}`).toBe(0);
          expect(+!!F.N, `${label} → N=0, ${dumpFlags(F)}`).toBe(0);
          expect(+!!F.H, `${label} → H (octet bas non-signé), ${dumpFlags(F)}`).toBe(H);
          expect(+!!F.C, `${label} → C (octet bas non-signé), ${dumpFlags(F)}`).toBe(C);
        },
      );
    });
  });

  describe('NOP : ne fait rien — et le prouver est tout un art', () => {
    it('expose NOP avec son id et une méthode run', () => {
      expect(instructions.NOP, 'instructions.NOP est absent').toBeDefined();
      expect(instructions.NOP.id).toBe('NOP');
      expect(typeof instructions.NOP.run).toBe('function');
    });

    it('ne touche à RIEN : registres, flags, état interne', () => {
      const cpu = new CPU();
      cpu.registers.AF.setValue(0x12f0);
      cpu.registers.BC.setValue(0x3456);
      cpu.registers.DE.setValue(0x789a);
      cpu.registers.HL.setValue(0xbcde);
      cpu.registers.SP.setValue(0xfffe);
      cpu.registers.PC.setValue(0xc001);

      instructions.NOP.run(cpu);

      expect(hex(cpu.registers.AF.getValue()), 'AF (dont les flags)').toBe(hex(0x12f0));
      expect(hex(cpu.registers.BC.getValue()), 'BC').toBe(hex(0x3456));
      expect(hex(cpu.registers.DE.getValue()), 'DE').toBe(hex(0x789a));
      expect(hex(cpu.registers.HL.getValue()), 'HL').toBe(hex(0xbcde));
      expect(hex(cpu.registers.SP.getValue()), 'SP').toBe(hex(0xfffe));
      expect(hex(cpu.registers.PC.getValue()), 'PC (le décodeur avancera, pas NOP)').toBe(hex(0xc001));
      expect(cpu.ime, 'ime').toBe(false);
      expect(cpu.imeScheduled, 'imeScheduled').toBe(false);
      expect(cpu.halted, 'halted').toBe(false);
    });
  });

  describe('OR_A_r8 / OR_A_n8 : A = A | opérande — N, H et C TOUS forcés à 0', () => {
    it('expose OR_A_r8 et OR_A_n8', () => {
      for (const id of ['OR_A_r8', 'OR_A_n8']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    // Avant chaque run : N=1, H=1, C=1 — le contraire des valeurs imposées (0 partout).
    const setupOr = (A) => {
      const cpu = new CPU();
      cpu.registers.A.setValue(A);
      cpu.registers.F.N = 1;
      cpu.registers.F.H = 1;
      cpu.registers.F.C = 1;
      return cpu;
    };

    const expectOr = (cpu, label, { expA, Z }) => {
      const F = cpu.registers.F;
      expect(bin(cpu.registers.A.getValue()), `${label} → A, ${dumpFlags(F)}`).toBe(bin(expA));
      expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
      expect(+!!F.N, `${label} → N forcé à 0, ${dumpFlags(F)}`).toBe(0);
      expect(+!!F.H, `${label} → H forcé à 0 (contrairement à AND !), ${dumpFlags(F)}`).toBe(0);
      expect(+!!F.C, `${label} → C forcé à 0, ${dumpFlags(F)}`).toBe(0);
    };

    it.each([
      { cas: 'OU bit à bit simple', instr: 'OR_A_r8', A: 0b1100_1010, val: 0b1010_0110, expA: 0b1110_1110, Z: 0 },
      { cas: 'poser des bits : les deux nibbles se complètent', instr: 'OR_A_r8', A: 0b0000_1111, val: 0b1111_0000, expA: 0b1111_1111, Z: 0 },
      { cas: 'zéro | zéro → Z levé (seul cas nul possible)', instr: 'OR_A_r8', A: 0b0000_0000, val: 0b0000_0000, expA: 0b0000_0000, Z: 1 },
      { cas: 'immédiat : OU simple', instr: 'OR_A_n8', A: 0b1100_1010, val: 0b1010_0110, expA: 0b1110_1110, Z: 0 },
      { cas: 'immédiat : zéro | zéro', instr: 'OR_A_n8', A: 0b0000_0000, val: 0b0000_0000, expA: 0b0000_0000, Z: 1 },
    ].map((c) => ({ ...c, label: `${c.instr}(A=${bin(c.A)}, ${bin(c.val)})` })))(
      '$cas : $label',
      ({ instr, A, val, expA, Z, label }) => {
        const cpu = setupOr(A);
        if (instr === 'OR_A_r8') {
          cpu.registers.B.setValue(val);
          instructions.OR_A_r8.run(cpu, cpu.registers.B);
        } else {
          instructions.OR_A_n8.run(cpu, val);
        }
        expectOr(cpu, label, { expA, Z });
      },
    );

    it("OR A,A : L'idiome GB pour tester si A est nul (plus courant que AND A,A)", () => {
      const cpu = setupOr(0b0100_0010);
      instructions.OR_A_r8.run(cpu, cpu.registers.A);
      expectOr(cpu, 'OR_A_r8(A=0b01000010, A)', { expA: 0b0100_0010, Z: 0 });

      const cpu2 = setupOr(0x00);
      instructions.OR_A_r8.run(cpu2, cpu2.registers.A);
      expectOr(cpu2, 'OR_A_r8(A=0x00, A)', { expA: 0x00, Z: 1 });
    });
  });

  describe('XOR_A_r8 / XOR_A_n8 : A = A ^ opérande — N, H et C forcés à 0', () => {
    it('expose XOR_A_r8 et XOR_A_n8', () => {
      for (const id of ['XOR_A_r8', 'XOR_A_n8']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    const setupXor = (A) => {
      const cpu = new CPU();
      cpu.registers.A.setValue(A);
      cpu.registers.F.N = 1; // les trois doivent être forcés à 0
      cpu.registers.F.H = 1;
      cpu.registers.F.C = 1;
      return cpu;
    };

    const expectXor = (cpu, label, { expA, Z }) => {
      const F = cpu.registers.F;
      expect(bin(cpu.registers.A.getValue()), `${label} → A, ${dumpFlags(F)}`).toBe(bin(expA));
      expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
      expect(+!!F.N, `${label} → N forcé à 0, ${dumpFlags(F)}`).toBe(0);
      expect(+!!F.H, `${label} → H forcé à 0, ${dumpFlags(F)}`).toBe(0);
      expect(+!!F.C, `${label} → C forcé à 0, ${dumpFlags(F)}`).toBe(0);
    };

    it.each([
      { cas: 'OU exclusif : seuls les bits différents survivent', instr: 'XOR_A_r8', A: 0b1100_1010, val: 0b1010_0110, expA: 0b0110_1100, Z: 0 },
      { cas: 'opérandes identiques → zéro, Z levé', instr: 'XOR_A_r8', A: 0b0101_1010, val: 0b0101_1010, expA: 0b0000_0000, Z: 1 },
      { cas: 'basculer des bits : XOR avec un masque inverse la sélection', instr: 'XOR_A_r8', A: 0b1111_0000, val: 0b1111_1111, expA: 0b0000_1111, Z: 0 },
      { cas: 'immédiat : XOR simple', instr: 'XOR_A_n8', A: 0b1100_1010, val: 0b1010_0110, expA: 0b0110_1100, Z: 0 },
      { cas: 'immédiat : XOR 0x00 est neutre (A inchangé)', instr: 'XOR_A_n8', A: 0b0110_1100, val: 0b0000_0000, expA: 0b0110_1100, Z: 0 },
    ].map((c) => ({ ...c, label: `${c.instr}(A=${bin(c.A)}, ${bin(c.val)})` })))(
      '$cas : $label',
      ({ instr, A, val, expA, Z, label }) => {
        const cpu = setupXor(A);
        if (instr === 'XOR_A_r8') {
          cpu.registers.B.setValue(val);
          instructions.XOR_A_r8.run(cpu, cpu.registers.B);
        } else {
          instructions.XOR_A_n8.run(cpu, val);
        }
        expectXor(cpu, label, { expA, Z });
      },
    );

    it("XOR A,A : L'IDIOME — remettre A à zéro en un octet (plus court que LD A,0)", () => {
      const cpu = setupXor(0x9c);
      instructions.XOR_A_r8.run(cpu, cpu.registers.A);
      expectXor(cpu, 'XOR_A_r8(A=0x9C, A)', { expA: 0x00, Z: 1 });
    });

    it('est une involution : XOR deux fois avec la même valeur rend A intact', () => {
      const cpu = setupXor(0b1100_1010);
      cpu.registers.B.setValue(0b1010_0110);
      instructions.XOR_A_r8.run(cpu, cpu.registers.B);
      instructions.XOR_A_r8.run(cpu, cpu.registers.B);
      expect(bin(cpu.registers.A.getValue()), 'A ^ B ^ B = A').toBe(bin(0b1100_1010));
    });
  });

  describe('RES_u3_r8 : éteint le bit u3 de r8 — AUCUN flag touché', () => {
    it('expose RES_u3_r8 avec son id et une méthode run', () => {
      expect(instructions.RES_u3_r8, 'instructions.RES_u3_r8 est absent').toBeDefined();
      expect(instructions.RES_u3_r8.id).toBe('RES_u3_r8');
      expect(typeof instructions.RES_u3_r8.run).toBe('function');
    });

    it.each([
      { cas: 'éteint le bit visé sans toucher aux autres', u3: 3, val: 0b1111_1111, expVal: 0b1111_0111 },
      { cas: 'bit 7 (le plus à gauche)', u3: 7, val: 0b1010_1010, expVal: 0b0010_1010 },
      { cas: 'bit 0 (le plus à droite)', u3: 0, val: 0b0000_0001, expVal: 0b0000_0000 },
      { cas: 'idempotent : bit déjà éteint, rien ne bouge', u3: 5, val: 0b1001_0110, expVal: 0b1001_0110 },
    ].map((c) => ({ ...c, label: `RES_u3_r8(u3=${c.u3}, B=${bin(c.val)})` })))(
      '$cas : $label',
      ({ u3, val, expVal, label }) => {
        const cpu = new CPU();
        cpu.registers.B.setValue(val);
        cpu.registers.F.setValue(0b1111_0000); // sentinelle
        instructions.RES_u3_r8.run(cpu, u3, cpu.registers.B);
        expect(bin(cpu.registers.B.getValue()), `${label} → B`).toBe(bin(expVal));
        expect(bin(cpu.registers.F.getValue()), `${label} → flags intacts (pas de Z, contrairement à BIT !)`).toBe(bin(0b1111_0000));
      },
    );

    it('même un résultat à zéro ne lève PAS Z (RES ne calcule aucun flag)', () => {
      const cpu = new CPU();
      cpu.registers.B.setValue(0b0000_1000);
      instructions.RES_u3_r8.run(cpu, 3, cpu.registers.B); // B devient 0
      expect(bin(cpu.registers.B.getValue()), 'B éteint').toBe(bin(0b0000_0000));
      expect(+!!cpu.registers.F.Z, `B vaut 0 mais Z reste tel quel : ${dumpFlags(cpu.registers.F)}`).toBe(0);
    });
  });

  describe('RL_r8 / RLA : rotation gauche À TRAVERS le carry (anneau de 9 bits)', () => {
    // le bit 7 sort dans C ; l'ANCIEN C rentre par le bit 0
    it('expose RL_r8 et RLA', () => {
      for (const id of ['RL_r8', 'RLA']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it.each([
      { cas: 'décalage simple, rien ne sort ni ne rentre', val: 0b0011_0100, cIn: 0, expVal: 0b0110_1000, expC: 0, Z: 0 },
      { cas: 'le carry entrant rentre par le bit 0', val: 0b0011_0100, cIn: 1, expVal: 0b0110_1001, expC: 0, Z: 0 },
      { cas: 'le bit 7 est éjecté dans C — et le résultat nul lève Z', val: 0b1000_0000, cIn: 0, expVal: 0b0000_0000, expC: 1, Z: 1 },
      { cas: 'anneau complet : b7 sort dans C, l\'ancien C rentre en b0', val: 0b1000_0000, cIn: 1, expVal: 0b0000_0001, expC: 1, Z: 0 },
    ].map((c) => ({ ...c, label: `RL_r8(B=${bin(c.val)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ val, cIn, expVal, expC, Z, label }) => {
        const cpu = new CPU();
        cpu.registers.B.setValue(val);
        cpu.registers.F.N = 1; // forcés à 0
        cpu.registers.F.H = 1;
        cpu.registers.F.C = cIn;
        instructions.RL_r8.run(cpu, cpu.registers.B);
        const F = cpu.registers.F;
        expect(bin(cpu.registers.B.getValue()), `${label} → B, ${dumpFlags(F)}`).toBe(bin(expVal));
        expect(+!!F.C, `${label} → C = le bit éjecté, ${dumpFlags(F)}`).toBe(expC);
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H forcé à 0, ${dumpFlags(F)}`).toBe(0);
      },
    );

    it('RLA : même anneau sur A, mais Z est FORCÉ à 0 — même quand A finit nul !', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0b1000_0000);
      cpu.registers.F.Z = 1; // doit être forcé à 0, pas calculé
      instructions.RLA.run(cpu);
      const F = cpu.registers.F;
      expect(bin(cpu.registers.A.getValue()), `A nul après rotation, ${dumpFlags(F)}`).toBe(bin(0b0000_0000));
      expect(+!!F.C, `bit 7 éjecté, ${dumpFlags(F)}`).toBe(1);
      expect(+!!F.Z, `A vaut 0 mais Z=0 QUAND MÊME (différence avec RL A version CB !), ${dumpFlags(F)}`).toBe(0);
    });

    it('RLA : le carry entrant rentre par le bit 0 de A', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0b0100_0000);
      cpu.registers.F.C = 1;
      instructions.RLA.run(cpu);
      const F = cpu.registers.F;
      expect(bin(cpu.registers.A.getValue()), dumpFlags(F)).toBe(bin(0b1000_0001));
      expect(+!!F.C, `rien n'est sorti cette fois, ${dumpFlags(F)}`).toBe(0);
    });
  });

  describe('RLC_r8 / RLCA : rotation gauche CIRCULAIRE (anneau à 8 bits, C spectateur)', () => {
    // b7 reboucle directement en b0 ; C reçoit une COPIE de ce bit.
    // L'ancien C n'entre JAMAIS dans l'anneau — il est simplement écrasé.
    it('expose RLC_r8 et RLCA', () => {
      for (const id of ['RLC_r8', 'RLCA']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it.each([
      { cas: 'décalage simple, b7 éteint : rien ne fait le tour', val: 0b0011_0100, cIn: 0, expVal: 0b0110_1000, expC: 0, Z: 0 },
      { cas: 'b7 reboucle en b0 ET sa copie tombe dans C', val: 0b1000_0001, cIn: 0, expVal: 0b0000_0011, expC: 1, Z: 0 },
      { cas: 'le C entrant est SPECTATEUR : même entrée, même sortie (différence avec RL !)', val: 0b1000_0001, cIn: 1, expVal: 0b0000_0011, expC: 1, Z: 0 },
      { cas: 'zéro tourne sur lui-même : Z levé, C éteint', val: 0b0000_0000, cIn: 1, expVal: 0b0000_0000, expC: 0, Z: 1 },
    ].map((c) => ({ ...c, label: `RLC_r8(B=${bin(c.val)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ val, cIn, expVal, expC, Z, label }) => {
        const cpu = new CPU();
        cpu.registers.B.setValue(val);
        cpu.registers.F.N = 1; // forcés à 0
        cpu.registers.F.H = 1;
        cpu.registers.F.C = cIn;
        instructions.RLC_r8.run(cpu, cpu.registers.B);
        const F = cpu.registers.F;
        expect(bin(cpu.registers.B.getValue()), `${label} → B, ${dumpFlags(F)}`).toBe(bin(expVal));
        expect(+!!F.C, `${label} → C = copie du bit qui a fait le tour, ${dumpFlags(F)}`).toBe(expC);
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H forcé à 0, ${dumpFlags(F)}`).toBe(0);
      },
    );

    it('propriété de la rotation circulaire : après le tour, C == bit 0 du résultat', () => {
      const cpu = new CPU();
      cpu.registers.B.setValue(0b1010_0110);
      instructions.RLC_r8.run(cpu, cpu.registers.B);
      const bit0 = cpu.registers.B.getValue() & 1;
      expect(+!!cpu.registers.F.C, 'le bit copié dans C est le même que celui arrivé en b0').toBe(bit0);
    });

    it('RLCA : même anneau sur A, mais Z FORCÉ à 0 — même quand A reste nul', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0b0000_0000);
      cpu.registers.F.Z = 1; // doit être forcé à 0, pas calculé
      instructions.RLCA.run(cpu);
      const F = cpu.registers.F;
      expect(bin(cpu.registers.A.getValue()), dumpFlags(F)).toBe(bin(0b0000_0000));
      expect(+!!F.Z, `A vaut 0 mais Z=0 quand même (forme courte), ${dumpFlags(F)}`).toBe(0);
      expect(+!!F.C, dumpFlags(F)).toBe(0);
    });

    it('RLCA : b7 fait le tour et se copie dans C', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0b1000_0000);
      instructions.RLCA.run(cpu);
      const F = cpu.registers.F;
      expect(bin(cpu.registers.A.getValue()), dumpFlags(F)).toBe(bin(0b0000_0001));
      expect(+!!F.C, `copie du bit qui a tourné, ${dumpFlags(F)}`).toBe(1);
    });
  });

  describe('RR_r8 / RRA : rotation droite À TRAVERS le carry (anneau de 9 bits, sens inverse)', () => {
    // b0 sort dans C ; l'ANCIEN C rentre par le bit 7
    it('expose RR_r8 et RRA', () => {
      for (const id of ['RR_r8', 'RRA']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it.each([
      { cas: 'décalage simple, rien ne sort ni ne rentre', val: 0b0011_0100, cIn: 0, expVal: 0b0001_1010, expC: 0, Z: 0 },
      { cas: 'le carry entrant rentre par le bit 7', val: 0b0011_0100, cIn: 1, expVal: 0b1001_1010, expC: 0, Z: 0 },
      { cas: 'le bit 0 est éjecté dans C — et le résultat nul lève Z', val: 0b0000_0001, cIn: 0, expVal: 0b0000_0000, expC: 1, Z: 1 },
      { cas: 'anneau complet : b0 sort dans C, l\'ancien C rentre en b7', val: 0b0000_0001, cIn: 1, expVal: 0b1000_0000, expC: 1, Z: 0 },
    ].map((c) => ({ ...c, label: `RR_r8(B=${bin(c.val)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ val, cIn, expVal, expC, Z, label }) => {
        const cpu = new CPU();
        cpu.registers.B.setValue(val);
        cpu.registers.F.N = 1; // forcés à 0
        cpu.registers.F.H = 1;
        cpu.registers.F.C = cIn;
        instructions.RR_r8.run(cpu, cpu.registers.B);
        const F = cpu.registers.F;
        expect(bin(cpu.registers.B.getValue()), `${label} → B, ${dumpFlags(F)}`).toBe(bin(expVal));
        expect(+!!F.C, `${label} → C = le bit éjecté (b0), ${dumpFlags(F)}`).toBe(expC);
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H forcé à 0, ${dumpFlags(F)}`).toBe(0);
      },
    );

    it('RRA : même anneau sur A, Z FORCÉ à 0 même quand A finit nul', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0b0000_0001);
      cpu.registers.F.Z = 1; // doit être forcé, pas calculé
      instructions.RRA.run(cpu);
      const F = cpu.registers.F;
      expect(bin(cpu.registers.A.getValue()), dumpFlags(F)).toBe(bin(0b0000_0000));
      expect(+!!F.C, `b0 éjecté, ${dumpFlags(F)}`).toBe(1);
      expect(+!!F.Z, `A vaut 0 mais Z=0 quand même, ${dumpFlags(F)}`).toBe(0);
    });

    it('RRA : le carry entrant rentre par le bit 7 de A', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0b0000_0010);
      cpu.registers.F.C = 1;
      instructions.RRA.run(cpu);
      const F = cpu.registers.F;
      expect(bin(cpu.registers.A.getValue()), dumpFlags(F)).toBe(bin(0b1000_0001));
      expect(+!!F.C, `rien n'est sorti cette fois, ${dumpFlags(F)}`).toBe(0);
    });
  });

  describe('RRC_r8 / RRCA : rotation droite CIRCULAIRE — b0 reboucle en b7, copie dans C', () => {
    // le schéma à la fourche : b0 part à DEUX endroits (b7 et C) ; l'ancien C est écrasé.
    it('expose RRC_r8 et RRCA', () => {
      for (const id of ['RRC_r8', 'RRCA']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it.each([
      { cas: 'décalage simple, b0 éteint : rien ne fait le tour', val: 0b0011_0100, cIn: 0, expVal: 0b0001_1010, expC: 0, Z: 0 },
      { cas: 'b0 reboucle en b7 ET sa copie tombe dans C', val: 0b0000_0011, cIn: 0, expVal: 0b1000_0001, expC: 1, Z: 0 },
      { cas: 'le C entrant est SPECTATEUR : même entrée, même sortie', val: 0b0000_0011, cIn: 1, expVal: 0b1000_0001, expC: 1, Z: 0 },
      { cas: 'zéro tourne sur lui-même : Z levé, C éteint', val: 0b0000_0000, cIn: 1, expVal: 0b0000_0000, expC: 0, Z: 1 },
    ].map((c) => ({ ...c, label: `RRC_r8(B=${bin(c.val)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ val, cIn, expVal, expC, Z, label }) => {
        const cpu = new CPU();
        cpu.registers.B.setValue(val);
        cpu.registers.F.N = 1; // forcés à 0
        cpu.registers.F.H = 1;
        cpu.registers.F.C = cIn;
        instructions.RRC_r8.run(cpu, cpu.registers.B);
        const F = cpu.registers.F;
        expect(bin(cpu.registers.B.getValue()), `${label} → B, ${dumpFlags(F)}`).toBe(bin(expVal));
        expect(+!!F.C, `${label} → C = copie du bit qui a fait le tour, ${dumpFlags(F)}`).toBe(expC);
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H forcé à 0, ${dumpFlags(F)}`).toBe(0);
      },
    );

    it('propriété : après le tour, C == bit 7 du résultat', () => {
      const cpu = new CPU();
      cpu.registers.B.setValue(0b1010_0101);
      instructions.RRC_r8.run(cpu, cpu.registers.B);
      const bit7 = (cpu.registers.B.getValue() >> 7) & 1;
      expect(+!!cpu.registers.F.C, 'le bit copié dans C est celui arrivé en b7').toBe(bit7);
    });

    it('RRCA : même anneau sur A, Z FORCÉ à 0 même quand A reste nul', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0b0000_0000);
      cpu.registers.F.Z = 1;
      instructions.RRCA.run(cpu);
      const F = cpu.registers.F;
      expect(bin(cpu.registers.A.getValue()), dumpFlags(F)).toBe(bin(0b0000_0000));
      expect(+!!F.Z, `A vaut 0 mais Z=0 quand même (forme courte), ${dumpFlags(F)}`).toBe(0);
    });

    it('RRCA : b0 fait le tour et se copie dans C', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0b0000_0001);
      instructions.RRCA.run(cpu);
      const F = cpu.registers.F;
      expect(bin(cpu.registers.A.getValue()), dumpFlags(F)).toBe(bin(0b1000_0000));
      expect(+!!F.C, `copie du bit qui a tourné, ${dumpFlags(F)}`).toBe(1);
    });
  });

  describe('SBC_A_r8 / SBC_A_n8 : A = A - opérande - C — le miroir d\'ADC', () => {
    it('expose SBC_A_r8 et SBC_A_n8', () => {
      for (const id of ['SBC_A_r8', 'SBC_A_n8']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    const sbcCases = [
      { cas: 'soustraction simple, sans emprunt entrant', A: 0x05, val: 0x02, cIn: 0, expA: 0x03, Z: 0, H: 0, C: 0 },
      { cas: "l'emprunt entrant participe (-1 de plus)", A: 0x05, val: 0x02, cIn: 1, expA: 0x02, Z: 0, H: 0, C: 0 },
      { cas: "l'emprunt entrant amène pile à zéro", A: 0x03, val: 0x02, cIn: 1, expA: 0x00, Z: 1, H: 0, C: 0 },
      { cas: 'charnière : le carry force l\'emprunt de nibble mais pas le global (0x10-0x0F-1)', A: 0x10, val: 0x0f, cIn: 1, expA: 0x00, Z: 1, H: 1, C: 0 },
      { cas: 'emprunt complet : A wrappe (5-7)', A: 0x05, val: 0x07, cIn: 0, expA: 0xfe, Z: 0, H: 1, C: 1 },
      { cas: "l'emprunt entrant provoque à lui seul le débordement (0-0-1)", A: 0x00, val: 0x00, cIn: 1, expA: 0xff, Z: 0, H: 1, C: 1 },
    ];

    const expectSbc = (cpu, label, { expA, Z, H, C }) => {
      const F = cpu.registers.F;
      expect(hex(cpu.registers.A.getValue(), 2), `${label} → A, ${dumpFlags(F)}`).toBe(hex(expA, 2));
      expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
      expect(+!!F.N, `${label} → N doit valoir 1 (soustraction), ${dumpFlags(F)}`).toBe(1);
      expect(+!!F.H, `${label} → H (emprunt de nibble, carry compris), ${dumpFlags(F)}`).toBe(H);
      expect(+!!F.C, `${label} → C (emprunt : val+carry > A), ${dumpFlags(F)}`).toBe(C);
    };

    it.each(
      sbcCases.map((c) => ({ ...c, label: `SBC_A_r8(A=${hex(c.A, 2)}, r8=${hex(c.val, 2)}, C=${c.cIn})` })),
    )('$cas : $label', ({ A, val, cIn, expA, Z, H, C, label }) => {
      const cpu = new CPU();
      cpu.registers.A.setValue(A);
      cpu.registers.B.setValue(val);
      cpu.registers.F.N = 0; // doit être forcé à 1
      cpu.registers.F.C = cIn;
      instructions.SBC_A_r8.run(cpu, cpu.registers.B);
      expectSbc(cpu, label, { expA, Z, H, C });
      expect(hex(cpu.registers.B.getValue(), 2), `${label} → B intact`).toBe(hex(val, 2));
    });

    it.each(
      sbcCases.map((c) => ({ ...c, label: `SBC_A_n8(A=${hex(c.A, 2)}, n8=${hex(c.val, 2)}, C=${c.cIn})` })),
    )('immédiat — $cas : $label', ({ A, val, cIn, expA, Z, H, C, label }) => {
      const cpu = new CPU();
      cpu.registers.A.setValue(A);
      cpu.registers.F.N = 0;
      cpu.registers.F.C = cIn;
      instructions.SBC_A_n8.run(cpu, val);
      expectSbc(cpu, label, { expA, Z, H, C });
    });

    it('SBC A,A : sans emprunt entrant, toujours zéro (Z=1)', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0x9c);
      instructions.SBC_A_r8.run(cpu, cpu.registers.A);
      expectSbc(cpu, 'SBC_A_r8(A=0x9C, A, C=0)', { expA: 0x00, Z: 1, H: 0, C: 0 });
    });

    it('SBC A,A : avec emprunt entrant, toujours 0xFF (l\'idiome « étale le carry »)', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0x9c);
      cpu.registers.F.C = 1;
      instructions.SBC_A_r8.run(cpu, cpu.registers.A);
      // A - A - 1 = -1 → 0xFF, tous les emprunts levés
      expectSbc(cpu, 'SBC_A_r8(A=0x9C, A, C=1)', { expA: 0xff, Z: 0, H: 1, C: 1 });
    });
  });

  describe('SCF : met le flag C à 1 (pas d\'inversion !) — N=0, H=0, Z préservé', () => {
    it('expose SCF avec son id et une méthode run', () => {
      expect(instructions.SCF, 'instructions.SCF est absent').toBeDefined();
      expect(instructions.SCF.id).toBe('SCF');
      expect(typeof instructions.SCF.run).toBe('function');
    });

    it.each([
      { cas: 'C=0 devient 1', F: 0b0000_0000, expF: 0b0001_0000 },
      { cas: 'C=1 RESTE 1 (différence avec CCF : pas d\'inversion)', F: 0b0001_0000, expF: 0b0001_0000 },
      { cas: 'N et H sont forcés à 0 au passage', F: 0b0110_0000, expF: 0b0001_0000 },
      { cas: 'Z est préservé', F: 0b1000_0000, expF: 0b1001_0000 },
    ].map((c) => ({ ...c, label: `SCF avec F=${bin(c.F)}` })))(
      '$cas : $label',
      ({ F: flags, expF, label }) => {
        const cpu = new CPU();
        cpu.registers.F.setValue(flags);
        instructions.SCF.run(cpu);
        expect(bin(cpu.registers.F.getValue()), `${label} : ${dumpFlags(cpu.registers.F)}`).toBe(bin(expF));
      },
    );
  });

  describe('SET_u3_r8 : allume le bit u3 de r8 — AUCUN flag touché', () => {
    it('expose SET_u3_r8 avec son id et une méthode run', () => {
      expect(instructions.SET_u3_r8, 'instructions.SET_u3_r8 est absent').toBeDefined();
      expect(instructions.SET_u3_r8.id).toBe('SET_u3_r8');
      expect(typeof instructions.SET_u3_r8.run).toBe('function');
    });

    it.each([
      { cas: 'allume le bit visé sans toucher aux autres', u3: 3, val: 0b0000_0000, expVal: 0b0000_1000 },
      { cas: 'bit 7 (le plus à gauche)', u3: 7, val: 0b0010_1010, expVal: 0b1010_1010 },
      { cas: 'bit 0 (le plus à droite)', u3: 0, val: 0b0000_0000, expVal: 0b0000_0001 },
      { cas: 'idempotent : bit déjà allumé, rien ne bouge', u3: 5, val: 0b1011_0110, expVal: 0b1011_0110 },
    ].map((c) => ({ ...c, label: `SET_u3_r8(u3=${c.u3}, B=${bin(c.val)})` })))(
      '$cas : $label',
      ({ u3, val, expVal, label }) => {
        const cpu = new CPU();
        cpu.registers.B.setValue(val);
        cpu.registers.F.setValue(0b1111_0000); // sentinelle
        instructions.SET_u3_r8.run(cpu, u3, cpu.registers.B);
        expect(bin(cpu.registers.B.getValue()), `${label} → B`).toBe(bin(expVal));
        expect(bin(cpu.registers.F.getValue()), `${label} → flags intacts`).toBe(bin(0b1111_0000));
      },
    );
  });

  describe('SLA / SRA / SRL (r8) : les décalages — rien ne reboucle, C reçoit le bit du bord', () => {
    it('expose SLA_r8, SRA_r8 et SRL_r8', () => {
      for (const id of ['SLA_r8', 'SRA_r8', 'SRL_r8']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    const runShift = (instr, val, cIn = 0) => {
      const cpu = new CPU();
      cpu.registers.B.setValue(val);
      cpu.registers.F.N = 1; // forcés à 0
      cpu.registers.F.H = 1;
      cpu.registers.F.C = cIn;
      instructions[instr].run(cpu, cpu.registers.B);
      return cpu;
    };

    const expectShift = (cpu, label, { expVal, expC, Z }) => {
      const F = cpu.registers.F;
      expect(bin(cpu.registers.B.getValue()), `${label} → B, ${dumpFlags(F)}`).toBe(bin(expVal));
      expect(+!!F.C, `${label} → C = bit tombé du bord, ${dumpFlags(F)}`).toBe(expC);
      expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
      expect(+!!F.N, `${label} → N forcé à 0, ${dumpFlags(F)}`).toBe(0);
      expect(+!!F.H, `${label} → H forcé à 0, ${dumpFlags(F)}`).toBe(0);
    };

    it.each([
      { instr: 'SLA_r8', cas: 'multiplication par 2, b7 éteint', val: 0b0011_0100, expVal: 0b0110_1000, expC: 0, Z: 0 },
      { instr: 'SLA_r8', cas: 'b7 tombe dans C, un 0 rentre en b0', val: 0b1011_0100, expVal: 0b0110_1000, expC: 1, Z: 0 },
      { instr: 'SLA_r8', cas: 'résultat nul : Z et C ensemble', val: 0b1000_0000, expVal: 0b0000_0000, expC: 1, Z: 1 },
      { instr: 'SRL_r8', cas: 'division par 2 non-signée : un 0 rentre en b7', val: 0b1011_0100, expVal: 0b0101_1010, expC: 0, Z: 0 },
      { instr: 'SRL_r8', cas: 'b0 tombe dans C, résultat nul', val: 0b0000_0001, expVal: 0b0000_0000, expC: 1, Z: 1 },
      { instr: 'SRA_r8', cas: 'positif : comme SRL (b7 éteint se recopie... en 0)', val: 0b0011_0100, expVal: 0b0001_1010, expC: 0, Z: 0 },
      { instr: 'SRA_r8', cas: 'négatif : le SIGNE se recopie en b7 (division signée)', val: 0b1011_0100, expVal: 0b1101_1010, expC: 0, Z: 0 },
      { instr: 'SRA_r8', cas: '0xFF reste 0xFF : -1 divisé par 2 vaut toujours -1', val: 0b1111_1111, expVal: 0b1111_1111, expC: 1, Z: 0 },
      { instr: 'SRA_r8', cas: 'même entrée que SRL mais b7 survit — LE différenciateur', val: 0b1000_0000, expVal: 0b1100_0000, expC: 0, Z: 0 },
    ].map((c) => ({ ...c, label: `${c.instr}(B=${bin(c.val)})` })))(
      '$cas : $label',
      ({ instr, val, expVal, expC, Z, label }) => {
        const cpu = runShift(instr, val);
        expectShift(cpu, label, { expVal, expC, Z });
      },
    );

    it('SRL de la même entrée 0b1000_0000 : le 0 rentre en b7 (contraste avec SRA)', () => {
      const cpu = runShift('SRL_r8', 0b1000_0000);
      expectShift(cpu, 'SRL_r8(B=0b10000000)', { expVal: 0b0100_0000, expC: 0, Z: 0 });
    });

    it('le C entrant est spectateur pour les trois décalages', () => {
      for (const instr of ['SLA_r8', 'SRA_r8', 'SRL_r8']) {
        const sans = runShift(instr, 0b0011_0100, 0).registers.B.getValue();
        const avec = runShift(instr, 0b0011_0100, 1).registers.B.getValue();
        expect(bin(avec), `${instr} : même résultat quel que soit le C entrant`).toBe(bin(sans));
      }
    });
  });

  describe('STOP : très basse consommation — état minimal, le reste au chapitre GBC', () => {
    it('expose STOP avec son id et une méthode run', () => {
      expect(instructions.STOP, 'instructions.STOP est absent').toBeDefined();
      expect(instructions.STOP.id).toBe('STOP');
      expect(typeof instructions.STOP.run).toBe('function');
    });

    it('marque le CPU arrêté (cpu.stopped), flags intacts', () => {
      const cpu = new CPU();
      expect(cpu.stopped, 'cpu.stopped doit exister et démarrer à false').toBe(false);
      cpu.registers.F.setValue(0b1111_0000);
      instructions.STOP.run(cpu);
      expect(cpu.stopped, 'le CPU doit être marqué arrêté').toBe(true);
      expect(bin(cpu.registers.F.getValue()), 'flags intacts').toBe(bin(0b1111_0000));
    });
  });

  describe('SUB_A_r8 / SUB_A_n8 : A = A - opérande — SBC sans l\'emprunt entrant', () => {
    it('expose SUB_A_r8 et SUB_A_n8', () => {
      for (const id of ['SUB_A_r8', 'SUB_A_n8']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    const subCases = [
      { cas: 'soustraction simple', A: 0x05, val: 0x02, cIn: 0, expA: 0x03, Z: 0, H: 0, C: 0 },
      { cas: 'IGNORE la retenue entrante (toute la différence avec SBC)', A: 0x05, val: 0x02, cIn: 1, expA: 0x03, Z: 0, H: 0, C: 0 },
      { cas: 'égalité → zéro, Z levé', A: 0x42, val: 0x42, cIn: 0, expA: 0x00, Z: 1, H: 0, C: 0 },
      { cas: 'emprunt de nibble seul (0x10-0x01)', A: 0x10, val: 0x01, cIn: 0, expA: 0x0f, Z: 0, H: 1, C: 0 },
      { cas: 'emprunt complet : A wrappe (5-7)', A: 0x05, val: 0x07, cIn: 0, expA: 0xfe, Z: 0, H: 1, C: 1 },
    ];

    const expectSub = (cpu, label, { expA, Z, H, C }) => {
      const F = cpu.registers.F;
      expect(hex(cpu.registers.A.getValue(), 2), `${label} → A, ${dumpFlags(F)}`).toBe(hex(expA, 2));
      expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
      expect(+!!F.N, `${label} → N=1 (soustraction), ${dumpFlags(F)}`).toBe(1);
      expect(+!!F.H, `${label} → H, ${dumpFlags(F)}`).toBe(H);
      expect(+!!F.C, `${label} → C, ${dumpFlags(F)}`).toBe(C);
    };

    it.each(
      subCases.map((c) => ({ ...c, label: `SUB_A_r8(A=${hex(c.A, 2)}, r8=${hex(c.val, 2)}, C=${c.cIn})` })),
    )('$cas : $label', ({ A, val, cIn, expA, Z, H, C, label }) => {
      const cpu = new CPU();
      cpu.registers.A.setValue(A);
      cpu.registers.B.setValue(val);
      cpu.registers.F.N = 0;
      cpu.registers.F.C = cIn;
      instructions.SUB_A_r8.run(cpu, cpu.registers.B);
      expectSub(cpu, label, { expA, Z, H, C });
    });

    it.each(
      subCases.map((c) => ({ ...c, label: `SUB_A_n8(A=${hex(c.A, 2)}, n8=${hex(c.val, 2)}, C=${c.cIn})` })),
    )('immédiat — $cas : $label', ({ A, val, cIn, expA, Z, H, C, label }) => {
      const cpu = new CPU();
      cpu.registers.A.setValue(A);
      cpu.registers.F.N = 0;
      cpu.registers.F.C = cIn;
      instructions.SUB_A_n8.run(cpu, val);
      expectSub(cpu, label, { expA, Z, H, C });
    });

    it('SUB A,A : remise à zéro avec flags posés (Z=1, N=1)', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0x9c);
      instructions.SUB_A_r8.run(cpu, cpu.registers.A);
      expectSub(cpu, 'SUB_A_r8(A=0x9C, A)', { expA: 0x00, Z: 1, H: 0, C: 0 });
    });
  });

  describe('SWAP_r8 : échange les deux nibbles — N, H et C forcés à 0', () => {
    it('expose SWAP_r8 avec son id et une méthode run', () => {
      expect(instructions.SWAP_r8, 'instructions.SWAP_r8 est absent').toBeDefined();
      expect(instructions.SWAP_r8.id).toBe('SWAP_r8');
      expect(typeof instructions.SWAP_r8.run).toBe('function');
    });

    it.each([
      { cas: 'échange simple des deux moitiés', val: 0b1010_0110, expVal: 0b0110_1010, Z: 0 },
      { cas: 'nibble bas seul → il monte', val: 0b0000_1111, expVal: 0b1111_0000, Z: 0 },
      { cas: 'zéro échangé reste zéro → Z levé', val: 0b0000_0000, expVal: 0b0000_0000, Z: 1 },
    ].map((c) => ({ ...c, label: `SWAP_r8(B=${bin(c.val)})` })))(
      '$cas : $label',
      ({ val, expVal, Z, label }) => {
        const cpu = new CPU();
        cpu.registers.B.setValue(val);
        cpu.registers.F.N = 1; // les trois forcés à 0
        cpu.registers.F.H = 1;
        cpu.registers.F.C = 1;
        instructions.SWAP_r8.run(cpu, cpu.registers.B);
        const F = cpu.registers.F;
        expect(bin(cpu.registers.B.getValue()), `${label} → B, ${dumpFlags(F)}`).toBe(bin(expVal));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.C, `${label} → C forcé à 0, ${dumpFlags(F)}`).toBe(0);
      },
    );

    it('est une involution : deux SWAP rendent la valeur intacte', () => {
      const cpu = new CPU();
      cpu.registers.B.setValue(0x3c);
      instructions.SWAP_r8.run(cpu, cpu.registers.B);
      instructions.SWAP_r8.run(cpu, cpu.registers.B);
      expect(hex(cpu.registers.B.getValue(), 2), 'SWAP(SWAP(x)) = x').toBe('0x3C');
    });
  });

  describe('CCF : inverse le flag C — N=0, H=0, Z préservé', () => {
    it('expose CCF avec son id et une méthode run', () => {
      expect(instructions.CCF, 'instructions.CCF est absent').toBeDefined();
      expect(instructions.CCF.id).toBe('CCF');
      expect(typeof instructions.CCF.run).toBe('function');
    });

    it.each([
      { cas: 'C=0 devient 1', F: 0b0000_0000, expF: 0b0001_0000 },
      { cas: 'C=1 devient 0 (INVERSION, pas mise à 1)', F: 0b0001_0000, expF: 0b0000_0000 },
      { cas: 'N et H sont forcés à 0 au passage', F: 0b0110_0000, expF: 0b0001_0000 },
      { cas: 'Z est préservé (Z=1 reste 1)', F: 0b1001_0000, expF: 0b1000_0000 },
      { cas: 'tout levé : Z survit, N H tombent, C s\'inverse', F: 0b1111_0000, expF: 0b1000_0000 },
    ].map((c) => ({ ...c, label: `CCF avec F=${bin(c.F)}` })))(
      '$cas : $label',
      ({ F: flags, expF, label }) => {
        const cpu = new CPU();
        cpu.registers.F.setValue(flags);
        instructions.CCF.run(cpu);
        expect(bin(cpu.registers.F.getValue()), `${label} : ${dumpFlags(cpu.registers.F)}`).toBe(bin(expF));
      },
    );

    it('est une involution : deux CCF reviennent au point de départ (pour C)', () => {
      const cpu = new CPU();
      cpu.registers.F.setValue(0b0001_0000); // C=1
      instructions.CCF.run(cpu);
      instructions.CCF.run(cpu);
      expect(+!!cpu.registers.F.C, `après deux CCF : ${dumpFlags(cpu.registers.F)}`).toBe(1);
    });
  });

  describe('BIT_u3_r8 : teste le bit u3 de r8 — Z = INVERSE du bit, C PRÉSERVÉ', () => {
    it('expose BIT_u3_r8 avec son id et une méthode run', () => {
      expect(instructions.BIT_u3_r8, 'instructions.BIT_u3_r8 est absent').toBeDefined();
      expect(instructions.BIT_u3_r8.id).toBe('BIT_u3_r8');
      expect(typeof instructions.BIT_u3_r8.run).toBe('function');
    });

    it.each([
      { cas: 'bit levé → Z=0', u3: 7, val: 0b1000_0000, cIn: 0, Z: 0 },
      { cas: 'bit éteint → Z=1 (Z est l\'inverse du bit !)', u3: 7, val: 0b0111_1111, cIn: 0, Z: 1 },
      { cas: 'bit 0 (extrémité droite) levé', u3: 0, val: 0b0000_0001, cIn: 1, Z: 0 },
      { cas: 'bit du milieu levé, seul', u3: 3, val: 0b0000_1000, cIn: 1, Z: 0 },
      { cas: 'bit du milieu éteint, tous les autres levés', u3: 3, val: 0b1111_0111, cIn: 0, Z: 1 },
      { cas: 'octet nul : tous les bits éteints', u3: 5, val: 0b0000_0000, cIn: 1, Z: 1 },
    ].map((c) => ({ ...c, label: `BIT_u3_r8(u3=${c.u3}, B=${bin(c.val)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ u3, val, cIn, Z, label }) => {
        const cpu = new CPU();
        cpu.registers.B.setValue(val);
        cpu.registers.F.N = 1; // doit être forcé à 0
        cpu.registers.F.H = 0; // doit être forcé à 1
        cpu.registers.F.C = cIn; // ne doit PAS bouger (absent des flags de la doc)
        instructions.BIT_u3_r8.run(cpu, u3, cpu.registers.B);
        const F = cpu.registers.F;
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N doit être forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H doit être forcé à 1, ${dumpFlags(F)}`).toBe(1);
        expect(+!!F.C, `${label} → C doit être PRÉSERVÉ (il valait ${cIn}), ${dumpFlags(F)}`).toBe(cIn);
        expect(bin(cpu.registers.B.getValue()), `${label} → B est un test pur, rien ne s'écrit`).toBe(bin(val));
      },
    );

    it('ne touche pas non plus à A (test pur, seuls les flags bougent)', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0x42);
      cpu.registers.B.setValue(0b1000_0000);
      instructions.BIT_u3_r8.run(cpu, 7, cpu.registers.B);
      expect(hex(cpu.registers.A.getValue(), 2), 'A ne doit pas bouger').toBe('0x42');
    });
  });
});
