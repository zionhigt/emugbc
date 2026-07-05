import { describe, it, expect } from 'vitest';

import { Register, FlagRegister } from './register';

// Formatage lisible pour le debug : binaire et hexa plutôt que décimal
const bin = (n, width = 8) => '0b' + (n >>> 0).toString(2).padStart(width, '0');
const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

describe('Register', () => {
  it.each([
    { size: 12 },
    { size: undefined },
  ])('lève une erreur pour une taille non supportée (Register($size))', ({ size }) => {
    expect(() => Register(size), `Register(${size}) aurait dû lever une erreur`).toThrow();
  });

  describe('Register(8)', () => {
    it("vaut 0 à l'initialisation", () => {
      const reg = new (Register(8))();
      const value = reg.getValue();
      expect(value, `getValue() a retourné ${hex(value, 2)} après initialisation`).toBe(0);
    });

    it('stocke et relit une valeur', () => {
      const reg = new (Register(8))();
      reg.setValue(0x42);
      const value = reg.getValue();
      expect(value, `setValue(0x42) puis getValue() a retourné ${hex(value, 2)}`).toBe(0x42);
    });

    it.each([
      { input: 0x1ff, expected: 0xff },
      { input: 256, expected: 0 },
    ].map((c) => ({ ...c, label: `setValue(${hex(c.input)})` })))(
      'déborde sur 8 bits : $label → $expected',
      ({ input, expected, label }) => {
        const reg = new (Register(8))();
        reg.setValue(input);
        const value = reg.getValue();
        expect(
          value,
          `${label} : getValue() a retourné ${hex(value, 2)} (${bin(value)}), attendu ${hex(expected, 2)}`,
        ).toBe(expected);
      },
    );
  });

  describe('increment / decrement', () => {
    it('increment ajoute 1', () => {
      const reg = new (Register(8))();
      reg.setValue(0x41);
      reg.increment();
      expect(reg.getValue()).toBe(0x42);
    });

    it('decrement retranche 1', () => {
      const reg = new (Register(8))();
      reg.setValue(0x43);
      reg.decrement();
      expect(reg.getValue()).toBe(0x42);
    });

    it('increment wrappe au max : 0xFF → 0x00 (8 bits), 0xFFFF → 0x0000 (16 bits)', () => {
      const reg8 = new (Register(8))();
      reg8.setValue(0xff);
      reg8.increment();
      expect(reg8.getValue(), '0xFF + 1 doit wrapper à 0').toBe(0x00);

      const reg16 = new (Register(16))();
      reg16.setValue(0xffff);
      reg16.increment();
      expect(reg16.getValue(), '0xFFFF + 1 doit wrapper à 0').toBe(0x0000);
    });

    it('decrement wrappe à zéro : 0x00 → 0xFF (8 bits), 0x0000 → 0xFFFF (16 bits)', () => {
      const reg8 = new (Register(8))();
      reg8.decrement();
      expect(reg8.getValue(), '0x00 - 1 doit wrapper au max').toBe(0xff);

      const reg16 = new (Register(16))();
      reg16.decrement();
      expect(reg16.getValue(), '0x0000 - 1 doit wrapper au max (le wrap de SP de la pile)').toBe(0xffff);
    });

    it('les appels se cumulent et push/pop se neutralisent (2 décréments + 2 incréments)', () => {
      const reg = new (Register(16))();
      reg.setValue(0xfffe);
      reg.decrement();
      reg.decrement();
      expect(reg.getValue(), 'après 2 décréments').toBe(0xfffc);
      reg.increment();
      reg.increment();
      expect(reg.getValue(), 'revenu au point de départ').toBe(0xfffe);
    });
  });

  describe('Register(16)', () => {
    it('stocke une valeur 16 bits', () => {
      const reg = new (Register(16))();
      reg.setValue(0xabcd);
      const value = reg.getValue();
      expect(value, `setValue(0xABCD) puis getValue() a retourné ${hex(value)}`).toBe(0xabcd);
    });

    it('déborde sur 16 bits (wrap à 65536)', () => {
      const reg = new (Register(16))();
      reg.setValue(0x1ffff);
      const value = reg.getValue();
      expect(value, `setValue(0x1FFFF) : getValue() a retourné ${hex(value)}, attendu 0xFFFF`).toBe(0xffff);
    });
  });
});

describe('FlagRegister', () => {
  // Registre F de la Game Boy : Z N H C sur les bits 7..4
  const gbFlags = {
    Z: { offset: 7 },
    N: { offset: 6 },
    H: { offset: 5 },
    C: { offset: 4 },
  };

  const dumpFlags = (flags) =>
    `valeur brute = ${bin(flags.getValue())}, flags = ` +
    Object.keys(gbFlags)
      .map((k) => `${k}=${flags[k] ? 1 : 0}`)
      .join(' ');

  it('expose les flags en lecture depuis la valeur brute', () => {
    const flags = new (FlagRegister(8))(gbFlags);
    flags.setValue(0b1010_0000); // Z=1 N=0 H=1 C=0
    expect(flags.Z, `après setValue(0b1010_0000) : ${dumpFlags(flags)}`).toBeTruthy();
    expect(flags.N, `après setValue(0b1010_0000) : ${dumpFlags(flags)}`).toBeFalsy();
    expect(flags.H, `après setValue(0b1010_0000) : ${dumpFlags(flags)}`).toBeTruthy();
    expect(flags.C, `après setValue(0b1010_0000) : ${dumpFlags(flags)}`).toBeFalsy();
  });

  it('met à jour la valeur brute quand on écrit un flag', () => {
    const flags = new (FlagRegister(8))(gbFlags);
    flags.Z = 1;
    flags.C = 1;
    expect(
      flags.getValue(),
      `après Z=1 puis C=1 : ${dumpFlags(flags)}, attendu ${bin(0b1001_0000)}`,
    ).toBe(0b1001_0000);
    flags.Z = 0;
    expect(
      flags.getValue(),
      `après Z=0 : ${dumpFlags(flags)}, attendu ${bin(0b0001_0000)}`,
    ).toBe(0b0001_0000);
  });
});
