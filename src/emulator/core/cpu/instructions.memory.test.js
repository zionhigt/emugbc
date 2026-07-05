import { describe, it, expect } from 'vitest';

import CPU from './CPU';
import buildMemory from './CPUMemory';
import buildInstructions from './instructions';

// Formatage lisible pour le debug : binaire et hexa plutôt que décimal
const bin = (n, width = 8) => '0b' + (n >>> 0).toString(2).padStart(width, '0');
const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

const dumpFlags = (F) =>
  `F = ${bin(F.getValue())} (` +
  ['Z', 'N', 'H', 'C'].map((k) => `${k}=${F[k] ? 1 : 0}`).join(' ') +
  ')';

const instructions = buildInstructions();
const Memory = buildMemory();

describe('CPU + mémoire', () => {
  it('expose la mémoire injectée : new CPU(memory) → cpu.memory', () => {
    const memory = new Memory();
    const cpu = new CPU(memory);
    // comparaison en booléen : ne JAMAIS passer l'objet mémoire à expect(),
    // sinon vitest sérialise les 64 Ko de RAM dans le message d'échec
    expect(cpu.memory === memory, 'cpu.memory doit être la mémoire injectée au constructeur').toBe(true);
  });
});

describe("ADC_A_HL : A = A + [HL] + C — [HL] est l'octet POINTÉ par HL", () => {
  // HL contient une adresse ; l'opérande est l'octet en mémoire à cette adresse.
  const setup = ({ A, at = 0xc123, byte, cIn }) => {
    const cpu = new CPU(new Memory());
    cpu.registers.A.setValue(A);
    cpu.registers.HL.setValue(at);
    cpu.memory.write(at, byte);
    cpu.registers.F.N = 1; // ADC est une addition : N doit repasser à 0
    cpu.registers.F.C = cIn;
    return cpu;
  };

  it('expose ADC_A_HL avec son id et une méthode run', () => {
    expect(instructions.ADC_A_HL, 'instructions.ADC_A_HL est absent').toBeDefined();
    expect(instructions.ADC_A_HL.id).toBe('ADC_A_HL');
    expect(typeof instructions.ADC_A_HL.run).toBe('function');
  });

  it.each([
    // mêmes flags que ADC A,r8 (« Flags: See ADC A,r8 ») — l'opérande vient juste de la mémoire
    { cas: 'addition simple via le pointeur', A: 0x01, byte: 0x02, cIn: 0, expA: 0x03, Z: 0, H: 0, C: 0 },
    { cas: 'la retenue entrante participe (+1)', A: 0x01, byte: 0x02, cIn: 1, expA: 0x04, Z: 0, H: 0, C: 0 },
    { cas: 'half-carry : les nibbles bas débordent (8+9=17)', A: 0x28, byte: 0x19, cIn: 0, expA: 0x41, Z: 0, H: 1, C: 0 },
    { cas: 'débordement complet : A wrappe à 0, Z H C levés', A: 0xff, byte: 0x01, cIn: 0, expA: 0x00, Z: 1, H: 1, C: 1 },
    { cas: 'la retenue entrante provoque à elle seule le débordement', A: 0xff, byte: 0x00, cIn: 1, expA: 0x00, Z: 1, H: 1, C: 1 },
  ].map((c) => ({ ...c, label: `ADC_A_HL(A=${hex(c.A, 2)}, [0xC123]=${hex(c.byte, 2)}, C=${c.cIn})` })))(
    '$cas : $label',
    ({ A, byte, cIn, expA, Z, H, C, label }) => {
      const cpu = setup({ A, byte, cIn });
      instructions.ADC_A_HL.run(cpu);
      const F = cpu.registers.F;
      expect(hex(cpu.registers.A.getValue(), 2), `${label} → A, ${dumpFlags(F)}`).toBe(hex(expA, 2));
      expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
      expect(+!!F.N, `${label} → N doit valoir 0 après une addition, ${dumpFlags(F)}`).toBe(0);
      expect(+!!F.H, `${label} → H, ${dumpFlags(F)}`).toBe(H);
      expect(+!!F.C, `${label} → C, ${dumpFlags(F)}`).toBe(C);
    },
  );

  it("ajoute l'octet pointé, PAS la valeur de HL", () => {
    // Si l'implémentation additionnait HL (0xC123) au lieu de mémoire[0xC123],
    // A ne vaudrait certainement pas 0x15.
    const cpu = setup({ A: 0x10, at: 0xc123, byte: 0x05, cIn: 0 });
    instructions.ADC_A_HL.run(cpu);
    expect(
      hex(cpu.registers.A.getValue(), 2),
      `A=0x10 + [0xC123]=0x05 : ${dumpFlags(cpu.registers.F)}`,
    ).toBe('0x15');
  });

  it('ne modifie ni HL, ni la mémoire', () => {
    const cpu = setup({ A: 0x01, at: 0xc123, byte: 0x02, cIn: 0 });
    instructions.ADC_A_HL.run(cpu);
    expect(hex(cpu.registers.HL.getValue()), 'HL ne doit pas bouger').toBe('0xC123');
    expect(hex(cpu.memory.read(0xc123), 2), "l'octet pointé ne doit pas bouger").toBe('0x02');
  });

  describe('ADD_A_HL : comme ADC_A_HL mais sans retenue entrante', () => {
    it('expose ADD_A_HL avec son id et une méthode run', () => {
      expect(instructions.ADD_A_HL, 'instructions.ADD_A_HL est absent').toBeDefined();
      expect(instructions.ADD_A_HL.id).toBe('ADD_A_HL');
      expect(typeof instructions.ADD_A_HL.run).toBe('function');
    });

    it.each([
      { cas: 'addition simple via le pointeur', A: 0x01, byte: 0x02, cIn: 0, expA: 0x03, Z: 0, H: 0, C: 0 },
      { cas: 'IGNORE la retenue entrante (différence avec ADC)', A: 0x01, byte: 0x02, cIn: 1, expA: 0x03, Z: 0, H: 0, C: 0 },
      { cas: 'débordement complet : A wrappe à 0, Z H C levés', A: 0xff, byte: 0x01, cIn: 0, expA: 0x00, Z: 1, H: 1, C: 1 },
    ].map((c) => ({ ...c, label: `ADD_A_HL(A=${hex(c.A, 2)}, [0xC123]=${hex(c.byte, 2)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ A, byte, cIn, expA, Z, H, C, label }) => {
        const cpu = setup({ A, byte, cIn });
        instructions.ADD_A_HL.run(cpu);
        const F = cpu.registers.F;
        expect(hex(cpu.registers.A.getValue(), 2), `${label} → A, ${dumpFlags(F)}`).toBe(hex(expA, 2));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N doit valoir 0 après une addition, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H, ${dumpFlags(F)}`).toBe(H);
        expect(+!!F.C, `${label} → C, ${dumpFlags(F)}`).toBe(C);
      },
    );
  });

  describe('AND_A_HL : A = A & [HL] — H TOUJOURS 1, C TOUJOURS 0', () => {
    it('expose AND_A_HL avec son id et une méthode run', () => {
      expect(instructions.AND_A_HL, 'instructions.AND_A_HL est absent').toBeDefined();
      expect(instructions.AND_A_HL.id).toBe('AND_A_HL');
      expect(typeof instructions.AND_A_HL.run).toBe('function');
    });

    it.each([
      { cas: 'ET bit à bit via le pointeur', A: 0b1100_1010, byte: 0b1010_0110, expA: 0b1000_0010, Z: 0 },
      { cas: 'aucun bit commun → Z levé', A: 0b1111_0000, byte: 0b0000_1111, expA: 0b0000_0000, Z: 1 },
    ].map((c) => ({ ...c, label: `AND_A_HL(A=${bin(c.A)}, [0xC123]=${bin(c.byte)})` })))(
      '$cas : $label',
      ({ A, byte, expA, Z, label }) => {
        const cpu = setup({ A, byte, cIn: 1 }); // C=1 pré-levé : doit être forcé à 0
        cpu.registers.F.H = 0; // doit être forcé à 1
        instructions.AND_A_HL.run(cpu);
        const F = cpu.registers.F;
        expect(bin(cpu.registers.A.getValue()), `${label} → A, ${dumpFlags(F)}`).toBe(bin(expA));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N doit être forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H doit être forcé à 1, ${dumpFlags(F)}`).toBe(1);
        expect(+!!F.C, `${label} → C doit être forcé à 0, ${dumpFlags(F)}`).toBe(0);
      },
    );
  });

  describe('BIT_u3_HL : teste le bit u3 de [HL] — Z = INVERSE du bit, C PRÉSERVÉ', () => {
    it('expose BIT_u3_HL avec son id et une méthode run', () => {
      expect(instructions.BIT_u3_HL, 'instructions.BIT_u3_HL est absent').toBeDefined();
      expect(instructions.BIT_u3_HL.id).toBe('BIT_u3_HL');
      expect(typeof instructions.BIT_u3_HL.run).toBe('function');
    });

    it.each([
      { cas: 'bit levé dans l\'octet pointé → Z=0', u3: 7, byte: 0b1000_0000, cIn: 1, Z: 0 },
      { cas: 'bit éteint dans l\'octet pointé → Z=1', u3: 7, byte: 0b0111_1111, cIn: 0, Z: 1 },
      { cas: 'bit 0 de l\'octet pointé', u3: 0, byte: 0b0000_0001, cIn: 0, Z: 0 },
    ].map((c) => ({ ...c, label: `BIT_u3_HL(u3=${c.u3}, [0xC123]=${bin(c.byte)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ u3, byte, cIn, Z, label }) => {
        const cpu = setup({ A: 0x42, byte, cIn });
        cpu.registers.F.H = 0; // doit être forcé à 1
        instructions.BIT_u3_HL.run(cpu, u3);
        const F = cpu.registers.F;
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N doit être forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H doit être forcé à 1, ${dumpFlags(F)}`).toBe(1);
        expect(+!!F.C, `${label} → C doit être PRÉSERVÉ (il valait ${cIn}), ${dumpFlags(F)}`).toBe(cIn);
        expect(bin(cpu.memory.read(0xc123)), `${label} → l'octet pointé ne doit pas bouger`).toBe(bin(byte));
        expect(hex(cpu.registers.A.getValue(), 2), 'A ne doit pas bouger').toBe('0x42');
      },
    );
  });
});
