import { describe, it, expect } from 'vitest';

import CPU from '../cpu/CPU';
import buildInstructions from '../cpu/instructions';
import buildMemory from '../memory';
import buildDecoder from '../decodeur';
import buildMachine from './index';
import { DMG, CGB, AUTO } from '../models';

/**
 * LE MODÈLE DE CONSOLE — lot 1.
 *
 * Le boîtier décide, la cartouche renseigne. Une cartouche marquée « compatible
 * CGB » glissée dans une DMG tourne en DMG : c'est pour ça que la préférence a
 * TROIS valeurs et pas deux, et que 'auto' est la seule qui consulte l'en-tête.
 *
 * Ce n'est pas de la théorie : onze des ROMs blargg présentes dans les fixtures
 * portent 0x143 = 0x80, et toutes les ROMs mooneye portent 0x00 alors que
 * certaines ne passent QUE sur CGB. Les deux cas se croisent ici.
 */

const instructions = buildInstructions();

const buildManivelle = () => ({ onTick() {}, start() {}, stop() {} });

const makeMachine = (preference) => {
  const serial = { read() {}, write() {}, echo() {} };
  const memory = buildMemory(undefined, serial);
  const cpu = new CPU(memory);
  const Decoder = buildDecoder(cpu, instructions);
  const Machine = buildMachine(memory, cpu, new Decoder(), buildManivelle(), serial);
  return { machine: preference === undefined ? new Machine() : new Machine(preference), cpu };
};

// Une fausse cartouche : le modèle ne lit que l'en-tête, pas la ROM.
const fakeCartridge = (supportsCgb) => ({
  header: { supportsCgb },
  mbc: null,
  read: () => 0,
  write: () => {},
});

describe('le modèle de console', () => {
  describe('avant toute cartouche', () => {
    it('la préférence est connue, le modèle ne l\'est pas encore', () => {
      const { machine } = makeMachine(AUTO);
      expect(machine.modelPreference).toBe(AUTO);
      expect(machine.model, 'en auto, c\'est la cartouche qui tranchera').toBe(null);
    });

    it('DMG par défaut : tant qu\'il n\'y a pas de PPU CGB, rien à gagner à basculer', () => {
      expect(makeMachine().machine.modelPreference).toBe(DMG);
    });

    it('une préférence inconnue échoue à la construction', () => {
      expect(() => makeMachine('sgb')).toThrow(/modèle inconnu/);
    });
  });

  describe('résolution à l\'insertion', () => {
    it('auto suit la cartouche', () => {
      const { machine } = makeMachine(AUTO);
      expect(machine.resolveModel(fakeCartridge(true))).toBe(CGB);
      expect(machine.resolveModel(fakeCartridge(false))).toBe(DMG);
    });

    it('une préférence explicite l\'emporte, dans les DEUX sens', () => {
      // Le sens qui compte le plus est le second : forcer CGB avec une cartouche
      // qui ne se déclare pas. C'est le cas de toutes les ROMs mooneye, donc la
      // condition pour faire tourner l'oracle du lot.
      expect(makeMachine(DMG).machine.resolveModel(fakeCartridge(true))).toBe(DMG);
      expect(makeMachine(CGB).machine.resolveModel(fakeCartridge(false))).toBe(CGB);
    });

    it('plugCartridge fige le modèle', () => {
      const { machine } = makeMachine(AUTO);
      machine.plugCartridge(fakeCartridge(true));
      expect(machine.model).toBe(CGB);
    });
  });

  describe('postBoot : les registres que la ROM de démarrage aurait laissés', () => {
    // Valeurs relevées dans les SOURCES des oracles mooneye (boot_regs-dmgABC.s
    // et boot_regs-cgb.s), pas dans pandocs — qui donne d'autres valeurs CGB,
    // celles d'une CGB faisant tourner une cartouche monochrome.
    const registres = (model) => {
      const { cpu } = makeMachine();
      cpu.postBoot(model);
      const r = cpu.registers;
      return {
        AF: r.AF.getValue(), BC: r.BC.getValue(),
        DE: r.DE.getValue(), HL: r.HL.getValue(),
        SP: r.SP.getValue(), PC: r.PC.getValue(),
      };
    };

    it('DMG : A=0x01 F=0xB0 BC=0x0013 DE=0x00D8 HL=0x014D', () => {
      expect(registres(DMG)).toEqual({
        AF: 0x01b0, BC: 0x0013, DE: 0x00d8, HL: 0x014d, SP: 0xfffe, PC: 0x0100,
      });
    });

    it('CGB : A=0x11 F=0x80 BC=0x0000 DE=0x0008 HL=0x007C', () => {
      expect(registres(CGB)).toEqual({
        AF: 0x1180, BC: 0x0000, DE: 0x0008, HL: 0x007c, SP: 0xfffe, PC: 0x0100,
      });
    });

    it('les deux modèles diffèrent réellement', () => {
      // Le garde-fou contre un postBoot qui ignorerait son argument : sans lui,
      // les deux tests ci-dessus pourraient passer avec une seule table.
      expect(registres(DMG)).not.toEqual(registres(CGB));
    });

    it('SP et PC ne dépendent pas du modèle', () => {
      expect(registres(CGB).SP).toBe(registres(DMG).SP);
      expect(registres(CGB).PC).toBe(registres(DMG).PC);
    });

    it('un modèle inconnu échoue au lieu de poser des valeurs au hasard', () => {
      const { cpu } = makeMachine();
      expect(() => cpu.postBoot('sgb')).toThrow(/modèle inconnu/);
      expect(() => cpu.postBoot(AUTO), 'auto n\'est pas un modèle, c\'est une préférence')
        .toThrow(/modèle inconnu/);
    });
  });
});
