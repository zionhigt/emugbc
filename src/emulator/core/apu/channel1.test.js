import { describe, it, expect } from 'vitest';

import buildAPU from './index';
import buildTimer from '../timer/index';

/**
 * CRAN 10a : LE CANAL 1 EXISTE.
 *
 * Le canal 1 est le canal 2 déplacé en 0xFF10-0xFF14, plus un registre de sweep (NR10)
 * qui reste inerte à ce cran. Ses quatre autres registres portent les mêmes champs :
 *
 *   NR11 (0xFF11)  duty + longueur      comme NR21
 *   NR12 (0xFF12)  volume + enveloppe   comme NR22
 *   NR13 (0xFF13)  fréquence basse      comme NR23
 *   NR14 (0xFF14)  trigger + length en. comme NR24
 *
 * Ce fichier ne rejoue PAS toute la batterie du canal 2 — le comportement est censé venir
 * d'une classe partagée, et le retester en entier ne mesurerait que la duplication. Il
 * vérifie trois choses : le câblage aux bonnes adresses, un échantillon représentatif de
 * chaque unité (duty, DAC, trigger, longueur, enveloppe), et surtout l'INDÉPENDANCE des
 * deux canaux — c'est là que rate un partage mal fait, sur un état devenu commun.
 */

const NR10 = 0xFF10;
const NR11 = 0xFF11;
const NR12 = 0xFF12;
const NR13 = 0xFF13;
const NR14 = 0xFF14;

const NR21 = 0xFF16;
const NR22 = 0xFF17;
const NR23 = 0xFF18;
const NR24 = 0xFF19;

const NR52 = 0xFF26;

const TRIGGER = 0x80;
const LENGTH_ENABLE = 0x40;
const POWER = 0x80;

const TIC = 2048;             // un tic de carillon
const CLOCHE_LONGUEUR = 2 * TIC;
const cloche = (n) => (8 * n - 1) * TIC; // n-ième coup de la cloche enveloppe

const buildHarness = () => {
    const machine = {
        totalCycles: 0,
        timer: null,
        memory: { _read: () => 0x42, _write: () => {} },
    };
    const Timer = buildTimer(machine);
    machine.timer = new Timer();

    const APU = buildAPU(machine);
    const apu = new APU();
    return { machine, apu, chan1: apu.channel1, chan2: apu.channel2 };
};

describe('Canal 1 - le câblage', () => {

    it('l\'APU expose un canal 1', () => {
        const { chan1 } = buildHarness();
        expect(chan1, 'apu.channel1').toBeDefined();
    });

    it('NR11 porte le duty', () => {
        const { apu, chan1 } = buildHarness();
        apu.write(NR11, 0x80);
        expect(chan1.duty).toBe(2);
    });

    it('NR13 et NR14 portent la fréquence', () => {
        const { apu, chan1 } = buildHarness();
        apu.write(NR13, 0x34);
        apu.write(NR14, 0x05);
        expect(chan1.frequency).toBe(0x534);
        expect(chan1.period).toBe(2048 - 0x534);
    });

    it('NR12 porte le volume et alimente le DAC', () => {
        const { apu, chan1 } = buildHarness();
        expect(chan1.isDacOn, 'au repos').toBe(false);
        apu.write(NR12, 0xF0);
        expect(chan1.initialVolume).toBe(15);
        expect(chan1.isDacOn).toBe(true);
    });

    it('NR14 porte le trigger et le length enable', () => {
        const { apu, chan1 } = buildHarness();
        apu.write(NR12, 0xF0);
        apu.write(NR14, TRIGGER | LENGTH_ENABLE);
        expect(chan1.isEnabled).toBe(true);
        expect(chan1.isLengthEnabled).toBe(true);
    });
});

describe('Canal 1 - le rouleau et la sortie', () => {

    const buildPlaying = () => {
        const harness = buildHarness();
        harness.apu.write(NR11, 0xC0); // pochoir 3
        harness.apu.write(NR12, 0xF0); // volume 15
        harness.apu.write(NR14, TRIGGER);
        return harness;
    };

    it('le rouleau tourne à la période du canal', () => {
        const { chan1 } = buildPlaying();
        const period = chan1.period;
        expect(chan1.dutyStep(0)).toBe(0);
        expect(chan1.dutyStep(period)).toBe(1);
        expect(chan1.dutyStep(8 * period)).toBe(0);
    });

    it('amplitude sort au volume chargé', () => {
        const { chan1 } = buildPlaying();
        const period = chan1.period;
        // pochoir 3 : cran 0 creux, cran 1 picot
        expect(chan1.amplitude(0)).toBe(0);
        expect(chan1.amplitude(period)).toBe(15);
    });

    it('couper le DAC éteint le canal', () => {
        const { apu, chan1 } = buildPlaying();
        apu.write(NR12, 0x00);
        expect(chan1.isEnabled).toBe(false);
    });
});

