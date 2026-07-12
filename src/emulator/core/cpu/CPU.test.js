import { describe, it, expect } from 'vitest';

import CPU from './CPU';
import buildMemory from './CPUMemory';

const Memory = buildMemory();

// Formatage lisible pour le debug : binaire et hexa plutôt que décimal
const bin = (n, width = 8) => '0b' + (n >>> 0).toString(2).padStart(width, '0');
const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

const dumpFlags = (F) =>
  `F = ${bin(F.getValue())} (` +
  ['Z', 'N', 'H', 'C'].map((k) => `${k}=${F[k] ? 1 : 0}`).join(' ') +
  ')';

// operation = contexte d'une instruction arithmétique :
//   id   : 0 = addition, 1 = soustraction (au sens du flag N de la GB)
//   a, b : opérandes lues dans les registres (non signées)
//   raw  : résultat JS brut, calculé AVANT rangement dans un registre
// carry (ADC/SBC) n'est PAS un champ de operation : il voyage en argument séparé
// des updaters — mais il participe au raw, donc le builder le prend en compte.
const op = (id, a, b, size, carry = 0) =>
  ({ id, a, b, raw: id ? a - b - carry : a + b + carry, size });
const opLabel = ({ id, a, b, raw, size }) =>
  `{ id: ${id}, a: ${hex(a, size / 4)}, b: ${hex(b, size / 4)}, raw: ${raw}, size: ${size} }`;

