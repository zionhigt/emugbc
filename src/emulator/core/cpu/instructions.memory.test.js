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

  describe('CP_A_HL : compare A avec l\'octet pointé — flags de SUB, résultat JETÉ', () => {
    it('expose CP_A_HL avec son id et une méthode run', () => {
      expect(instructions.CP_A_HL, 'instructions.CP_A_HL est absent').toBeDefined();
      expect(instructions.CP_A_HL.id).toBe('CP_A_HL');
      expect(typeof instructions.CP_A_HL.run).toBe('function');
    });

    it.each([
      { cas: 'égalité via le pointeur → Z levé', A: 0x42, byte: 0x42, Z: 1, H: 0, C: 0 },
      { cas: 'A plus petit → emprunts levés', A: 0x05, byte: 0x07, Z: 0, H: 1, C: 1 },
    ].map((c) => ({ ...c, label: `CP_A_HL(A=${hex(c.A, 2)}, [0xC123]=${hex(c.byte, 2)})` })))(
      '$cas : $label',
      ({ A, byte, Z, H, C, label }) => {
        const cpu = setup({ A, byte, cIn: 0 });
        instructions.CP_A_HL.run(cpu);
        const F = cpu.registers.F;
        expect(hex(cpu.registers.A.getValue(), 2), `${label} → A doit rester INTACT, ${dumpFlags(F)}`).toBe(hex(A, 2));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N=1 (soustraction), ${dumpFlags(F)}`).toBe(1);
        expect(+!!F.H, `${label} → H, ${dumpFlags(F)}`).toBe(H);
        expect(+!!F.C, `${label} → C, ${dumpFlags(F)}`).toBe(C);
        expect(hex(cpu.memory.read(0xc123), 2), `${label} → l'octet pointé intact`).toBe(hex(byte, 2));
      },
    );
  });

  describe('DEC_HL : décrémente l\'octet pointé par HL, EN mémoire — flags de DEC r8', () => {
    it('expose DEC_HL avec son id et une méthode run', () => {
      expect(instructions.DEC_HL, 'instructions.DEC_HL est absent').toBeDefined();
      expect(instructions.DEC_HL.id).toBe('DEC_HL');
      expect(typeof instructions.DEC_HL.run).toBe('function');
    });

    it.each([
      { cas: 'décrément simple en mémoire', byte: 0x43, cIn: 0, expByte: 0x42, Z: 0, H: 0 },
      { cas: 'tombe à zéro → Z levé', byte: 0x01, cIn: 1, expByte: 0x00, Z: 1, H: 0 },
      { cas: 'wrap 0x00 → 0xFF, C intact', byte: 0x00, cIn: 1, expByte: 0xff, Z: 0, H: 1 },
    ].map((c) => ({ ...c, label: `DEC_HL([0xC123]=${hex(c.byte, 2)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ byte, cIn, expByte, Z, H, label }) => {
        const cpu = setup({ A: 0x42, byte, cIn });
        instructions.DEC_HL.run(cpu);
        const F = cpu.registers.F;
        expect(hex(cpu.memory.read(0xc123), 2), `${label} → l'octet doit être décrémenté EN mémoire, ${dumpFlags(F)}`).toBe(hex(expByte, 2));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N=1, ${dumpFlags(F)}`).toBe(1);
        expect(+!!F.H, `${label} → H, ${dumpFlags(F)}`).toBe(H);
        expect(+!!F.C, `${label} → C préservé, ${dumpFlags(F)}`).toBe(cIn);
        expect(hex(cpu.registers.HL.getValue()), 'HL (le pointeur) ne doit pas bouger').toBe(hex(0xc123));
        expect(hex(cpu.registers.A.getValue(), 2), 'A n\'est pas concerné').toBe('0x42');
      },
    );
  });

  describe('INC_HL : incrémente l\'octet pointé par HL, EN mémoire — flags de INC r8', () => {
    it('expose INC_HL avec son id et une méthode run', () => {
      expect(instructions.INC_HL, 'instructions.INC_HL est absent').toBeDefined();
      expect(instructions.INC_HL.id).toBe('INC_HL');
      expect(typeof instructions.INC_HL.run).toBe('function');
    });

    it.each([
      { cas: 'incrément simple en mémoire', byte: 0x41, cIn: 0, expByte: 0x42, Z: 0, H: 0 },
      { cas: 'retenue de nibble (0x0F + 1)', byte: 0x0f, cIn: 1, expByte: 0x10, Z: 0, H: 1 },
      { cas: 'wrap 0xFF → 0x00 : Z et H levés, C intact', byte: 0xff, cIn: 1, expByte: 0x00, Z: 1, H: 1 },
    ].map((c) => ({ ...c, label: `INC_HL([0xC123]=${hex(c.byte, 2)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ byte, cIn, expByte, Z, H, label }) => {
        const cpu = setup({ A: 0x42, byte, cIn });
        instructions.INC_HL.run(cpu);
        const F = cpu.registers.F;
        expect(hex(cpu.memory.read(0xc123), 2), `${label} → l'octet doit être incrémenté EN mémoire, ${dumpFlags(F)}`).toBe(hex(expByte, 2));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N=0 (addition), ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H, ${dumpFlags(F)}`).toBe(H);
        expect(+!!F.C, `${label} → C préservé, ${dumpFlags(F)}`).toBe(cIn);
        expect(hex(cpu.registers.HL.getValue()), 'HL (le pointeur) ne doit pas bouger').toBe(hex(0xc123));
      },
    );
  });

  describe('famille LD (côté mémoire) : copies via pointeurs — aucun flag', () => {
    const makeCpu = () => {
      const cpu = new CPU(new Memory());
      cpu.registers.F.setValue(0b1111_0000); // sentinelle : aucune LD ne doit y toucher
      return cpu;
    };
    const expectFlagsIntact = (cpu, label) =>
      expect(bin(cpu.registers.F.getValue()), `${label} : flags intacts`).toBe(bin(0b1111_0000));

    it('expose toutes les LD mémoire', () => {
      for (const id of [
        'LD_HL_r8', 'LD_HL_n8', 'LD_r8_HL',
        'LD_r16_A', 'LD_A_r16', 'LD_n16_A', 'LD_A_n16',
        'LDH_n16_A', 'LDH_A_n16', 'LDH_C_A', 'LDH_A_C',
        'LD_HLI_A', 'LD_HLD_A', 'LD_A_HLI', 'LD_A_HLD',
        'LD_n16_SP',
      ]) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it('LD_HL_r8 : écrit r8 à l\'adresse pointée par HL', () => {
      const cpu = makeCpu();
      cpu.registers.HL.setValue(0xc123);
      cpu.registers.B.setValue(0x42);
      instructions.LD_HL_r8.run(cpu, cpu.registers.B);
      expect(hex(cpu.memory.read(0xc123), 2), 'octet écrit en mémoire').toBe('0x42');
      expect(hex(cpu.registers.B.getValue(), 2), 'B intact').toBe('0x42');
      expect(hex(cpu.registers.HL.getValue()), 'HL intact').toBe(hex(0xc123));
      expectFlagsIntact(cpu, 'LD_HL_r8');
    });

    it("LD_HL_n8 : écrit l'immédiat à l'adresse pointée", () => {
      const cpu = makeCpu();
      cpu.registers.HL.setValue(0xc123);
      instructions.LD_HL_n8.run(cpu, 0x99);
      expect(hex(cpu.memory.read(0xc123), 2)).toBe('0x99');
      expectFlagsIntact(cpu, 'LD_HL_n8');
    });

    it("LD_r8_HL : lit l'octet pointé dans le registre, mémoire intacte", () => {
      const cpu = makeCpu();
      cpu.registers.HL.setValue(0xc123);
      cpu.memory.write(0xc123, 0x2a);
      instructions.LD_r8_HL.run(cpu, cpu.registers.D);
      expect(hex(cpu.registers.D.getValue(), 2), 'D reçoit la copie').toBe('0x2A');
      expect(hex(cpu.memory.read(0xc123), 2), 'mémoire intacte').toBe('0x2A');
      expectFlagsIntact(cpu, 'LD_r8_HL');
    });

    it('LD_r16_A / LD_A_r16 : A vers [r16] et retour (via BC et DE)', () => {
      const cpu = makeCpu();
      cpu.registers.A.setValue(0x42);
      cpu.registers.BC.setValue(0xc200);
      instructions.LD_r16_A.run(cpu, cpu.registers.BC);
      expect(hex(cpu.memory.read(0xc200), 2), 'A écrit à [BC]').toBe('0x42');

      cpu.registers.DE.setValue(0xc300);
      cpu.memory.write(0xc300, 0x77);
      instructions.LD_A_r16.run(cpu, cpu.registers.DE);
      expect(hex(cpu.registers.A.getValue(), 2), 'A lu depuis [DE]').toBe('0x77');
      expectFlagsIntact(cpu, 'LD_r16_A / LD_A_r16');
    });

    it('LD_n16_A / LD_A_n16 : A vers une adresse absolue et retour', () => {
      const cpu = makeCpu();
      cpu.registers.A.setValue(0x42);
      instructions.LD_n16_A.run(cpu, 0xc456);
      expect(hex(cpu.memory.read(0xc456), 2), 'A écrit à n16').toBe('0x42');

      cpu.memory.write(0xc789, 0x77);
      instructions.LD_A_n16.run(cpu, 0xc789);
      expect(hex(cpu.registers.A.getValue(), 2), 'A lu depuis n16').toBe('0x77');
      expectFlagsIntact(cpu, 'LD_n16_A / LD_A_n16');
    });

    it('LDH_n16_A / LDH_A_n16 : la page haute 0xFF00 — l\'octet reçu est le bas de l\'adresse', () => {
      const cpu = makeCpu();
      cpu.registers.A.setValue(0x42);
      instructions.LDH_n16_A.run(cpu, 0x44); // → 0xFF44
      expect(hex(cpu.memory.read(0xff44), 2), 'A écrit à 0xFF00 | 0x44').toBe('0x42');

      cpu.memory.write(0xff85, 0x90);
      instructions.LDH_A_n16.run(cpu, 0x85);
      expect(hex(cpu.registers.A.getValue(), 2), 'A lu depuis 0xFF85').toBe('0x90');
      expectFlagsIntact(cpu, 'LDH_n16_A / LDH_A_n16');
    });

    it('LDH_C_A / LDH_A_C : adresse 0xFF00 + registre C (le REGISTRE C, pas le flag !)', () => {
      const cpu = makeCpu();
      cpu.registers.A.setValue(0x42);
      cpu.registers.C.setValue(0x44);
      instructions.LDH_C_A.run(cpu);
      expect(hex(cpu.memory.read(0xff44), 2), 'A écrit à 0xFF00 + C').toBe('0x42');

      cpu.memory.write(0xff44, 0x90);
      instructions.LDH_A_C.run(cpu);
      expect(hex(cpu.registers.A.getValue(), 2), 'A lu depuis 0xFF00 + C').toBe('0x90');
      expectFlagsIntact(cpu, 'LDH_C_A / LDH_A_C');
    });

    it('LD_HLI_A : écrit A à [HL] PUIS incrémente HL', () => {
      const cpu = makeCpu();
      cpu.registers.A.setValue(0x42);
      cpu.registers.HL.setValue(0xc123);
      instructions.LD_HLI_A.run(cpu);
      expect(hex(cpu.memory.read(0xc123), 2), "l'écriture se fait à l'adresse d'AVANT l'incrément").toBe('0x42');
      expect(hex(cpu.registers.HL.getValue()), 'HL incrémenté après coup').toBe(hex(0xc124));
      expectFlagsIntact(cpu, 'LD_HLI_A');
    });

    it('LD_HLD_A : écrit A à [HL] PUIS décrémente HL', () => {
      const cpu = makeCpu();
      cpu.registers.A.setValue(0x42);
      cpu.registers.HL.setValue(0xc123);
      instructions.LD_HLD_A.run(cpu);
      expect(hex(cpu.memory.read(0xc123), 2), "l'écriture se fait à l'adresse d'AVANT le décrément").toBe('0x42');
      expect(hex(cpu.registers.HL.getValue()), 'HL décrémenté après coup').toBe(hex(0xc122));
      expectFlagsIntact(cpu, 'LD_HLD_A');
    });

    it('LD_A_HLI : lit [HL] dans A PUIS incrémente HL — la boucle de copie idiomatique', () => {
      const cpu = makeCpu();
      cpu.registers.HL.setValue(0xc123);
      cpu.memory.write(0xc123, 0x2a);
      instructions.LD_A_HLI.run(cpu);
      expect(hex(cpu.registers.A.getValue(), 2), "A reçoit l'octet d'AVANT l'incrément").toBe('0x2A');
      expect(hex(cpu.registers.HL.getValue()), 'HL incrémenté après coup').toBe(hex(0xc124));
      expectFlagsIntact(cpu, 'LD_A_HLI');
    });

    it('LD_A_HLD : lit [HL] dans A PUIS décrémente HL', () => {
      const cpu = makeCpu();
      cpu.registers.HL.setValue(0xc123);
      cpu.memory.write(0xc123, 0x2a);
      instructions.LD_A_HLD.run(cpu);
      expect(hex(cpu.registers.A.getValue(), 2)).toBe('0x2A');
      expect(hex(cpu.registers.HL.getValue()), 'HL décrémenté après coup').toBe(hex(0xc122));
      expectFlagsIntact(cpu, 'LD_A_HLD');
    });

    it('LD_n16_SP : écrit SP en mémoire, little-endian (bas à n16, haut à n16+1)', () => {
      const cpu = makeCpu();
      cpu.registers.SP.setValue(0xbeef);
      instructions.LD_n16_SP.run(cpu, 0xc300);
      expect(hex(cpu.memory.read(0xc300), 2), 'octet BAS de SP à n16').toBe('0xEF');
      expect(hex(cpu.memory.read(0xc301), 2), 'octet HAUT de SP à n16+1').toBe('0xBE');
      expect(hex(cpu.registers.SP.getValue()), 'SP intact').toBe(hex(0xbeef));
      expectFlagsIntact(cpu, 'LD_n16_SP');
    });
  });

  describe('OR_A_HL : A = A | [HL] — N, H et C forcés à 0', () => {
    it('expose OR_A_HL avec son id et une méthode run', () => {
      expect(instructions.OR_A_HL, 'instructions.OR_A_HL est absent').toBeDefined();
      expect(instructions.OR_A_HL.id).toBe('OR_A_HL');
      expect(typeof instructions.OR_A_HL.run).toBe('function');
    });

    it.each([
      { cas: 'OU bit à bit via le pointeur', A: 0b1100_1010, byte: 0b1010_0110, expA: 0b1110_1110, Z: 0 },
      { cas: 'zéro | zéro → Z levé', A: 0b0000_0000, byte: 0b0000_0000, expA: 0b0000_0000, Z: 1 },
    ].map((c) => ({ ...c, label: `OR_A_HL(A=${bin(c.A)}, [0xC123]=${bin(c.byte)})` })))(
      '$cas : $label',
      ({ A, byte, expA, Z, label }) => {
        const cpu = setup({ A, byte, cIn: 1 }); // C=1 pré-levé : doit être forcé à 0
        cpu.registers.F.H = 1; // doit être forcé à 0
        instructions.OR_A_HL.run(cpu);
        const F = cpu.registers.F;
        expect(bin(cpu.registers.A.getValue()), `${label} → A, ${dumpFlags(F)}`).toBe(bin(expA));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.C, `${label} → C forcé à 0, ${dumpFlags(F)}`).toBe(0);
      },
    );
  });

  describe('PUSH / POP : la pile a ses instructions officielles', () => {
    const makeCpu = (sp = 0xfffe) => {
      const cpu = new CPU(new Memory());
      cpu.registers.SP.setValue(sp);
      return cpu;
    };

    it('expose PUSH_r16, POP_r16, PUSH_AF et POP_AF', () => {
      for (const id of ['PUSH_r16', 'POP_r16', 'PUSH_AF', 'POP_AF']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it('PUSH_r16 : high à SP-1, low à SP-2, SP descend de 2, source et flags intacts', () => {
      const cpu = makeCpu();
      cpu.registers.BC.setValue(0x1234);
      cpu.registers.F.setValue(0b1111_0000);
      instructions.PUSH_r16.run(cpu, cpu.registers.BC);
      expect(hex(cpu.registers.SP.getValue()), 'SP').toBe(hex(0xfffc));
      expect(hex(cpu.memory.read(0xfffd), 2), 'octet haut').toBe('0x12');
      expect(hex(cpu.memory.read(0xfffc), 2), 'octet bas').toBe('0x34');
      expect(hex(cpu.registers.BC.getValue()), 'BC intact').toBe(hex(0x1234));
      expect(bin(cpu.registers.F.getValue()), 'flags intacts').toBe(bin(0b1111_0000));
    });

    it('POP_r16 : lit low à SP, high à SP+1, SP remonte de 2, flags intacts', () => {
      const cpu = makeCpu(0xfffc);
      cpu.memory.write(0xfffc, 0x34);
      cpu.memory.write(0xfffd, 0x12);
      cpu.registers.F.setValue(0b1111_0000);
      instructions.POP_r16.run(cpu, cpu.registers.DE);
      expect(hex(cpu.registers.DE.getValue()), 'DE reconstitué').toBe(hex(0x1234));
      expect(hex(cpu.registers.SP.getValue()), 'SP').toBe(hex(0xfffe));
      expect(bin(cpu.registers.F.getValue()), 'flags intacts (POP r16 n\'y touche pas)').toBe(bin(0b1111_0000));
    });

    it('aller-retour : PUSH BC puis POP DE transfère la valeur, SP au compte rond', () => {
      const cpu = makeCpu();
      cpu.registers.BC.setValue(0xbeef);
      instructions.PUSH_r16.run(cpu, cpu.registers.BC);
      instructions.POP_r16.run(cpu, cpu.registers.DE);
      expect(hex(cpu.registers.DE.getValue()), 'DE = ancien BC').toBe(hex(0xbeef));
      expect(hex(cpu.registers.SP.getValue()), 'SP restauré').toBe(hex(0xfffe));
    });

    it('PUSH_AF : A en haut, F en bas — la photo complète des flags part sur la pile', () => {
      const cpu = makeCpu();
      cpu.registers.A.setValue(0x12);
      cpu.registers.F.setValue(0b1011_0000); // Z=1 N=0 H=1 C=1
      instructions.PUSH_AF.run(cpu);
      expect(hex(cpu.registers.SP.getValue()), 'SP').toBe(hex(0xfffc));
      expect(hex(cpu.memory.read(0xfffd), 2), 'A à SP+1').toBe('0x12');
      expect(bin(cpu.memory.read(0xfffc)), 'F à SP, tel quel').toBe(bin(0b1011_0000));
    });

    it('POP_AF : LE piège — le nibble bas de l\'octet dépilé est JETÉ (F câblé à 0 en bas)', () => {
      const cpu = makeCpu(0xfffc);
      cpu.memory.write(0xfffc, 0b1011_0101); // 0xB5 : nibble bas plein de déchets
      cpu.memory.write(0xfffd, 0x12);
      instructions.POP_AF.run(cpu);
      const F = cpu.registers.F;
      expect(hex(cpu.registers.A.getValue(), 2), 'A depuis l\'octet haut').toBe('0x12');
      expect(+!!F.Z, `Z depuis le bit 7, ${dumpFlags(F)}`).toBe(1);
      expect(+!!F.N, `N depuis le bit 6, ${dumpFlags(F)}`).toBe(0);
      expect(+!!F.H, `H depuis le bit 5, ${dumpFlags(F)}`).toBe(1);
      expect(+!!F.C, `C depuis le bit 4, ${dumpFlags(F)}`).toBe(1);
      expect(bin(F.getValue()), 'le nibble bas de F doit être VIDE (0xB5 devient 0xB0)').toBe(bin(0b1011_0000));
      expect(hex(cpu.registers.SP.getValue()), 'SP').toBe(hex(0xfffe));
    });

    it('aller-retour AF : PUSH AF puis POP AF restitue A et les 4 flags à l\'identique', () => {
      const cpu = makeCpu();
      cpu.registers.A.setValue(0x9c);
      cpu.registers.F.setValue(0b0101_0000); // N=1 C=1
      instructions.PUSH_AF.run(cpu);
      cpu.registers.A.setValue(0x00);
      cpu.registers.F.setValue(0b0000_0000);
      instructions.POP_AF.run(cpu);
      expect(hex(cpu.registers.A.getValue(), 2), 'A restauré').toBe('0x9C');
      expect(bin(cpu.registers.F.getValue()), `flags restaurés : ${dumpFlags(cpu.registers.F)}`).toBe(bin(0b0101_0000));
      expect(hex(cpu.registers.SP.getValue()), 'SP au compte rond').toBe(hex(0xfffe));
    });
  });

  describe('XOR_A_HL : A = A ^ [HL] — N, H et C forcés à 0', () => {
    it('expose XOR_A_HL avec son id et une méthode run', () => {
      expect(instructions.XOR_A_HL, 'instructions.XOR_A_HL est absent').toBeDefined();
      expect(instructions.XOR_A_HL.id).toBe('XOR_A_HL');
      expect(typeof instructions.XOR_A_HL.run).toBe('function');
    });

    it.each([
      { cas: 'XOR via le pointeur', A: 0b1100_1010, byte: 0b1010_0110, expA: 0b0110_1100, Z: 0 },
      { cas: 'octet identique à A → zéro, Z levé', A: 0b0101_1010, byte: 0b0101_1010, expA: 0b0000_0000, Z: 1 },
    ].map((c) => ({ ...c, label: `XOR_A_HL(A=${bin(c.A)}, [0xC123]=${bin(c.byte)})` })))(
      '$cas : $label',
      ({ A, byte, expA, Z, label }) => {
        const cpu = setup({ A, byte, cIn: 1 }); // C=1 : doit être forcé à 0
        cpu.registers.F.H = 1; // doit être forcé à 0
        instructions.XOR_A_HL.run(cpu);
        const F = cpu.registers.F;
        expect(bin(cpu.registers.A.getValue()), `${label} → A, ${dumpFlags(F)}`).toBe(bin(expA));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.H, `${label} → H forcé à 0, ${dumpFlags(F)}`).toBe(0);
        expect(+!!F.C, `${label} → C forcé à 0, ${dumpFlags(F)}`).toBe(0);
      },
    );
  });

  describe('RES_u3_HL : éteint le bit u3 de l\'octet pointé, EN mémoire — aucun flag', () => {
    it('expose RES_u3_HL avec son id et une méthode run', () => {
      expect(instructions.RES_u3_HL, 'instructions.RES_u3_HL est absent').toBeDefined();
      expect(instructions.RES_u3_HL.id).toBe('RES_u3_HL');
      expect(typeof instructions.RES_u3_HL.run).toBe('function');
    });

    it.each([
      { cas: 'éteint le bit visé dans l\'octet pointé', u3: 7, byte: 0b1010_1010, expByte: 0b0010_1010 },
      { cas: 'idempotent sur bit déjà éteint', u3: 0, byte: 0b1010_1010, expByte: 0b1010_1010 },
    ].map((c) => ({ ...c, label: `RES_u3_HL(u3=${c.u3}, [0xC123]=${bin(c.byte)})` })))(
      '$cas : $label',
      ({ u3, byte, expByte, label }) => {
        const cpu = setup({ A: 0x42, byte, cIn: 1 });
        cpu.registers.F.setValue(0b1111_0000); // sentinelle
        instructions.RES_u3_HL.run(cpu, u3);
        expect(bin(cpu.memory.read(0xc123)), `${label} → l'octet modifié EN mémoire`).toBe(bin(expByte));
        expect(hex(cpu.registers.HL.getValue()), 'HL (pointeur) intact').toBe(hex(0xc123));
        expect(bin(cpu.registers.F.getValue()), 'flags intacts').toBe(bin(0b1111_0000));
      },
    );
  });

  describe('RET / RET_cc / RETI : les retours — un POP dans PC', () => {
    // pile préparée avec une adresse de retour 0xC003 (little-endian)
    const makeCpuReady = () => {
      const cpu = new CPU(new Memory());
      cpu.registers.PC.setValue(0x1234); // on est "dans la fonction"
      cpu.registers.SP.setValue(0xfffc);
      cpu.memory.write(0xfffc, 0x03); // low du retour
      cpu.memory.write(0xfffd, 0xc0); // high du retour
      return cpu;
    };

    it('expose RET, RET_cc et RETI', () => {
      for (const id of ['RET', 'RET_cc', 'RETI']) {
        expect(instructions[id], `instructions.${id} est absent`).toBeDefined();
        expect(instructions[id].id).toBe(id);
        expect(typeof instructions[id].run).toBe('function');
      }
    });

    it('RET : dépile le retour dans PC, SP remonte de 2, flags intacts', () => {
      const cpu = makeCpuReady();
      cpu.registers.F.setValue(0b1111_0000);
      instructions.RET.run(cpu);
      expect(hex(cpu.registers.PC.getValue()), 'PC = adresse dépilée').toBe(hex(0xc003));
      expect(hex(cpu.registers.SP.getValue()), 'SP remonté').toBe(hex(0xfffe));
      expect(bin(cpu.registers.F.getValue()), 'flags intacts').toBe(bin(0b1111_0000));
    });

    it('intégration : CALL puis RET — le cycle de fonction complet revient au point de départ', () => {
      const cpu = new CPU(new Memory());
      cpu.registers.PC.setValue(0xc003); // après le CALL (convention décodeur)
      cpu.registers.SP.setValue(0xfffe);
      instructions.CALL_n16.run(cpu, 0x1234); // on part dans la fonction
      expect(hex(cpu.registers.PC.getValue()), 'aller').toBe(hex(0x1234));
      instructions.RET.run(cpu); // la fonction rend la main
      expect(hex(cpu.registers.PC.getValue()), 'retour pile après le CALL').toBe(hex(0xc003));
      expect(hex(cpu.registers.SP.getValue()), 'SP au compte rond').toBe(hex(0xfffe));
    });

    it.each([
      { cc: 'Z', F: 0b1000_0000, taken: true },
      { cc: 'Z', F: 0b0000_0000, taken: false },
      { cc: 'NC', F: 0b0000_0000, taken: true },
      { cc: 'C', F: 0b0000_0000, taken: false },
    ].map((c) => ({
      ...c,
      label: `RET_cc("${c.cc}") avec F=${bin(c.F)}`,
      attendu: c.taken ? 'prise (dépile)' : 'pas prise (ne dépile RIEN)',
    })))('RET_cc, condition $attendu : $label', ({ cc, F: flags, taken, label }) => {
      const cpu = makeCpuReady();
      cpu.registers.F.setValue(flags);
      instructions.RET_cc.run(cpu, cc);
      const F = cpu.registers.F;
      if (taken) {
        expect(hex(cpu.registers.PC.getValue()), `${label} → PC dépilé, ${dumpFlags(F)}`).toBe(hex(0xc003));
        expect(hex(cpu.registers.SP.getValue()), `${label} → SP remonté`).toBe(hex(0xfffe));
      } else {
        expect(hex(cpu.registers.PC.getValue()), `${label} → PC immobile, ${dumpFlags(F)}`).toBe(hex(0x1234));
        expect(hex(cpu.registers.SP.getValue()), `${label} → SP immobile, rien n'a été dépilé`).toBe(hex(0xfffc));
      }
      expect(bin(F.getValue()), `${label} → flags intacts`).toBe(bin(flags));
    });

    it('RETI : dépile comme RET et allume IME IMMÉDIATEMENT (pas le délai d\'EI !)', () => {
      const cpu = makeCpuReady();
      instructions.RETI.run(cpu);
      expect(hex(cpu.registers.PC.getValue()), 'PC dépilé').toBe(hex(0xc003));
      expect(hex(cpu.registers.SP.getValue()), 'SP remonté').toBe(hex(0xfffe));
      expect(cpu.ime, 'ime doit être allumé TOUT DE SUITE, pas armé pour plus tard').toBe(true);
    });
  });

  describe('RL_HL : rotation gauche à travers le carry de l\'octet pointé, EN mémoire', () => {
    it('expose RL_HL avec son id et une méthode run', () => {
      expect(instructions.RL_HL, 'instructions.RL_HL est absent').toBeDefined();
      expect(instructions.RL_HL.id).toBe('RL_HL');
      expect(typeof instructions.RL_HL.run).toBe('function');
    });

    it.each([
      { cas: 'anneau complet via le pointeur (b7 sort, ancien C rentre)', byte: 0b1000_0000, cIn: 1, expByte: 0b0000_0001, expC: 1, Z: 0 },
      { cas: 'résultat nul en mémoire → Z levé (variante CB : Z se calcule)', byte: 0b1000_0000, cIn: 0, expByte: 0b0000_0000, expC: 1, Z: 1 },
    ].map((c) => ({ ...c, label: `RL_HL([0xC123]=${bin(c.byte)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ byte, cIn, expByte, expC, Z, label }) => {
        const cpu = setup({ A: 0x42, byte, cIn });
        instructions.RL_HL.run(cpu);
        const F = cpu.registers.F;
        expect(bin(cpu.memory.read(0xc123)), `${label} → l'octet tourné EN mémoire, ${dumpFlags(F)}`).toBe(bin(expByte));
        expect(+!!F.C, `${label} → C = bit éjecté, ${dumpFlags(F)}`).toBe(expC);
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(hex(cpu.registers.HL.getValue()), 'HL (pointeur) intact').toBe(hex(0xc123));
      },
    );
  });

  describe('SBC_A_HL : A = A - [HL] - C — flags de SBC A,r8', () => {
    it('expose SBC_A_HL avec son id et une méthode run', () => {
      expect(instructions.SBC_A_HL, 'instructions.SBC_A_HL est absent').toBeDefined();
      expect(instructions.SBC_A_HL.id).toBe('SBC_A_HL');
      expect(typeof instructions.SBC_A_HL.run).toBe('function');
    });

    it.each([
      { cas: "l'emprunt entrant participe via le pointeur", A: 0x05, byte: 0x02, cIn: 1, expA: 0x02, Z: 0, H: 0, C: 0 },
      { cas: 'emprunt complet : A wrappe', A: 0x05, byte: 0x07, cIn: 0, expA: 0xfe, Z: 0, H: 1, C: 1 },
      { cas: "l'emprunt entrant seul fait tout déborder (0-0-1)", A: 0x00, byte: 0x00, cIn: 1, expA: 0xff, Z: 0, H: 1, C: 1 },
    ].map((c) => ({ ...c, label: `SBC_A_HL(A=${hex(c.A, 2)}, [0xC123]=${hex(c.byte, 2)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ A, byte, cIn, expA, Z, H, C, label }) => {
        const cpu = setup({ A, byte, cIn });
        cpu.registers.F.N = 0; // doit être forcé à 1
        instructions.SBC_A_HL.run(cpu);
        const F = cpu.registers.F;
        expect(hex(cpu.registers.A.getValue(), 2), `${label} → A, ${dumpFlags(F)}`).toBe(hex(expA, 2));
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(+!!F.N, `${label} → N=1 (soustraction), ${dumpFlags(F)}`).toBe(1);
        expect(+!!F.H, `${label} → H, ${dumpFlags(F)}`).toBe(H);
        expect(+!!F.C, `${label} → C, ${dumpFlags(F)}`).toBe(C);
        expect(hex(cpu.memory.read(0xc123), 2), "l'octet pointé intact").toBe(hex(byte, 2));
      },
    );
  });

  describe('RST : un CALL compressé vers un vecteur fixe', () => {
    it('expose RST avec son id et une méthode run', () => {
      expect(instructions.RST_vec, 'instructions.RST_vec est absent').toBeDefined();
      expect(instructions.RST_vec.id).toBe('RST_vec');
      expect(typeof instructions.RST_vec.run).toBe('function');
    });

    it.each([
      { vec: 0x00 },
      { vec: 0x08 },
      { vec: 0x28 },
      { vec: 0x38 },
    ].map((c) => ({ ...c, label: `RST(${hex(c.vec, 2)})` })))(
      '$label : pousse le retour et saute au vecteur',
      ({ vec, label }) => {
        const cpu = new CPU(new Memory());
        cpu.registers.PC.setValue(0xc001); // après le RST (1 octet)
        cpu.registers.SP.setValue(0xfffe);
        cpu.registers.F.setValue(0b1111_0000);
        instructions.RST_vec.run(cpu, vec);
        expect(hex(cpu.registers.PC.getValue()), `${label} → PC = le vecteur`).toBe(hex(vec));
        expect(hex(cpu.registers.SP.getValue()), `${label} → retour empilé`).toBe(hex(0xfffc));
        expect(hex(cpu.stack.pop()), `${label} → l'adresse de retour est le PC d'entrée`).toBe(hex(0xc001));
        expect(bin(cpu.registers.F.getValue()), 'flags intacts').toBe(bin(0b1111_0000));
      },
    );

    it('aller-retour : RST puis RET revient après le RST — comme un vrai CALL', () => {
      const cpu = new CPU(new Memory());
      cpu.registers.PC.setValue(0xc001);
      cpu.registers.SP.setValue(0xfffe);
      instructions.RST_vec.run(cpu, 0x08);
      instructions.RET.run(cpu);
      expect(hex(cpu.registers.PC.getValue()), 'retour au point de départ').toBe(hex(0xc001));
      expect(hex(cpu.registers.SP.getValue()), 'SP au compte rond').toBe(hex(0xfffe));
    });
  });

  describe('RR_HL : rotation droite à travers le carry de l\'octet pointé, EN mémoire', () => {
    it('expose RR_HL avec son id et une méthode run', () => {
      expect(instructions.RR_HL, 'instructions.RR_HL est absent').toBeDefined();
      expect(instructions.RR_HL.id).toBe('RR_HL');
      expect(typeof instructions.RR_HL.run).toBe('function');
    });

    it.each([
      { cas: 'anneau complet via le pointeur (b0 sort, ancien C rentre en b7)', byte: 0b0000_0001, cIn: 1, expByte: 0b1000_0000, expC: 1, Z: 0 },
      { cas: 'résultat nul en mémoire → Z levé (variante CB)', byte: 0b0000_0001, cIn: 0, expByte: 0b0000_0000, expC: 1, Z: 1 },
    ].map((c) => ({ ...c, label: `RR_HL([0xC123]=${bin(c.byte)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ byte, cIn, expByte, expC, Z, label }) => {
        const cpu = setup({ A: 0x42, byte, cIn });
        instructions.RR_HL.run(cpu);
        const F = cpu.registers.F;
        expect(bin(cpu.memory.read(0xc123)), `${label} → l'octet tourné EN mémoire, ${dumpFlags(F)}`).toBe(bin(expByte));
        expect(+!!F.C, `${label} → C = bit éjecté (b0), ${dumpFlags(F)}`).toBe(expC);
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(hex(cpu.registers.HL.getValue()), 'HL (pointeur) intact').toBe(hex(0xc123));
      },
    );
  });

  describe('RRC_HL : rotation droite circulaire de l\'octet pointé, EN mémoire', () => {
    it('expose RRC_HL avec son id et une méthode run', () => {
      expect(instructions.RRC_HL, 'instructions.RRC_HL est absent').toBeDefined();
      expect(instructions.RRC_HL.id).toBe('RRC_HL');
      expect(typeof instructions.RRC_HL.run).toBe('function');
    });

    it.each([
      { cas: 'b0 fait le tour via le pointeur, copie dans C', byte: 0b0000_0011, cIn: 0, expByte: 0b1000_0001, expC: 1, Z: 0 },
      { cas: 'le C entrant ne change RIEN au résultat', byte: 0b0000_0011, cIn: 1, expByte: 0b1000_0001, expC: 1, Z: 0 },
      { cas: 'zéro en mémoire : Z levé, C éteint', byte: 0b0000_0000, cIn: 1, expByte: 0b0000_0000, expC: 0, Z: 1 },
    ].map((c) => ({ ...c, label: `RRC_HL([0xC123]=${bin(c.byte)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ byte, cIn, expByte, expC, Z, label }) => {
        const cpu = setup({ A: 0x42, byte, cIn });
        instructions.RRC_HL.run(cpu);
        const F = cpu.registers.F;
        expect(bin(cpu.memory.read(0xc123)), `${label} → l'octet tourné EN mémoire, ${dumpFlags(F)}`).toBe(bin(expByte));
        expect(+!!F.C, `${label} → C = copie du bit qui a tourné, ${dumpFlags(F)}`).toBe(expC);
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(hex(cpu.registers.HL.getValue()), 'HL (pointeur) intact').toBe(hex(0xc123));
      },
    );
  });

  describe('RLC_HL : rotation gauche circulaire de l\'octet pointé, EN mémoire', () => {
    it('expose RLC_HL avec son id et une méthode run', () => {
      expect(instructions.RLC_HL, 'instructions.RLC_HL est absent').toBeDefined();
      expect(instructions.RLC_HL.id).toBe('RLC_HL');
      expect(typeof instructions.RLC_HL.run).toBe('function');
    });

    it.each([
      { cas: 'b7 fait le tour via le pointeur, copie dans C', byte: 0b1000_0001, cIn: 0, expByte: 0b0000_0011, expC: 1, Z: 0 },
      { cas: 'le C entrant ne change RIEN au résultat', byte: 0b1000_0001, cIn: 1, expByte: 0b0000_0011, expC: 1, Z: 0 },
      { cas: 'zéro en mémoire : Z levé, C éteint', byte: 0b0000_0000, cIn: 1, expByte: 0b0000_0000, expC: 0, Z: 1 },
    ].map((c) => ({ ...c, label: `RLC_HL([0xC123]=${bin(c.byte)}, C=${c.cIn})` })))(
      '$cas : $label',
      ({ byte, cIn, expByte, expC, Z, label }) => {
        const cpu = setup({ A: 0x42, byte, cIn });
        instructions.RLC_HL.run(cpu);
        const F = cpu.registers.F;
        expect(bin(cpu.memory.read(0xc123)), `${label} → l'octet tourné EN mémoire, ${dumpFlags(F)}`).toBe(bin(expByte));
        expect(+!!F.C, `${label} → C = copie du bit qui a tourné, ${dumpFlags(F)}`).toBe(expC);
        expect(+!!F.Z, `${label} → Z, ${dumpFlags(F)}`).toBe(Z);
        expect(hex(cpu.registers.HL.getValue()), 'HL (pointeur) intact').toBe(hex(0xc123));
      },
    );
  });

  describe('CALL_n16 : pousse PC (adresse de retour) puis saute à n16', () => {
    // Convention : à l'entrée de run, PC pointe DÉJÀ sur l'instruction suivante
    // (le décodeur aura consommé opcode + opérandes avant d'exécuter).
    const setupCall = ({ pc, sp }) => {
      const cpu = new CPU(new Memory());
      cpu.registers.PC.setValue(pc);
      cpu.registers.SP.setValue(sp);
      return cpu;
    };

    it('expose CALL_n16 avec son id et une méthode run', () => {
      expect(instructions.CALL_n16, 'instructions.CALL_n16 est absent').toBeDefined();
      expect(instructions.CALL_n16.id).toBe('CALL_n16');
      expect(typeof instructions.CALL_n16.run).toBe('function');
    });

    it('saute : PC vaut n16 après exécution', () => {
      const cpu = setupCall({ pc: 0xc003, sp: 0xfffe });
      instructions.CALL_n16.run(cpu, 0x1234);
      expect(hex(cpu.registers.PC.getValue()), 'PC → la destination').toBe(hex(0x1234));
    });

    it("pousse l'adresse de retour (le PC d'entrée, déjà incrémenté) sur la pile", () => {
      // scénario : un CALL 0x1234 situé à 0xC000 (3 octets) ; le décodeur a
      // amené PC à 0xC003 — c'est CETTE adresse qui doit finir sur la pile.
      const cpu = setupCall({ pc: 0xc003, sp: 0xfffe });
      instructions.CALL_n16.run(cpu, 0x1234);
      expect(hex(cpu.registers.SP.getValue()), 'SP a descendu de 2').toBe(hex(0xfffc));
      expect(hex(cpu.memory.read(0xfffd), 2), 'octet haut du retour à SP+1').toBe('0xC0');
      expect(hex(cpu.memory.read(0xfffc), 2), 'octet bas du retour à SP').toBe('0x03');
    });

    it("aller-retour : un pop rend l'adresse de retour (ce que fera RET)", () => {
      const cpu = setupCall({ pc: 0xc003, sp: 0xfffe });
      instructions.CALL_n16.run(cpu, 0x1234);
      expect(hex(cpu.stack.pop()), 'RET récupérera 0xC003').toBe(hex(0xc003));
      expect(hex(cpu.registers.SP.getValue()), 'SP restauré').toBe(hex(0xfffe));
    });

    it('ne touche à aucun flag (« Flags: None affected »)', () => {
      const cpu = setupCall({ pc: 0xc003, sp: 0xfffe });
      cpu.registers.F.setValue(0b1111_0000); // Z N H C tous levés
      instructions.CALL_n16.run(cpu, 0x1234);
      expect(bin(cpu.registers.F.getValue()), dumpFlags(cpu.registers.F)).toBe(bin(0b1111_0000));
    });

    describe('CALL_cc_n16 : appelle seulement si la condition cc est vraie', () => {
      // cc est le mnémonique de la doc : "Z" (Z levé), "NZ" (Z éteint),
      // "C" (C levé), "NC" (C éteint) — l'instruction évalue F elle-même.
      it('expose CALL_cc_n16 avec son id et une méthode run', () => {
        expect(instructions.CALL_cc_n16, 'instructions.CALL_cc_n16 est absent').toBeDefined();
        expect(instructions.CALL_cc_n16.id).toBe('CALL_cc_n16');
        expect(typeof instructions.CALL_cc_n16.run).toBe('function');
      });

      it.each([
        { cc: 'Z', F: 0b1000_0000, taken: true },
        { cc: 'Z', F: 0b0000_0000, taken: false },
        { cc: 'NZ', F: 0b0000_0000, taken: true },
        { cc: 'NZ', F: 0b1000_0000, taken: false },
        { cc: 'C', F: 0b0001_0000, taken: true },
        { cc: 'C', F: 0b0000_0000, taken: false },
        { cc: 'NC', F: 0b0000_0000, taken: true },
        { cc: 'NC', F: 0b0001_0000, taken: false },
      ].map((c) => ({
        ...c,
        label: `CALL_cc_n16("${c.cc}", 0x1234) avec F=${bin(c.F)}`,
        attendu: c.taken ? 'prise (taken)' : 'pas prise (untaken)',
      })))(
        '$label : condition $attendu',
        ({ cc, F: flags, taken, label }) => {
          const cpu = setupCall({ pc: 0xc003, sp: 0xfffe });
          cpu.registers.F.setValue(flags);
          instructions.CALL_cc_n16.run(cpu, cc, 0x1234);
          const F = cpu.registers.F;
          if (taken) {
            expect(hex(cpu.registers.PC.getValue()), `${label} : PC doit sauter, ${dumpFlags(F)}`).toBe(hex(0x1234));
            expect(hex(cpu.registers.SP.getValue()), `${label} : le retour doit être empilé`).toBe(hex(0xfffc));
            expect(hex(cpu.stack.pop()), `${label} : adresse de retour sur la pile`).toBe(hex(0xc003));
          } else {
            expect(hex(cpu.registers.PC.getValue()), `${label} : PC ne doit PAS bouger, ${dumpFlags(F)}`).toBe(hex(0xc003));
            expect(hex(cpu.registers.SP.getValue()), `${label} : rien ne doit être empilé`).toBe(hex(0xfffe));
          }
          expect(bin(F.getValue()), `${label} : les flags ne bougent jamais`).toBe(bin(flags));
        },
      );
    });
  });
});
