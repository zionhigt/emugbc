import { describe, it, expect } from 'vitest';

import buildAPU from './index';
import buildTimer from '../timer/index';

/**
 * CRAN 6 : L'ENVELOPPE.
 *
 * Le volume n'est plus un réglage figé : il est CHARGÉ au trigger depuis NR22 bits 7-4,
 * puis il fait ±1 toutes les `envelopePeriod` cloches d'enveloppe (64 Hz), et il s'arrête
 * définitivement en butée — à 0 en descendant, à 15 en montant. Il ne repart pas de l'autre
 * côté et il ne redémarre pas tout seul.
 *
 * Période 0 = enveloppe débranchée : le volume ne bouge jamais.
 *
 * Écrire NR22 pendant une note change le RÉGLAGE (`initialVolume`) mais pas le volume en
 * cours. Seul un nouveau trigger recharge. Les bizarreries dites de « zombie mode » — ce
 * que fait le matériel quand on écrit NR22 pile pendant un pas d'enveloppe — ne sont pas
 * couvertes ici.
 */

const TIC = 2048; // un tic de carillon, en cycles machine

/**
 * Date du n-ième coup de la cloche enveloppe. Elle frappe en position 7 du carillon,
 * donc aux tics 7, 15, 23... — un sur huit, mais décalé.
 */
const cloche = (n) => (8 * n - 1) * TIC;

const TRIGGER = 0x80;

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
    return { machine, apu, chan: apu.channel2 };
};

/** Règle NR22 puis déclenche la note à la date 0. */
const buildNote = (nr22) => {
    const harness = buildHarness();
    harness.chan.NR21.setValue(0xC0); // pochoir 3
    harness.chan.NR22.setValue(nr22);
    harness.chan.NR24.setValue(TRIGGER);
    return harness;
};

describe('Enveloppe - les deux champs de queue de NR22', () => {

    it.each([
        { nr22: 0x00, periode: 0 },
        { nr22: 0x01, periode: 1 },
        { nr22: 0x07, periode: 7 },
        { nr22: 0xF7, periode: 7 },
        { nr22: 0xF8, periode: 0 },
    ])('NR22 = $nr22 donne une période de $periode', ({ nr22, periode }) => {
        const { chan } = buildHarness();
        chan.NR22.setValue(nr22);
        expect(chan.envelopePeriod).toBe(periode);
    });

    it('le bit 3 donne le sens', () => {
        const { chan } = buildHarness();
        chan.NR22.setValue(0x00);
        expect(chan.isEnvelopeIncreasing, 'bit 3 bas : descend').toBe(false);
        chan.NR22.setValue(0x08);
        expect(chan.isEnvelopeIncreasing, 'bit 3 levé : monte').toBe(true);
    });

    it('le volume de tête ne déborde pas sur le sens ni sur la période', () => {
        const { chan } = buildHarness();
        chan.NR22.setValue(0xF0);
        expect(chan.initialVolume).toBe(15);
        expect(chan.isEnvelopeIncreasing, 'aucun bit de queue levé').toBe(false);
        expect(chan.envelopePeriod).toBe(0);
    });
});

describe('Enveloppe - période 0 : débranchée', () => {

    it('le volume ne bouge jamais', () => {
        const { chan } = buildNote(0xA0); // volume 10, période 0
        expect(chan.volumeAt(0)).toBe(10);
        expect(chan.volumeAt(cloche(1))).toBe(10);
        expect(chan.volumeAt(cloche(500)), 'même très longtemps après').toBe(10);
    });
});

describe('Enveloppe - elle descend', () => {

    // volume 15, sens descendant (bit 3 bas), période 3
    const build = () => buildNote(0xF3);

    it('le volume tient jusqu\'à la période, puis perd 1', () => {
        const { chan } = build();
        expect(chan.volumeAt(0), 'au départ').toBe(15);
        expect(chan.volumeAt(cloche(2)), 'deux cloches, pas encore trois').toBe(15);
        expect(chan.volumeAt(cloche(3)), 'troisième cloche : un pas').toBe(14);
        expect(chan.volumeAt(cloche(5)), 'toujours dans le même pas').toBe(14);
        expect(chan.volumeAt(cloche(6)), 'deuxième pas').toBe(13);
    });

    it('il ne bouge pas entre deux cloches', () => {
        const { chan } = build();
        expect(chan.volumeAt(cloche(3) - 1), 'un cycle avant').toBe(15);
        expect(chan.volumeAt(cloche(3)), 'et à la cloche pile').toBe(14);
    });

    it('il s\'arrête à zéro et n\'en repart pas', () => {
        const { chan } = build();
        // 15 pas de 3 cloches pour aller de 15 à 0
        expect(chan.volumeAt(cloche(44)), 'juste avant le dernier pas').toBe(1);
        expect(chan.volumeAt(cloche(45)), 'à sec').toBe(0);
        expect(chan.volumeAt(cloche(200)), 'et ça reste à sec').toBe(0);
    });
});

