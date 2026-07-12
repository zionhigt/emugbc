import { describe, it, expect } from 'vitest';

import opcodes from './opcodes';
import buildInstructions from './instructions';

const hex = (n, w = 2) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');

const instructions = buildInstructions();
const { main, cb } = opcodes;

const ILLEGAL = [0xd3, 0xdb, 0xdd, 0xe3, 0xe4, 0xeb, 0xec, 0xed, 0xf4, 0xfc, 0xfd];

const REGISTERS = ['B', 'C', 'D', 'E', 'H', 'L', 'A', 'BC', 'DE', 'HL'];
const IMMEDIATES = ['n8', 'a8', 'e8', 'n16'];
const CCS = ['cc:Z', 'cc:NZ', 'cc:C', 'cc:NC'];

describe('opcodes : la table déclarative qui relie les octets aux instructions', () => {
  it('les comptes sont exacts : 244 opcodes principaux + 256 CB (+ la porte 0xCB) = 501', () => {
    expect(Object.keys(main).length, 'table principale').toBe(244);
    expect(Object.keys(cb).length, 'table CB, complète sans trou').toBe(256);
  });

  it('les 11 opcodes illégaux sont absents, et 0xCB est réservé à la porte', () => {
    for (const op of ILLEGAL) {
      expect(main[op], `${hex(op)} est illégal : aucune entrée ne doit exister`).toBeUndefined();
    }
    expect(main[0xcb], "0xCB n'est pas une instruction, c'est la porte").toBeUndefined();
  });

  it('chaque id pointé existe dans la table d’instructions', () => {
    for (const [table, name] of [[main, 'main'], [cb, 'cb']]) {
      for (const [op, [id]] of Object.entries(table)) {
        expect(
          instructions[id],
          `${name}[${hex(+op)}] pointe "${id}", introuvable dans instructions`,
        ).toBeDefined();
      }
    }
  });

  it('chaque opérande appartient au vocabulaire convenu', () => {
    for (const [table, name] of [[main, 'main'], [cb, 'cb']]) {
      for (const [op, [id, ...operands]] of Object.entries(table)) {
        for (const symbol of operands) {
          const ok =
            typeof symbol === 'number' ||
            REGISTERS.includes(symbol) ||
            IMMEDIATES.includes(symbol) ||
            CCS.includes(symbol);
          expect(ok, `${name}[${hex(+op)}] ${id} : symbole inconnu "${symbol}"`).toBe(true);
        }
      }
    }
  });

  it('les octets à consommer collent au champ bytes de chaque instruction', () => {
    // n16 = 2 octets ; n8/a8/e8 = 1 octet ; le reste ne consomme rien.
    // bytes compte l'opcode (et le préfixe 0xCB pour la table cb).
    const width = (s) => (s === 'n16' ? 2 : IMMEDIATES.includes(s) ? 1 : 0);
    for (const [table, name, opcodeBytes] of [[main, 'main', 1], [cb, 'cb', 2]]) {
      for (const [op, [id, ...operands]] of Object.entries(table)) {
        const fetched = operands.reduce((n, s) => n + width(s), 0);
        expect(
          fetched + opcodeBytes,
          `${name}[${hex(+op)}] ${id} : la table consomme ${fetched} octet(s) d'opérande, ` +
            `mais instructions.${id}.bytes = ${instructions[id].bytes}`,
        ).toBe(instructions[id].bytes);
      }
    }
  });

  describe('sondages ponctuels — les cases pièges de la carte', () => {
    it('0x76 est HALT, pas LD [HL],[HL]', () => {
      expect(main[0x76]).toEqual(['HALT']);
    });

    it('le bloc LD est complet : 49 LD_r8_r8, 7 LD_r8_HL, 7 LD_HL_r8', () => {
      const count = (id) => Object.values(main).filter(([i]) => i === id).length;
      expect(count('LD_r8_r8')).toBe(49);
      expect(count('LD_r8_HL')).toBe(7);
      expect(count('LD_HL_r8')).toBe(7);
    });

    it("l'entrée du point d'entrée : 0xC3 = JP n16", () => {
      expect(main[0xc3]).toEqual(['JP_n16', 'n16']);
    });

    it('0x80 = ADD A,B et 0x8F = ADC A,A : le motif de colonne', () => {
      expect(main[0x80]).toEqual(['ADD_A_r8', 'B']);
      expect(main[0x8f]).toEqual(['ADC_A_r8', 'A']);
    });

    it('cb[0x37] = SWAP A, cb[0x7e] = BIT 7,[HL], cb[0xff] = SET 7,A', () => {
      expect(cb[0x37]).toEqual(['SWAP_r8', 'A']);
      expect(cb[0x7e]).toEqual(['BIT_u3_HL', 7]);
      expect(cb[0xff]).toEqual(['SET_u3_r8', 7, 'A']);
    });

    it('les 8 RST couvrent leurs vecteurs de 0x00 à 0x38', () => {
      const vecs = Object.values(main)
        .filter(([id]) => id === 'RST_vec')
        .map(([, vec]) => vec)
        .sort((a, b) => a - b);
      expect(vecs).toEqual([0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38]);
    });
  });
});