describe('CPU', () => {
  describe('liste des registres', () => {
    it.each([['A'], ['F'], ['B'], ['C'], ['D'], ['E'], ['H'], ['L']])(
      'expose le registre 8 bits %s',
      (name) => {
        const cpu = new CPU();
        const reg = cpu.registers[name];
        expect(reg, `cpu.registers.${name} n'existe pas`).toBeDefined();
        reg.setValue(0x40);
        expect(hex(reg.getValue(), 2), `${name}.setValue(0x40) puis getValue()`).toBe('0x40');
      },
    );

    it.each([['SP'], ['PC']])('expose le registre 16 bits fonctionnel %s', (name) => {
      const cpu = new CPU();
      const reg = cpu.registers[name];
      expect(reg, `cpu.registers.${name} n'existe pas`).toBeDefined();
      reg.setValue(0xabcd);
      expect(hex(reg.getValue()), `${name}.setValue(0xABCD) puis getValue()`).toBe('0xABCD');
      reg.setValue(0x1ffff);
      expect(hex(reg.getValue()), `${name}.setValue(0x1FFFF) doit déborder sur 16 bits`).toBe('0xFFFF');
    });

    it.each([['AF'], ['BC'], ['DE'], ['HL']])("expose l'union %s", (name) => {
      const cpu = new CPU();
      expect(cpu.registers[name], `cpu.registers.${name} n'existe pas`).toBeDefined();
    });
  });

  describe('unions (registres couplés)', () => {
    const pairs = [
      { pair: 'BC', high: 'B', low: 'C' },
      { pair: 'DE', high: 'D', low: 'E' },
      { pair: 'HL', high: 'H', low: 'L' },
    ];

    it.each(pairs)(
      'écrire $pair se reporte sur $high (octet haut) et $low (octet bas)',
      ({ pair, high, low }) => {
        const cpu = new CPU();
        cpu.registers[pair].setValue(0xabcd);
        expect(hex(cpu.registers[high].getValue(), 2), `${pair}.setValue(0xABCD) → ${high}`).toBe('0xAB');
        expect(hex(cpu.registers[low].getValue(), 2), `${pair}.setValue(0xABCD) → ${low}`).toBe('0xCD');
      },
    );

    it.each(pairs)(
      'écrire $high et $low se reporte sur $pair',
      ({ pair, high, low }) => {
        const cpu = new CPU();
        cpu.registers[high].setValue(0x12);
        cpu.registers[low].setValue(0x34);
        expect(hex(cpu.registers[pair].getValue()), `${high}=0x12, ${low}=0x34 → ${pair}`).toBe('0x1234');
      },
    );
  });

  describe('cas spécial F : flags synchronisés avec AF', () => {
    it("AF.setValue(0xNNXX) reporte l'octet bas XX sur les flags de F", () => {
      const cpu = new CPU();
      cpu.registers.AF.setValue(0x12b0); // octet bas 0xB0 = 0b1011_0000 → Z=1 N=0 H=1 C=1
      const F = cpu.registers.F;
      expect(!!F.Z, `après AF.setValue(0x12B0), ${dumpFlags(F)}`).toBe(true);
      expect(!!F.N, `après AF.setValue(0x12B0), ${dumpFlags(F)}`).toBe(false);
      expect(!!F.H, `après AF.setValue(0x12B0), ${dumpFlags(F)}`).toBe(true);
      expect(!!F.C, `après AF.setValue(0x12B0), ${dumpFlags(F)}`).toBe(true);
      expect(hex(cpu.registers.A.getValue(), 2), 'AF.setValue(0x12B0) → A').toBe('0x12');
    });

    it('écrire un flag se reporte sur la valeur de F et de AF', () => {
      const cpu = new CPU();
      cpu.registers.AF.setValue(0x0000);
      cpu.registers.F.Z = 1;
      cpu.registers.F.C = 1;
      expect(bin(cpu.registers.F.getValue()), `Z=1 puis C=1 : ${dumpFlags(cpu.registers.F)}`).toBe(bin(0b1001_0000));
      expect(hex(cpu.registers.AF.getValue()), 'Z=1 puis C=1 → AF').toBe(hex(0x0090));
    });

    it('F.setValue met à jour les flags et AF', () => {
      const cpu = new CPU();
      cpu.registers.A.setValue(0xff);
      cpu.registers.F.setValue(0b1000_0000); // Z seul
      expect(!!cpu.registers.F.Z, dumpFlags(cpu.registers.F)).toBe(true);
      expect(!!cpu.registers.F.N, dumpFlags(cpu.registers.F)).toBe(false);
      expect(!!cpu.registers.F.C, dumpFlags(cpu.registers.F)).toBe(false);
      expect(hex(cpu.registers.AF.getValue()), 'A=0xFF, F=0b1000_0000 → AF').toBe(hex(0xff80));
    });
  });

  describe('updateCarryFlag(operation)', () => {
    it.each([
      { cas: 'addition 8 bits qui déborde', operation: op(0, 0xff, 0x02, 8), expected: 1 },
      { cas: 'addition 8 bits à la borne exacte', operation: op(0, 0xfe, 0x01, 8), expected: 0 },
      { cas: 'addition 8 bits sans débordement', operation: op(0, 0x0f, 0x01, 8), expected: 0 },
      { cas: 'soustraction 8 bits qui emprunte (5 - 7)', operation: op(1, 5, 7, 8), expected: 1 },
      { cas: "soustraction 8 bits sans emprunt (7 - 5)", operation: op(1, 7, 5, 8), expected: 0 },
      { cas: 'soustraction 8 bits qui tombe pile à zéro', operation: op(1, 7, 7, 8), expected: 0 },
      { cas: 'addition 16 bits qui déborde', operation: op(0, 0xffff, 0x0001, 16), expected: 1 },
      { cas: 'addition 16 bits à la borne exacte', operation: op(0, 0xfffe, 0x0001, 16), expected: 0 },
      { cas: 'raw 0x100 : débordement en 8 bits…', operation: op(0, 0xff, 0x01, 8), expected: 1 },
      { cas: '…mais pas en 16 bits', operation: op(0, 0xff, 0x01, 16), expected: 0 },
      { cas: 'soustraction 16 bits qui emprunte', operation: op(1, 0x0001, 0x0002, 16), expected: 1 },
      // ADC : la retenue entrante est déjà dans raw, updateCarryFlag n'a pas besoin d'elle
      { cas: 'ADC, la retenue entrante provoque elle-même le débordement (0xFF+0x00+1)', operation: op(0, 0xff, 0x00, 8, 1), expected: 1 },
    ].map((c) => ({ ...c, label: `updateCarryFlag(${opLabel(c.operation)})` })))(
      '$cas : $label → C=$expected',
      ({ operation, expected, label }) => {
        const cpu = new CPU();
        cpu.updateCarryFlag(operation);
        expect(+!!cpu.registers.F.C, `${label} : ${dumpFlags(cpu.registers.F)}`).toBe(expected);
      },
    );

    it('remet C à 0 si le résultat ne déborde pas (pas seulement le mettre à 1)', () => {
      const cpu = new CPU();
      cpu.registers.F.C = 1;
      cpu.updateCarryFlag(op(0, 0x0f, 0x01, 8));
      expect(+!!cpu.registers.F.C, `C était à 1, addition sans débordement : ${dumpFlags(cpu.registers.F)}`).toBe(0);
    });

    it('ne touche pas aux autres flags (Z, N, H)', () => {
      const cpu = new CPU();
      cpu.registers.F.setValue(0b1110_0000); // Z=1 N=1 H=1 C=0
      cpu.updateCarryFlag(op(0, 0xff, 0x02, 8)); // doit poser C=1 sans toucher au reste
      expect(bin(cpu.registers.F.getValue()), dumpFlags(cpu.registers.F)).toBe(bin(0b1111_0000));
      cpu.updateCarryFlag(op(0, 0x0f, 0x01, 8)); // doit remettre C=0 sans toucher au reste
      expect(bin(cpu.registers.F.getValue()), dumpFlags(cpu.registers.F)).toBe(bin(0b1110_0000));
    });
  });

  describe('updateNAndHFlags(operation)', () => {
    it.each([
      // additions 8 bits : H = retenue entre bits 3 et 4 (nibbles bas : a&0xF + b&0xF > 0xF)
      { cas: 'addition, les nibbles bas débordent (0x8+0x9=17)', operation: op(0, 0x28, 0x19, 8), H: 1 },
      { cas: 'addition, même raw (0x41) mais nibbles sages (0x0+0x1)', operation: op(0, 0x40, 0x01, 8), H: 0 },
      { cas: 'addition, borne exacte des nibbles (0xE+0x1=15)', operation: op(0, 0x0e, 0x01, 8), H: 0 },
      { cas: 'addition, juste au-dessus de la borne (0xF+0x1=16)', operation: op(0, 0x0f, 0x01, 8), H: 1 },
      // soustractions 8 bits : H = emprunt du nibble bas (a&0xF - b&0xF < 0)
      { cas: 'soustraction, le nibble bas emprunte (0x0-0x1)', operation: op(1, 0x10, 0x01, 8), H: 1 },
      { cas: "soustraction, pas d'emprunt (0x9-0x5)", operation: op(1, 0x19, 0x05, 8), H: 0 },
      { cas: 'soustraction, nibbles pile à zéro (0x5-0x5)', operation: op(1, 0x15, 0x05, 8), H: 0 },
      // 16 bits : la frontière est entre bits 11 et 12 (masque 0xFFF)
      { cas: 'addition 16 bits, retenue du bit 11 (0xFFF+0x1)', operation: op(0, 0x0fff, 0x0001, 16), H: 1 },
      { cas: 'addition 16 bits, pas de retenue du bit 11 (0x800+0x700)', operation: op(0, 0x0800, 0x0700, 16), H: 0 },
      { cas: '0xF+0x1 lève H en 8 bits mais pas en 16 (la frontière a bougé)', operation: op(0, 0x0f, 0x01, 16), H: 0 },
    ].map((c) => ({ ...c, label: `updateNAndHFlags(${opLabel(c.operation)})` })))(
      '$cas : $label → H=$H',
      ({ operation, H, label }) => {
        const cpu = new CPU();
        cpu.updateNAndHFlags(operation);
        expect(+!!cpu.registers.F.H, `${label} : ${dumpFlags(cpu.registers.F)}`).toBe(H);
        expect(+!!cpu.registers.F.N, `${label} : N doit recopier id — ${dumpFlags(cpu.registers.F)}`).toBe(operation.id);
      },
    );

    it('remet N et H à 0 si besoin (pas seulement les lever)', () => {
      const cpu = new CPU();
      cpu.registers.F.N = 1;
      cpu.registers.F.H = 1;
      cpu.updateNAndHFlags(op(0, 0x40, 0x01, 8)); // addition sans retenue de nibble
      expect(
        +!!cpu.registers.F.N,
        `N était à 1, addition : ${dumpFlags(cpu.registers.F)}`,
      ).toBe(0);
      expect(
        +!!cpu.registers.F.H,
        `H était à 1, pas de retenue de nibble : ${dumpFlags(cpu.registers.F)}`,
      ).toBe(0);
    });

    it('ne touche pas aux autres flags (Z, C)', () => {
      const cpu = new CPU();
      cpu.registers.F.setValue(0b1001_0000); // Z=1 C=1
      cpu.updateNAndHFlags(op(0, 0x0f, 0x01, 8)); // → N=0 H=1
      expect(bin(cpu.registers.F.getValue()), dumpFlags(cpu.registers.F)).toBe(bin(0b1011_0000));
      cpu.updateNAndHFlags(op(1, 0x19, 0x05, 8)); // → N=1 H=0
      expect(bin(cpu.registers.F.getValue()), dumpFlags(cpu.registers.F)).toBe(bin(0b1101_0000));
    });

    describe('avec retenue entrante (ADC/SBC) : updateNAndHFlags(operation, carry)', () => {
      it.each([
        // la mini-somme des nibbles a TROIS termes : (a & m) + (b & m) + carry
        { cas: 'ADC, la retenue fait déborder le nibble (0+15+1=16)', operation: op(0, 0x10, 0x0f, 8, 1), carry: 1, H: 1 },
        { cas: 'ADC, charnière poussée par la retenue (14+1+1=16)', operation: op(0, 0x0e, 0x01, 8, 1), carry: 1, H: 1 },
        { cas: 'ADC, loin de la borne la retenue ne fabrique rien (0+1+1=2)', operation: op(0, 0x40, 0x01, 8, 1), carry: 1, H: 0 },
        { cas: 'ADC, carry=0 explicite = comportement ADD (14+1+0=15)', operation: op(0, 0x0e, 0x01, 8), carry: 0, H: 0 },
        // en soustraction : emprunt si (a & m) < (b & m) + carry
        { cas: "SBC, l'emprunt entrant force l'emprunt du nibble (5 < 5+1)", operation: op(1, 0x15, 0x05, 8, 1), carry: 1, H: 1 },
        { cas: "SBC, pas d'emprunt malgré la retenue (9 < 5+1 ? non)", operation: op(1, 0x19, 0x05, 8, 1), carry: 1, H: 0 },
      ].map((c) => ({ ...c, label: `updateNAndHFlags(${opLabel(c.operation)}, ${c.carry})` })))(
        '$cas : $label → H=$H',
        ({ operation, carry, H, label }) => {
          const cpu = new CPU();
          cpu.updateNAndHFlags(operation, carry);
          expect(+!!cpu.registers.F.H, `${label} : ${dumpFlags(cpu.registers.F)}`).toBe(H);
          expect(+!!cpu.registers.F.N, `${label} : N doit recopier id — ${dumpFlags(cpu.registers.F)}`).toBe(operation.id);
        },
      );

      it("sans argument carry, le défaut vaut 0 : comportement ADD/SUB inchangé", () => {
        const cpu = new CPU();
        cpu.updateNAndHFlags(op(0, 0x0e, 0x01, 8)); // 14+1=15, pile la borne, sans retenue
        expect(+!!cpu.registers.F.H, `14+1=15 sans retenue : ${dumpFlags(cpu.registers.F)}`).toBe(0);
      });
    });
  });

  describe('updateZeroFlag(value)', () => {
    // Contrat : value est la valeur DÉJÀ wrappée (celle qui atterrit dans le registre),
    // pas le raw — c'est à l'appelant de masquer avant d'appeler.
    it.each([
      { cas: 'zéro', value: 0, expected: 1 },
      { cas: 'non nul', value: 0x01, expected: 0 },
      { cas: 'non nul (max 8 bits)', value: 0xff, expected: 0 },
    ].map((c) => ({ ...c, label: `updateZeroFlag(${hex(c.value, 2)})` })))(
      '$cas : $label → Z=$expected',
      ({ value, expected, label }) => {
        const cpu = new CPU();
        cpu.updateZeroFlag(value);
        expect(+!!cpu.registers.F.Z, `${label} : ${dumpFlags(cpu.registers.F)}`).toBe(expected);
      },
    );

    it("cas hardware : 0xFF + 0x01 wrappe à 0x00, donc Z=1 (l'appelant masque le raw)", () => {
      const cpu = new CPU();
      const raw = 0xff + 0x01; // 0x100
      cpu.updateZeroFlag(raw & 0xff); // le contrat : on passe la valeur wrappée
      expect(+!!cpu.registers.F.Z, `raw=0x100, wrappé=0x00 : ${dumpFlags(cpu.registers.F)}`).toBe(1);
    });

    it('remet Z à 0 si la valeur est non nulle (pas seulement le lever)', () => {
      const cpu = new CPU();
      cpu.registers.F.Z = 1;
      cpu.updateZeroFlag(0x42);
      expect(+!!cpu.registers.F.Z, `Z était à 1, updateZeroFlag(0x42) : ${dumpFlags(cpu.registers.F)}`).toBe(0);
    });

    it('ne touche pas aux autres flags (N, H, C)', () => {
      const cpu = new CPU();
      cpu.registers.F.setValue(0b0111_0000); // N=1 H=1 C=1
      cpu.updateZeroFlag(0); // doit poser Z=1 sans toucher au reste
      expect(bin(cpu.registers.F.getValue()), dumpFlags(cpu.registers.F)).toBe(bin(0b1111_0000));
      cpu.updateZeroFlag(0x42); // doit remettre Z=0 sans toucher au reste
      expect(bin(cpu.registers.F.getValue()), dumpFlags(cpu.registers.F)).toBe(bin(0b0111_0000));
    });
  });

  describe('cpu.stack : push(reg16) / pop() → valeur 16 bits', () => {
    const makeCpu = (sp) => {
      const cpu = new CPU(new Memory());
      cpu.registers.SP.setValue(sp);
      return cpu;
    };

    it('expose stack.push et stack.pop', () => {
      const cpu = makeCpu(0xfffe);
      expect(cpu.stack, 'cpu.stack est absent').toBeDefined();
      expect(typeof cpu.stack.push, 'stack.push doit être appelable').toBe('function');
      expect(typeof cpu.stack.pop, 'stack.pop doit être appelable').toBe('function');
    });

    it('push : écrit high à SP-1, low à SP-2, et SP descend de 2 (la pile pousse vers le bas)', () => {
      const cpu = makeCpu(0xfffe);
      cpu.registers.BC.setValue(0x1234);
      cpu.stack.push(cpu.registers.BC);
      expect(hex(cpu.registers.SP.getValue()), 'SP après push').toBe(hex(0xfffc));
      expect(hex(cpu.memory.read(0xfffd), 2), 'octet HAUT à SP-1 (0xFFFD)').toBe('0x12');
      expect(hex(cpu.memory.read(0xfffc), 2), 'octet BAS à SP-2 (0xFFFC) — little-endian').toBe('0x34');
      expect(hex(cpu.registers.BC.getValue()), 'le registre poussé ne doit pas bouger').toBe(hex(0x1234));
    });

    it('pop : lit low à SP puis high à SP+1, rend la valeur, et SP remonte de 2', () => {
      const cpu = makeCpu(0xfffc);
      cpu.memory.write(0xfffc, 0x34); // low
      cpu.memory.write(0xfffd, 0x12); // high
      const value = cpu.stack.pop();
      expect(hex(value), 'pop doit reconstituer high|low').toBe(hex(0x1234));
      expect(hex(cpu.registers.SP.getValue()), 'SP après pop').toBe(hex(0xfffe));
    });

    it('aller-retour : pop rend ce que push a empilé, SP revient à sa valeur initiale', () => {
      const cpu = makeCpu(0xfffe);
      cpu.registers.DE.setValue(0xbeef);
      cpu.stack.push(cpu.registers.DE);
      expect(hex(cpu.stack.pop()), 'push puis pop').toBe(hex(0xbeef));
      expect(hex(cpu.registers.SP.getValue()), 'SP restauré').toBe(hex(0xfffe));
    });

    it('LIFO : deux push, les pop ressortent dans l\'ordre inverse', () => {
      const cpu = makeCpu(0xfffe);
      cpu.registers.BC.setValue(0x1111);
      cpu.registers.DE.setValue(0x2222);
      cpu.stack.push(cpu.registers.BC);
      cpu.stack.push(cpu.registers.DE);
      expect(hex(cpu.stack.pop()), 'premier pop = dernier push').toBe(hex(0x2222));
      expect(hex(cpu.stack.pop()), 'second pop = premier push').toBe(hex(0x1111));
      expect(hex(cpu.registers.SP.getValue()), 'SP restauré après le compte rond').toBe(hex(0xfffe));
    });

    it('SP wrappe aux bornes du tableau (aucun garde-fou, comme le vrai hardware)', () => {
      const cpu = makeCpu(0x0001);
      cpu.registers.BC.setValue(0xabcd);
      cpu.stack.push(cpu.registers.BC); // high → 0x0000, low → 0xFFFF (wrap)
      expect(hex(cpu.registers.SP.getValue()), 'SP a wrappé').toBe(hex(0xffff));
      expect(hex(cpu.memory.read(0x0000), 2), 'octet haut à 0x0000').toBe('0xAB');
      expect(hex(cpu.memory.read(0xffff), 2), 'octet bas à 0xFFFF').toBe('0xCD');
      expect(hex(cpu.stack.pop()), 'l\'aller-retour survit au wrap').toBe(hex(0xabcd));
      expect(hex(cpu.registers.SP.getValue()), 'SP revenu à 0x0001').toBe(hex(0x0001));
    });

    it('ne touche pas aux flags', () => {
      const cpu = makeCpu(0xfffe);
      cpu.registers.F.setValue(0b1111_0000); // Z N H C tous levés
      cpu.registers.BC.setValue(0x1234);
      cpu.stack.push(cpu.registers.BC);
      cpu.stack.pop();
      expect(bin(cpu.registers.F.getValue()), dumpFlags(cpu.registers.F)).toBe(bin(0b1111_0000));
    });
  });

  describe('cycles : la propriété nue où les branches prises déposent leur supplément', () => {
    // Contrat : les instructions font cpu.cycles += this.extraCycle en direct
    // (pas de méthode d'ajout). Le décodeur lit la propriété puis appelle
    // resetCycles() — la seule interface — pour repartir à zéro.
    it('démarre à zéro (sinon le premier += donnerait NaN)', () => {
      const cpu = new CPU();
      expect(cpu.cycles, 'initialisé dans le constructeur').toBe(0);
    });

    it("c'est une propriété nue : += accumule directement", () => {
      const cpu = new CPU();
      cpu.cycles += 3;
      cpu.cycles += 1;
      expect(cpu.cycles, "3 + 1 : l'accumulation, pas l'écrasement").toBe(4);
    });

    it('resetCycles() remet à zéro', () => {
      const cpu = new CPU();
      cpu.cycles += 3;
      cpu.resetCycles();
      expect(cpu.cycles, 'vidé pour l\'instruction suivante').toBe(0);
    });
  });
});
