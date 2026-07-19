import { describe, it, expect } from 'vitest';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';

/**
 * LA GRANULARITÉ DE L'HORLOGE.
 *
 * Tout le reste de la suite mesure des TOTAUX en fin d'instruction. Si `totalCycles`
 * redevenait figé jusqu'au postStep — c'est-à-dire si on revenait au modèle par
 * instruction — pas un seul de ces tests ne tomberait.
 *
 * Ici on mesure autre chose : la DATE À LAQUELLE CHAQUE ACCÈS AU BUS A LIEU. C'est la
 * seule chose qui distingue les deux modèles, et c'est ce qui donne son sens au chantier :
 * un périphérique dérivé (DIV, LY) lu au 3e cycle d'une instruction doit voir la date du
 * 3e cycle, pas celle du début.
 *
 * Le mouchard s'intercale SOUS le port du CPU : il journalise `machine.totalCycles` juste
 * avant chaque lecture/écriture. Dans le modèle par instruction, toutes les dates d'une
 * même instruction seraient IDENTIQUES.
 */

const instructions = buildInstructions();

const buildFakeClock = () => ({ onTick() {}, start() {}, stop() {} });
const buildFakeSerial = () => ({ read: () => 0, write: () => {}, echo: () => {} });
const neutre = () => ({ read: () => 0, write: () => {}, check: () => {} });

/**
 * Rend la liste des dates (machine.totalCycles) auxquelles l'instruction a touché le bus.
 * Le programme est posé directement sur la mémoire nue : ni facturé, ni journalisé.
 */
const datesDesAcces = (program, at = 0xc000, setup = () => {}) => {
  const serial = buildFakeSerial();
  const raw = buildMemory(undefined, serial, neutre(), neutre(), neutre());
  program.forEach((b, i) => raw.write(at + i, b));

  const dates = [];
  let machine;
  const mouchard = {
    read(a) { dates.push(machine.totalCycles); return raw.read(a); },
    write(a, v) { dates.push(machine.totalCycles); return raw.write(a, v); },
  };

  const cpu = new CPU(mouchard);
  const Decoder = buildDecoder(cpu, instructions);
  const decoder = new Decoder();
  const Machine = buildMachine(mouchard, cpu, decoder, buildFakeClock(), serial);
  machine = new Machine();

  cpu.registers.PC.setValue(at);
  cpu.registers.SP.setValue(0xdff0);
  setup(cpu);

  decoder.step();
  return dates;
};

describe('Granularité : l\'horloge avance PENDANT l\'instruction', () => {
  describe('chaque accès au bus porte sa propre date', () => {
    it('LD A,[nn] (0xFA) : 4 accès à 4 dates distinctes, une par M-cycle', () => {
      // M1 opcode, M2 lsb, M3 msb, M4 la donnée : aucun cycle interne, donc 0,1,2,3.
      expect(datesDesAcces([0xfa, 0x00, 0xd0])).toEqual([0, 1, 2, 3]);
    });

    it('LD B,n8 (0x06) : 2 accès, 2 dates — la plus courte des preuves', () => {
      expect(datesDesAcces([0x06, 0x42])).toEqual([0, 1]);
    });

    it('la propriété qui distingue les deux modèles : les dates sont STRICTEMENT croissantes', () => {
      const dates = datesDesAcces([0xfa, 0x00, 0xd0]);
      // Dans le modèle par instruction, ce serait [0, 0, 0, 0].
      const croissantes = dates.every((d, i) => i === 0 || d > dates[i - 1]);
      expect(
        croissantes,
        `dates observées : [${dates}] — si elles sont toutes égales, totalCycles ne bouge plus qu'entre deux instructions`
      ).toBe(true);
    });
  });

  describe('les cycles internes laissent un TROU dans la suite des dates', () => {
    it('CALL nn (0xCD) : accès en 0,1,2 puis 4,5 — le 3 est le cycle interne (SP = SP-1)', () => {
      // gbctr p.123 : M1 opcode, M2 lsb, M3 msb, M4 interne, M5 write msb, M6 write lsb.
      // Le trou EST la preuve que l'interne est facturé au bon endroit, pas juste compté.
      expect(datesDesAcces([0xcd, 0x00, 0xc0])).toEqual([0, 1, 2, 4, 5]);
    });

    it('CALL NZ,nn (0xC4) pris : même trou en 3 que CALL nn — les deux partagent le défaut ou le correctif', () => {
      expect(
        datesDesAcces([0xc4, 0x00, 0xc0], 0xc000, (cpu) => (cpu.registers.F.Z = 0))
      ).toEqual([0, 1, 2, 4, 5]);
    });

    it('PUSH BC (0xC5) : accès en 0,2,3 — l\'interne (SP = SP-1) précède les deux écritures', () => {
      // gbctr p.42 : M1 opcode, M2 interne, M3 write msb, M4 write lsb.
      expect(datesDesAcces([0xc5])).toEqual([0, 2, 3]);
    });

    it('RST 0x00 (0xC7) : accès en 0,2,3 — même profil que PUSH, un CALL sans opérandes', () => {
      // gbctr p.129 : M1 opcode, M2 interne, M3 write msb, M4 write lsb.
      expect(datesDesAcces([0xc7])).toEqual([0, 2, 3]);
    });

    it('RET (0xC9) : accès en 0,1,2 — l\'interne est le DERNIER cycle, il ne laisse pas de trou', () => {
      // gbctr p.126 : M1 opcode, M2 et M3 les lectures pile, M4 interne (PC = WZ).
      // Miroir exact de CALL : même coût, ordre opposé.
      const dates = datesDesAcces([0xc9], 0xc000, (cpu) => {
        cpu.registers.SP.setValue(0xdfee);
      });
      expect(dates).toEqual([0, 1, 2]);
    });

    it('JP nn (0xC3) : accès en 0,1,2 — l\'interne du rechargement de PC ferme l\'instruction', () => {
      expect(datesDesAcces([0xc3, 0x00, 0xc0])).toEqual([0, 1, 2]);
    });

    it('INC BC (0x03) : un seul accès, le fetch — l\'interne suit et n\'accède à rien', () => {
      expect(datesDesAcces([0x03])).toEqual([0]);
    });
  });

  describe('l\'écart total : la dernière date reflète toute l\'instruction', () => {
    it('LD [nn],SP (0x08) : 5 accès, du cycle 0 au cycle 4, sans aucun trou', () => {
      // gbctr p.40 : M1 opcode, M2 lsb, M3 msb, M4 write SPL, M5 write SPH.
      expect(datesDesAcces([0x08, 0x00, 0xd0])).toEqual([0, 1, 2, 3, 4]);
    });
  });
});
