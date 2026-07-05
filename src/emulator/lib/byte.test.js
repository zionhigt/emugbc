import { describe, it, expect } from 'vitest';

import { getBit, getFlag, setBit, revertBits, buildU16, U16to2U8, sign8 } from './byte';

// Formatage lisible pour le debug : le décimal est illisible pour du bit-à-bit
const bin = (n, width = 8) => '0b' + (n >>> 0).toString(2).padStart(width, '0');
const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

describe('byte', () => {
  describe('getBit', () => {
    it.each([
      { byte: 0b0000_1000, position: 3 },
      { byte: 0b1000_0000, position: 7 },
      { byte: 0b0000_0001, position: 0 },
    ].map((c) => ({ ...c, label: `getBit(${bin(c.byte)}, ${c.position})` })))(
      '$label retourne une valeur non nulle (bit à 1)',
      ({ byte, position, label }) => {
        const result = getBit(byte, position);
        expect(result, `${label} a retourné ${result} (${bin(result)})`).toBeTruthy();
      },
    );

    it.each([
      { byte: 0b0000_1000, position: 2 },
      { byte: 0b0111_1111, position: 7 },
      { byte: 0b0000_0000, position: 0 },
    ].map((c) => ({ ...c, label: `getBit(${bin(c.byte)}, ${c.position})` })))(
      '$label retourne 0 (bit à 0)',
      ({ byte, position, label }) => {
        const result = getBit(byte, position);
        expect(bin(result), label).toBe(bin(0));
      },
    );
  });

  describe('getFlag', () => {
    it.each([
      { byte: 0b1000_0000, position: 7, expected: true },
      { byte: 0b1000_0000, position: 6, expected: false },
    ].map((c) => ({ ...c, label: `getFlag(${bin(c.byte)}, ${c.position})` })))(
      '$label retourne $expected',
      ({ byte, position, expected, label }) => {
        const result = getFlag(byte, position);
        expect(result, `${label} a retourné ${result}, attendu ${expected}`).toBe(expected);
      },
    );
  });

  describe('revertBits', () => {
    it.each([
      { byte: 0b0000_0000, expected: 0b1111_1111 },
      { byte: 0b1111_1111, expected: 0b0000_0000 },
      { byte: 0b1010_1010, expected: 0b0101_0101 },
      // les zéros de tête doivent être inversés aussi (largeur fixe de 8 bits)
      { byte: 0b0000_1000, expected: 0b1111_0111 },
      { byte: 0b0000_0001, expected: 0b1111_1110 },
    ].map((c) => ({ ...c, label: `revertBits(${bin(c.byte)})` })))(
      '$label inverse chaque bit sur 8 bits',
      ({ byte, expected, label }) => {
        const result = revertBits(byte);
        expect(bin(result), label).toBe(bin(expected));
      },
    );

    it('est une involution : revertBits(revertBits(x)) = x', () => {
      const x = 0b0110_1001;
      const result = revertBits(revertBits(x));
      expect(bin(result), `revertBits(revertBits(${bin(x)}))`).toBe(bin(x));
    });
  });

  describe('setBit', () => {
    it.each([
      { cas: 'mise à 1', byte: 0b0000_0000, position: 3, value: 1, expected: 0b0000_1000 },
      { cas: 'mise à 1 sans toucher aux autres bits', byte: 0b0100_0001, position: 3, value: 1, expected: 0b0100_1001 },
      { cas: 'mise à 0', byte: 0b0000_1000, position: 3, value: 0, expected: 0b0000_0000 },
      { cas: 'mise à 0 sans toucher aux autres bits', byte: 0b0000_1111, position: 1, value: 0, expected: 0b0000_1101 },
      { cas: 'idempotent : bit déjà à 1', byte: 0b0000_1010, position: 1, value: 1, expected: 0b0000_1010 },
      { cas: 'idempotent : bit déjà à 0', byte: 0b0000_1010, position: 2, value: 0, expected: 0b0000_1010 },
      { cas: 'valeur truthy (true)', byte: 0b0000_0000, position: 4, value: true, expected: 0b0001_0000 },
      { cas: 'valeur falsy (false)', byte: 0b0001_0000, position: 4, value: false, expected: 0b0000_0000 },
    ].map((c) => ({ ...c, label: `setBit(${bin(c.byte)}, ${c.position}, ${c.value})` })))(
      '$cas — $label',
      ({ byte, position, value, expected, label }) => {
        const result = setBit(byte, position, value);
        expect(bin(result), label).toBe(bin(expected));
      },
    );
  });

  describe('sign8', () => {
    // Interprétation complément à deux d'un octet brut : 0x00..0x7F → 0..127, 0x80..0xFF → -128..-1
    it.each([
      { cas: 'zéro', byte: 0x00, expected: 0 },
      { cas: 'petit positif', byte: 0x05, expected: 5 },
      { cas: 'plus grand positif (bit 7 à 0)', byte: 0x7f, expected: 127 },
      { cas: 'plus petit négatif (bit 7 seul)', byte: 0x80, expected: -128 },
      { cas: '-1 (tous bits levés)', byte: 0xff, expected: -1 },
      { cas: '-2 (le e8 de ADD SP,e8)', byte: 0xfe, expected: -2 },
    ].map((c) => ({ ...c, label: `sign8(${hex(c.byte, 2)})` })))(
      '$cas : $label → $expected',
      ({ byte, expected, label }) => {
        expect(sign8(byte), label).toBe(expected);
      },
    );

    it('conserve la valeur modulo 256 (même octet, autre représentant)', () => {
      for (const byte of [0x00, 0x01, 0x7f, 0x80, 0xc3, 0xff]) {
        const signed = sign8(byte);
        expect((signed + 0x100) % 0x100, `sign8(${hex(byte, 2)}) = ${signed}`).toBe(byte);
      }
    });
  });

  describe('buildU16', () => {
    it.each([
      { high: 0xab, low: 0xcd, expected: 0xabcd },
      { high: 0x00, low: 0xff, expected: 0x00ff },
      { high: 0xff, low: 0x00, expected: 0xff00 },
      { high: 0x00, low: 0x00, expected: 0x0000 },
    ].map((c) => ({ ...c, label: `buildU16(${hex(c.high, 2)}, ${hex(c.low, 2)})` })))(
      '$label assemble deux octets en un mot 16 bits',
      ({ high, low, expected, label }) => {
        const result = buildU16(high, low);
        expect(hex(result), label).toBe(hex(expected));
      },
    );
  });

  describe('U16to2U8', () => {
    it.each([
      { word: 0xabcd, high: 0xab, low: 0xcd },
      { word: 0xff00, high: 0xff, low: 0x00 },
      { word: 0x00ff, high: 0x00, low: 0xff },
    ].map((c) => ({ ...c, label: `U16to2U8(${hex(c.word)})` })))(
      '$label découpe un mot 16 bits en deux octets',
      ({ word, high, low, label }) => {
        const result = U16to2U8(word);
        expect(
          { high: hex(result.high, 2), low: hex(result.low, 2) },
          label,
        ).toEqual({ high: hex(high, 2), low: hex(low, 2) });
      },
    );

    it("est l'inverse de buildU16", () => {
      const word = buildU16(0x12, 0x34);
      const { high, low } = U16to2U8(word);
      const detail = `buildU16(0x12, 0x34) = ${hex(word)}, puis U16to2U8`;
      expect(hex(high, 2), detail).toBe(hex(0x12, 2));
      expect(hex(low, 2), detail).toBe(hex(0x34, 2));
    });
  });
});
