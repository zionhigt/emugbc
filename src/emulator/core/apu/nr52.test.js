import { describe, it, expect } from 'vitest';

import buildAPU from './index';
import buildTimer from '../timer/index';

/**
 * CRAN 7 : NR52, L'ALIMENTATION ET L'ÉTAT DES CANAUX.
 *
 *   bit 7    alimentation de l'APU, lecture et écriture
 *   bits 6-4 inutilisés, se relisent à 1
 *   bits 3-0 un canal actif par bit, LECTURE SEULE (canal 2 = bit 1)
 *
 * Éteindre l'APU met à zéro 0xFF10-0xFF25 et fait ignorer toute écriture dans cette
 * plage tant qu'il reste éteint. NR52 lui-même reste écrivable.
 *
 * Hors périmètre, faute d'oracle : la survie des compteurs de longueur à l'extinction
 * (propre au DMG) et la remise à zéro du carillon à l'allumage.
 */

const NR21 = 0xFF16;
const NR22 = 0xFF17;
const NR23 = 0xFF18;
const NR24 = 0xFF19;
const NR52 = 0xFF26;

const TRIGGER = 0x80;
const POWER = 0x80;

const buildHarness = () => {
    const machine = {
        totalCycles: 0,
        timer: null,
        memory: { _read: () => 0xFF, _write: () => {} },
    };
    const Timer = buildTimer(machine);
    machine.timer = new Timer();

    const APU = buildAPU(machine);
    const apu = new APU();
    apu.write(NR52, POWER); // l'APU démarre alimenté
    return { machine, apu, chan: apu.channel2 };
};

/** Lance une note sur le canal 2 : DAC alimenté, volume 15, trigger. */
const playChannel2 = (apu) => {
    apu.write(NR21, 0xC0);
    apu.write(NR22, 0xF0);
    apu.write(NR24, TRIGGER);
};

describe('NR52 - ce qu\'on relit', () => {

    it('APU alimenté, aucun canal actif : 0xF0', () => {
        const { apu } = buildHarness();
        expect(apu.read(NR52)).toBe(0xF0);
    });

    it('APU alimenté, canal 2 en train de jouer : le bit 1 se lève', () => {
        const { apu } = buildHarness();
        playChannel2(apu);
        expect(apu.read(NR52)).toBe(0xF2);
    });

    it('les bits des canaux absents restent bas', () => {
        const { apu } = buildHarness();
        playChannel2(apu);
        const value = apu.read(NR52);
        expect(value & 0x01, 'canal 1').toBe(0);
        expect(value & 0x04, 'canal 3').toBe(0);
        expect(value & 0x08, 'canal 4').toBe(0);
    });

    it('APU éteint : plus que les bits inutilisés', () => {
        const { apu } = buildHarness();
        playChannel2(apu);
        apu.write(NR52, 0x00);
        expect(apu.read(NR52)).toBe(0x70);
    });

    it('couper le DAC baisse le bit du canal', () => {
        const { apu } = buildHarness();
        playChannel2(apu);
        apu.write(NR22, 0x00);
        expect(apu.read(NR52) & 0x02, 'canal 2 coupé').toBe(0);
    });
});

describe('NR52 - les bits d\'état ne s\'écrivent pas', () => {

    it('écrire 0xFF n\'allume aucun canal', () => {
        const { apu } = buildHarness();
        apu.write(NR52, 0xFF);
        expect(apu.read(NR52), 'seul le bit 7 a été retenu').toBe(0xF0);
    });

    it('écrire le bit 1 ne fait pas jouer le canal 2', () => {
        const { apu, chan } = buildHarness();
        apu.write(NR52, POWER | 0x02);
        expect(chan.isEnabled, 'aucun trigger n\'a eu lieu').toBe(false);
        expect(apu.read(NR52)).toBe(0xF0);
    });
});

describe('NR52 - éteindre l\'APU', () => {

    it('remet les registres du canal à zéro', () => {
        const { apu, chan } = buildHarness();
        apu.write(NR21, 0xC0); // pochoir 3
        apu.write(NR22, 0xF0); // volume 15
        apu.write(NR23, 0x34);
        apu.write(NR24, TRIGGER | 0x05);

        apu.write(NR52, 0x00);

        expect(chan.duty, 'NR21 effacé').toBe(0);
        expect(chan.initialVolume, 'NR22 effacé').toBe(0);
        expect(chan.frequency, 'NR23 et NR24 effacés').toBe(0);
    });

    it('éteint les canaux', () => {
        const { apu, chan } = buildHarness();
        playChannel2(apu);
        expect(chan.isEnabled, 'la note jouait').toBe(true);

        apu.write(NR52, 0x00);
        expect(chan.isEnabled, 'plus de courant, plus de note').toBe(false);
    });

    it('fait ignorer les écritures dans 0xFF10-0xFF25', () => {
        const { apu, chan } = buildHarness();
        apu.write(NR52, 0x00);

        apu.write(NR21, 0xC0);
        apu.write(NR22, 0xF0);
        apu.write(NR24, TRIGGER);

        expect(chan.duty, 'NR21 ignoré').toBe(0);
        expect(chan.initialVolume, 'NR22 ignoré').toBe(0);
        expect(chan.isEnabled, 'le trigger aussi').toBe(false);
    });

    it('mais NR52 lui-même reste écrivable, sinon on ne rallumerait jamais', () => {
        const { apu } = buildHarness();
        apu.write(NR52, 0x00);
        expect(apu.read(NR52)).toBe(0x70);

        apu.write(NR52, POWER);
        expect(apu.read(NR52), 'rallumé').toBe(0xF0);
    });

    it('rallumer réaccepte les écritures', () => {
        const { apu, chan } = buildHarness();
        apu.write(NR52, 0x00);
        apu.write(NR52, POWER);

        playChannel2(apu);
        expect(chan.duty, 'NR21 repasse').toBe(3);
        expect(chan.isEnabled, 'et la note démarre').toBe(true);
    });
});

describe('NR52 - isPowered', () => {

    it('suit le bit 7', () => {
        const { apu } = buildHarness();
        expect(apu.isPowered, 'allumé au départ du harnais').toBe(true);
        apu.write(NR52, 0x00);
        expect(apu.isPowered).toBe(false);
        apu.write(NR52, POWER);
        expect(apu.isPowered).toBe(true);
    });
});
