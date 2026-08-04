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
 * La remise à zéro du carillon à l'allumage a son bloc dans frame-sequencer.test.js ; la
 * survie des compteurs de longueur, propre au DMG, est en fin de ce fichier.
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

/**
 * L'EXCEPTION DMG : LES COMPTEURS DE LONGUEUR SURVIVENT À L'EXTINCTION.
 *
 * Wiki gbdev, section « Obscure Behavior »,
 * https://gbdev.gg8.se/wiki/articles/Gameboy_sound_hardware :
 *
 *   « When powered off, all registers (NR10-NR51) are instantly written with zero and any
 *     writes to those registers are ignored while power remains off (except on the DMG,
 *     where length counters are unaffected by power and can still be written while off). »
 *
 * Deux conséquences, arbitrées par `11-regs after power` (#4, « Powering off shouldn't
 * affect NR41 ») et `08-len ctr during power` :
 *
 *   - l'extinction efface bien l'octet de NRx1, mais pas le COMPTEUR qu'il avait chargé ;
 *   - une écriture dans NRx1 pendant l'extinction passe quand même — sa partie longueur
 *     seulement, le pochoir restant, lui, sous la règle générale.
 */
describe('NR52 - l\'extinction et les compteurs de longueur', () => {

    const REGISTRES_DE_LONGUEUR = [
        { nom: 'NR11', addr: 0xFF11, canal: 'channel1', valeur: 0x3C, crans: 4 },
        { nom: 'NR21', addr: 0xFF16, canal: 'channel2', valeur: 0x3C, crans: 4 },
        { nom: 'NR31', addr: 0xFF1B, canal: 'channel3', valeur: 0xFC, crans: 4 }, // 8 bits
        { nom: 'NR41', addr: 0xFF20, canal: 'channel4', valeur: 0x3C, crans: 4 },
    ];

    it.each(REGISTRES_DE_LONGUEUR)(
        '$nom : le compteur survit à l\'extinction',
        ({ addr, canal, valeur, crans }) => {
            const { apu } = buildHarness();
            apu.write(addr, valeur);
            expect(apu[canal].lengthRemaining(0), 'chargé avant l\'extinction').toBe(crans);

            apu.write(NR52, 0x00);
            apu.write(NR52, POWER);

            expect(apu[canal].lengthRemaining(0), 'l\'extinction ne l\'a pas touché').toBe(crans);
        },
    );

    it.each(REGISTRES_DE_LONGUEUR)(
        '$nom : reste écrivable pendant l\'extinction',
        ({ addr, canal, valeur, crans }) => {
            const { apu } = buildHarness();
            apu.write(NR52, 0x00);

            apu.write(addr, valeur);

            expect(apu[canal].lengthRemaining(0), 'la longueur passe malgré l\'extinction').toBe(crans);
        },
    );

    it('mais seulement leur partie longueur : le pochoir reste sous la règle générale', () => {
        const { apu, chan } = buildHarness();
        apu.write(NR52, 0x00);

        apu.write(NR21, 0xC0 | 0x3C); // pochoir 3 ET longueur 60

        expect(chan.lengthRemaining(0), 'la longueur passe').toBe(4);
        expect(chan.duty, 'le pochoir non').toBe(0);
    });

    it('les autres registres restent bien ignorés, eux', () => {
        const { apu, chan } = buildHarness();
        apu.write(NR52, 0x00);

        apu.write(NR22, 0xF0);
        apu.write(NR24, TRIGGER);

        expect(chan.initialVolume, 'NR22 ignoré').toBe(0);
        expect(chan.isEnabled, 'le trigger aussi').toBe(false);
    });
});
