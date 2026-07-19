import { describe, it, expect } from 'vitest';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from './index';

const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

const instructions = buildInstructions();

// Un CPU avec un programme posé en WRAM (0xC000) et PC dessus — le ruban est prêt.
const makeCpu = (program, at = 0xc000) => {
  const cpu = new CPU(buildMemory());
  program.forEach((b, i) => cpu.memory.write(at + i, b));
  cpu.registers.PC.setValue(at);
  // Poser le programme passe par le port, qui FACTURE : la mise en place n'est pas
  // de la dépense d'instruction, on repart de zéro avant de mesurer.
  cpu.resetCycles();
  return cpu;
};

const makeDecoder = (cpu) => {
  const Decoder = buildDecoder(cpu, instructions);
  return new Decoder();
};

describe('Decoder : fetch-décode-exécute', () => {
  it('la factory rend la classe : new Decoder() expose fetch et step', () => {
    const cpu = makeCpu([0x00]);
    const Decoder = buildDecoder(cpu, instructions);
    const decoder = new Decoder();
    expect(typeof decoder.fetch, 'fetch doit être appelable').toBe('function');
    expect(typeof decoder.step, 'step doit être appelable').toBe('function');
  });

  describe('fetch : le curseur sur le ruban', () => {
    it("rend l'octet sous PC et avance PC de 1, à chaque appel", () => {
      const cpu = makeCpu([0x3e, 0x42]);
      const decoder = makeDecoder(cpu);
      expect(hex(decoder.fetch(), 2), 'premier octet').toBe('0x3E');
      expect(hex(cpu.registers.PC.getValue()), 'PC a avancé').toBe(hex(0xc001));
      expect(hex(decoder.fetch(), 2), 'second octet').toBe('0x42');
      expect(hex(cpu.registers.PC.getValue()), 'PC a encore avancé').toBe(hex(0xc002));
    });
  });

  describe('step : la traduction des symboles, espèce par espèce', () => {
    it('liste vide (NOP) : un octet consommé, rien d\'autre ne bouge', () => {
      const cpu = makeCpu([0x00]);
      makeDecoder(cpu).step();
      expect(hex(cpu.registers.PC.getValue()), 'PC = opcode seul').toBe(hex(0xc001));
    });

    it('registre encodé dans l\'opcode (0x80 = ADD A,B) : zéro octet consommé en plus', () => {
      const cpu = makeCpu([0x80]);
      cpu.registers.A.setValue(0x01);
      cpu.registers.B.setValue(0x02);
      makeDecoder(cpu).step();
      expect(hex(cpu.registers.A.getValue(), 2), 'A = A + B : le symbole "B" devient l\'objet registre').toBe('0x03');
      expect(hex(cpu.registers.PC.getValue()), 'un seul octet consommé').toBe(hex(0xc001));
    });

    it('immédiat n8 (0x3E = LD A,n8) : un octet consommé en plus', () => {
      const cpu = makeCpu([0x3e, 0x42]);
      makeDecoder(cpu).step();
      expect(hex(cpu.registers.A.getValue(), 2), 'A reçoit l\'octet du flux').toBe('0x42');
      expect(hex(cpu.registers.PC.getValue()), 'opcode + n8 = 2 octets').toBe(hex(0xc002));
    });

    it('immédiat e8 brut (0x18 0xFE = JR -2) : la boucle infinie de la doc', () => {
      const cpu = makeCpu([0x18, 0xfe]);
      makeDecoder(cpu).step();
      expect(
        hex(cpu.registers.PC.getValue()),
        'PC consommé (0xC002) + sign8(0xFE) = retour sur le JR : l\'octet passe BRUT, run applique sign8',
      ).toBe(hex(0xc000));
    });

    it('immédiat n16 (0xC3 0x50 0x01 = JP 0x0150) : deux octets, LITTLE-endian', () => {
      const cpu = makeCpu([0xc3, 0x50, 0x01]);
      makeDecoder(cpu).step();
      expect(
        hex(cpu.registers.PC.getValue()),
        'poids faible d\'abord : 0x50 puis 0x01 font 0x0150 — PAS 0x5001 !',
      ).toBe(hex(0x0150));
    });

    it('condition cc (0x20 = JR NZ,e8) : la chaîne "NZ" sort de la table, pas du flux', () => {
      const prise = makeCpu([0x20, 0x05]);
      prise.registers.F.setValue(0b0000_0000); // Z bas → NZ vraie
      makeDecoder(prise).step();
      expect(hex(prise.registers.PC.getValue()), 'branche prise : 0xC002 + 5').toBe(hex(0xc007));

      const pasPrise = makeCpu([0x20, 0x05]);
      pasPrise.registers.F.setValue(0b1000_0000); // Z levé → NZ fausse
      makeDecoder(pasPrise).step();
      expect(
        hex(pasPrise.registers.PC.getValue()),
        'branche non prise : les 2 octets sont consommés QUAND MÊME',
      ).toBe(hex(0xc002));
    });

    it('nombre passé tel quel (0xCB 0xC7 = SET 0,A) : le u3 vient de la table', () => {
      const cpu = makeCpu([0xcb, 0xc7]);
      cpu.registers.A.setValue(0x00);
      makeDecoder(cpu).step();
      expect(hex(cpu.registers.A.getValue(), 2), 'bit 0 allumé').toBe('0x01');
    });

    it('a8 brut (0xE0 = LDH [a8],A) : run traduit vers la page 0xFF00 lui-même', () => {
      const cpu = makeCpu([0xe0, 0x80]);
      cpu.registers.A.setValue(0x5a);
      makeDecoder(cpu).step();
      expect(hex(cpu.memory.read(0xff80), 2), 'A déposé en 0xFF00 + 0x80').toBe('0x5A');
    });
  });

  describe('la porte 0xCB : un octet de plus, une autre table', () => {
    it('0xCB 0x37 = SWAP A — surtout pas cb[0xCB] !', () => {
      const cpu = makeCpu([0xcb, 0x37]);
      cpu.registers.A.setValue(0xab);
      makeDecoder(cpu).step();
      expect(hex(cpu.registers.A.getValue(), 2), 'nibbles échangés').toBe('0xBA');
      expect(hex(cpu.registers.PC.getValue()), 'porte + opcode = 2 octets').toBe(hex(0xc002));
    });
  });

  describe('les opcodes illégaux : le décodeur refuse, il ne devine pas', () => {
    it('0xD3 lève une erreur (et ne part surtout pas dans la table CB)', () => {
      const cpu = makeCpu([0xd3]);
      const decoder = makeDecoder(cpu);
      expect(() => decoder.step(), '0xD3 est un trou : ni main, ni cb').toThrow();
    });
  });

  describe('la facture : step rend les cycles consommés', () => {
    it('NOP coûte 1', () => {
      const cpu = makeCpu([0x00]);
      expect(makeDecoder(cpu).step(), 'cycle de base').toBe(1);
    });

    it('JR cc : 3 si prise, 2 sinon — le supplément vient du compteur du cpu', () => {
      const prise = makeCpu([0x20, 0x05]);
      prise.registers.F.setValue(0b0000_0000);
      expect(makeDecoder(prise).step(), 'prise : 2 + 1 d\'extra').toBe(3);

      const pasPrise = makeCpu([0x20, 0x05]);
      pasPrise.registers.F.setValue(0b1000_0000);
      expect(makeDecoder(pasPrise).step(), 'non prise : le cycle de base seul').toBe(2);
    });

    it('CALL cc pris coûte 6, non pris 3', () => {
      const prise = makeCpu([0xc4, 0x34, 0x12]); // CALL NZ, 0x1234
      prise.registers.SP.setValue(0xfffe);
      prise.registers.F.setValue(0b0000_0000);
      expect(makeDecoder(prise).step(), 'prise : 3 + 3 d\'extra').toBe(6);

      const pasPrise = makeCpu([0xc4, 0x34, 0x12]);
      pasPrise.registers.SP.setValue(0xfffe);
      pasPrise.registers.F.setValue(0b1000_0000);
      expect(makeDecoder(pasPrise).step(), 'non prise').toBe(3);
    });

    it('RST 0x00 (0xC7) coûte 4 — la valeur de la doc, pas celle de la table !', () => {
      const cpu = makeCpu([0xc7]);
      cpu.registers.SP.setValue(0xfffe);
      const cycles = makeDecoder(cpu).step();
      expect(hex(cpu.registers.PC.getValue()), 'PC = vecteur 0x0000').toBe(hex(0x0000));
      expect(cycles, 'RST = 4 cycles (16 t-states)').toBe(4);
    });

    it('le supplément ne FUIT jamais : après une branche prise, le step suivant est net', () => {
      // JR NZ,+0 (prise, atterrit sur l'octet suivant) puis NOP
      const cpu = makeCpu([0x20, 0x00, 0x00]);
      cpu.registers.F.setValue(0b0000_0000);
      const decoder = makeDecoder(cpu);
      expect(decoder.step(), 'la branche prise : 3').toBe(3);
      expect(
        decoder.step(),
        'le NOP suivant : 1 — si tu lis 1+extra ici, le compteur n\'a pas été VIDÉ par la consommation',
      ).toBe(1);
      expect(cpu.cycles, 'cpu.cycles remis à zéro entre deux instructions (resetCycles)').toBe(0);
    });
  });

  describe('intégration : trois instructions déroulées au fil du ruban', () => {
    it('LD A,0x2A ; LD B,A ; INC B — le curseur avance seul, les valeurs circulent', () => {
      const cpu = makeCpu([0x3e, 0x2a, 0x47, 0x04]);
      const decoder = makeDecoder(cpu);
      decoder.step();
      decoder.step();
      decoder.step();
      expect(hex(cpu.registers.A.getValue(), 2), 'A chargé').toBe('0x2A');
      expect(hex(cpu.registers.B.getValue(), 2), 'B = A + 1 : LD B,A puis INC B').toBe('0x2B');
      expect(hex(cpu.registers.PC.getValue()), '2 + 1 + 1 octets consommés').toBe(hex(0xc004));
    });
  });
});