describe('Enveloppe - elle monte', () => {

    // volume 0, sens montant (bit 3 levé), période 4
    const build = () => buildNote(0x0C);

    it('le DAC est alimenté par le seul bit de sens, volume nul', () => {
        const { chan } = build();
        expect(chan.isDacOn).toBe(true);
        expect(chan.volumeAt(0)).toBe(0);
    });

    it('le volume gagne 1 toutes les quatre cloches', () => {
        const { chan } = build();
        expect(chan.volumeAt(cloche(3)), 'pas encore').toBe(0);
        expect(chan.volumeAt(cloche(4)), 'premier pas').toBe(1);
        expect(chan.volumeAt(cloche(8)), 'deuxième').toBe(2);
    });

    it('il s\'arrête à quinze', () => {
        const { chan } = build();
        expect(chan.volumeAt(cloche(60)), '15 pas de 4 cloches').toBe(15);
        expect(chan.volumeAt(cloche(500)), 'et n\'en bouge plus').toBe(15);
    });
});

describe('Enveloppe - écrire NR22 ne recharge pas le volume', () => {

    it('changer NR22 en vol change le réglage, pas le volume courant', () => {
        const { chan } = buildNote(0xA0); // volume 10, enveloppe débranchée
        expect(chan.volumeAt(0)).toBe(10);

        chan.NR22.setValue(0x20); // réglage à 2
        expect(chan.initialVolume, 'le réglage a changé').toBe(2);
        expect(chan.volumeAt(0), 'mais la note joue toujours à 10').toBe(10);
    });

    it('avant tout trigger, le volume vaut zéro même si NR22 est réglé haut', () => {
        const { chan } = buildHarness();
        chan.NR22.setValue(0xF0);
        expect(chan.initialVolume, 'le réglage est bien là').toBe(15);
        expect(chan.volumeAt(0), 'mais rien ne l\'a chargé').toBe(0);
    });
});

describe('Enveloppe - le trigger la recharge et la relance', () => {

    it('redéclencher ramène le volume au réglage courant', () => {
        const { machine, chan } = buildNote(0xF3); // 15, descendant, période 3
        expect(chan.volumeAt(cloche(6)), 'deux pas consommés').toBe(13);

        machine.totalCycles = cloche(6);
        chan.NR24.setValue(TRIGGER);
        expect(chan.volumeAt(cloche(6)), 'rechargé au réglage').toBe(15);
    });

    it('et elle repart à compter depuis le nouveau trigger', () => {
        const { machine, chan } = buildNote(0xF3);
        machine.totalCycles = cloche(6);
        chan.NR24.setValue(TRIGGER);

        expect(chan.volumeAt(cloche(8)), 'deux cloches après le trigger, pas encore trois').toBe(15);
        expect(chan.volumeAt(cloche(9)), 'trois cloches après : un pas').toBe(14);
    });

    it('redéclencher prend le NOUVEAU réglage si NR22 a changé entre-temps', () => {
        const { machine, chan } = buildNote(0xF3);
        chan.NR22.setValue(0x50); // réglage à 5, enveloppe débranchée

        machine.totalCycles = cloche(6);
        chan.NR24.setValue(TRIGGER);
        expect(chan.volumeAt(cloche(6))).toBe(5);
        expect(chan.volumeAt(cloche(200)), 'période 0 : plus rien ne bouge').toBe(5);
    });
});

describe('Enveloppe - amplitude suit le volume qui dérive', () => {

    it('la sortie décroît avec l\'enveloppe', () => {
        const { chan } = buildNote(0xF3); // pochoir 3, volume 15 descendant, période 3
        const period = chan.period;
        // pochoir 3 : le cran 1 du rouleau porte un picot. Les dates de cloche tombent sur
        // des crans creux, d'où le décalage de deux périodes pour retomber sur un picot.
        expect(chan.amplitude(period), 'au départ, plein volume').toBe(15);
        expect(chan.amplitude(cloche(3) + 2 * period), 'un pas plus bas').toBe(14);
        expect(chan.amplitude(cloche(45) + 2 * period), 'enveloppe à sec : silence').toBe(0);
    });

    it('un creux reste un creux quel que soit le volume', () => {
        const { chan } = buildNote(0xF3);
        const period = chan.period;
        // pochoir 3 : le cran 0 est un creux
        expect(chan.amplitude(0)).toBe(0);
        expect(chan.amplitude(cloche(3))).toBe(0);
    });
});