describe('Canal 1 - le minuteur et l\'enveloppe', () => {

    it('le minuteur décompte et coupe la note', () => {
        const { apu, chan1 } = buildHarness();
        apu.write(NR11, 0xC0 | 0x3C); // pochoir 3, 4 crans
        apu.write(NR12, 0xF0);
        apu.write(NR14, TRIGGER | LENGTH_ENABLE);

        expect(chan1.lengthRemaining(0)).toBe(4);
        expect(chan1.lengthRemaining(2 * CLOCHE_LONGUEUR)).toBe(2);
        expect(chan1.isEnabledAt(3 * CLOCHE_LONGUEUR), 'il reste un cran').toBe(true);
        expect(chan1.isEnabledAt(4 * CLOCHE_LONGUEUR), 'à sec').toBe(false);
    });

    it('l\'enveloppe fait dériver le volume', () => {
        const { apu, chan1 } = buildHarness();
        apu.write(NR11, 0xC0);
        apu.write(NR12, 0xF3); // volume 15, descendant, période 3
        apu.write(NR14, TRIGGER);

        expect(chan1.volumeAt(0)).toBe(15);
        expect(chan1.volumeAt(cloche(3))).toBe(14);
        expect(chan1.volumeAt(cloche(45)), 'à sec').toBe(0);
    });
});

describe('Canal 1 - NR52 le voit', () => {

    it('le bit 0 se lève quand le canal 1 joue', () => {
        const { apu } = buildHarness();
        apu.write(NR12, 0xF0);
        apu.write(NR14, TRIGGER);
        expect(apu.read(NR52) & 0x01, 'bit 0 = canal 1').toBe(0x01);
    });

    it('les deux canaux ont chacun leur bit', () => {
        const { apu } = buildHarness();
        apu.write(NR12, 0xF0);
        apu.write(NR14, TRIGGER);
        expect(apu.read(NR52), 'canal 1 seul').toBe(0xF1);

        apu.write(NR22, 0xF0);
        apu.write(NR24, TRIGGER);
        expect(apu.read(NR52), 'les deux').toBe(0xF3);
    });

    it('éteindre l\'APU coupe les deux', () => {
        const { apu, chan1, chan2 } = buildHarness();
        apu.write(NR12, 0xF0);
        apu.write(NR14, TRIGGER);
        apu.write(NR22, 0xF0);
        apu.write(NR24, TRIGGER);

        apu.write(NR52, 0x00);
        expect(chan1.isEnabled).toBe(false);
        expect(chan2.isEnabled).toBe(false);
        expect(apu.read(NR52)).toBe(0x70);
    });
});

describe('Canal 1 et canal 2 sont indépendants', () => {

    it('écrire dans l\'un ne touche pas l\'autre', () => {
        const { apu, chan1, chan2 } = buildHarness();
        apu.write(NR11, 0xC0); // canal 1 : pochoir 3
        apu.write(NR21, 0x40); // canal 2 : pochoir 1

        expect(chan1.duty, 'canal 1').toBe(3);
        expect(chan2.duty, 'canal 2').toBe(1);
    });

    it('ils ont chacun leur fréquence', () => {
        const { apu, chan1, chan2 } = buildHarness();
        apu.write(NR13, 0xFF);
        apu.write(NR14, 0x07);
        apu.write(NR23, 0x00);
        apu.write(NR24, 0x04);

        expect(chan1.frequency).toBe(0x7FF);
        expect(chan2.frequency).toBe(0x400);
    });

    it('déclencher l\'un n\'allume pas l\'autre', () => {
        const { apu, chan1, chan2 } = buildHarness();
        apu.write(NR12, 0xF0);
        apu.write(NR22, 0xF0);

        apu.write(NR14, TRIGGER);
        expect(chan1.isEnabled, 'déclenché').toBe(true);
        expect(chan2.isEnabled, 'pas touché').toBe(false);
    });

    it('leurs minuteurs sont distincts', () => {
        const { apu, chan1, chan2 } = buildHarness();
        apu.write(NR11, 0x3C); // canal 1 : 4 crans
        apu.write(NR21, 0x3F); // canal 2 : 1 cran

        expect(chan1.lengthRemaining(0)).toBe(4);
        expect(chan2.lengthRemaining(0)).toBe(1);
    });

    it('leurs volumes dérivent séparément', () => {
        const { apu, chan1, chan2 } = buildHarness();
        apu.write(NR12, 0xF3); // canal 1 : 15, descendant, période 3
        apu.write(NR22, 0xA0); // canal 2 : 10, enveloppe débranchée
        apu.write(NR14, TRIGGER);
        apu.write(NR24, TRIGGER);

        expect(chan1.volumeAt(cloche(3)), 'canal 1 a perdu un pas').toBe(14);
        expect(chan2.volumeAt(cloche(3)), 'canal 2 n\'a pas bougé').toBe(10);
    });
});

describe('Canal 1 - NR10 existe, le sweep viendra', () => {

    it('NR10 retient ce qu\'on lui écrit, à son masque près', () => {
        const { apu } = buildHarness();
        apu.write(NR10, 0x00);
        expect(apu.read(NR10), 'bit 7 toujours levé').toBe(0x80);
        apu.write(NR10, 0x35);
        expect(apu.read(NR10)).toBe(0xB5);
    });

    it('écrire NR10 ne perturbe rien d\'autre', () => {
        const { apu, chan1 } = buildHarness();
        apu.write(NR11, 0xC0);
        apu.write(NR12, 0xF0);
        apu.write(NR13, 0x34);
        apu.write(NR14, TRIGGER | 0x05);

        apu.write(NR10, 0x77);

        expect(chan1.duty).toBe(3);
        expect(chan1.frequency, 'le sweep n\'est pas encore branché').toBe(0x534);
        expect(chan1.isEnabled).toBe(true);
    });
});
