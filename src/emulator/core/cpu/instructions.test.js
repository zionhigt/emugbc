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
});
