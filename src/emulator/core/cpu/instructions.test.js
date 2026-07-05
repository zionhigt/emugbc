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
