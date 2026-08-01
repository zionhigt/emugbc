import { describe, it, expect } from 'vitest';

import channel2 from './channel2';

/**
 * CRAN 4 : LE TRIGGER.
 *
 * NR24 bit 7 est un bouton, pas un réglage : écrire un 1 dedans DÉMARRE une note.
 * Dans ce cran il ne fait qu'une chose — allumer le canal. Le rechargement de la
 * longueur et de l'enveloppe viendront avec leurs unités respectives.
 *
 * Trois interrupteurs en série commandent maintenant la sortie :
 *   le rouleau (y a-t-il un picot sur ce cran ?),
 *   le disjoncteur (le DAC est-il alimenté ?),
 *   et l'allumage (le canal a-t-il été déclenché ?).
 *
 * Le canal retient aussi la DATE de son dernier déclenchement : c'est depuis elle que
 * le length counter et l'enveloppe compteront leurs coups de cloche.
 */

const TRIGGER = 0x80;

const buildHarness = () => {
    // L'APU vu par le canal. Sa seule utilité ici : donner l'heure au moment du trigger.
    const apu = {
        totalMachineCycles: 0,
        bus: { _read: () => 0xFF, _write: () => {} },
    };
    return { apu, chan: channel2(apu) };
};

/** Un canal prêt à jouer : DAC alimenté, volume 15, période connue. */
const buildPlayable = () => {
    const { apu, chan } = buildHarness();
    chan.NR21.setValue(0x80); // pochoir 2
    chan.NR22.setValue(0xF0); // volume 15, DAC alimenté
    chan.NR23.setValue(0x00);
    return { apu, chan };
};

describe('Canal 2 - au repos', () => {

    it('un canal neuf est éteint et n\'a jamais été déclenché', () => {
        const { chan } = buildHarness();
        expect(chan.isEnabled, 'rien ne joue à l\'allumage').toBe(false);
        expect(chan.triggeredAt, 'aucun bouton pressé').toBe(null);
    });

    it('régler les registres ne démarre rien : il faut appuyer sur le bouton', () => {
        const { chan } = buildPlayable();
        expect(chan.isEnabled, 'tout est prêt, mais personne n\'a déclenché').toBe(false);
    });
});

describe('Canal 2 - appuyer sur le bouton', () => {

    it('écrire NR24 avec le bit 7 levé allume le canal', () => {
        const { chan } = buildPlayable();
        chan.NR24.setValue(TRIGGER);
        expect(chan.isEnabled).toBe(true);
    });

    it('écrire NR24 sans le bit 7 ne déclenche rien', () => {
        const { chan } = buildPlayable();
        chan.NR24.setValue(0x7F); // tout sauf le trigger
        expect(chan.isEnabled, 'aucun bouton pressé').toBe(false);
        expect(chan.triggeredAt).toBe(null);
    });

    it('le trigger note l\'heure qu\'il est', () => {
        const { apu, chan } = buildPlayable();
        apu.totalMachineCycles = 12345;
        chan.NR24.setValue(TRIGGER);
        expect(chan.triggeredAt).toBe(12345);
    });

    it('un second trigger remplace la date du premier', () => {
        const { apu, chan } = buildPlayable();
        apu.totalMachineCycles = 1000;
        chan.NR24.setValue(TRIGGER);

        apu.totalMachineCycles = 9000;
        chan.NR24.setValue(TRIGGER);
        expect(chan.triggeredAt, 'seule la dernière compte').toBe(9000);
    });

    it('déclencher n\'empêche pas NR24 de faire son autre métier', () => {
        const { chan } = buildPlayable();
        chan.NR23.setValue(0x34);
        chan.NR24.setValue(TRIGGER | 0x05); // trigger ET les 3 bits hauts de frequency
        expect(chan.isEnabled, 'le bouton a été pressé').toBe(true);
        expect(chan.frequency, 'et la fréquence est bien passée').toBe(0x534);
    });
});

describe('Canal 2 - le disjoncteur a le dernier mot', () => {

    it('DAC coupé, le trigger n\'allume pas le canal', () => {
        const { chan } = buildHarness();
        chan.NR22.setValue(0x00); // disjoncteur baissé
        chan.NR24.setValue(TRIGGER);
        expect(chan.isEnabled, 'appuyer ne sert à rien, disjoncteur baissé').toBe(false);
    });

    it('mais le bouton a bien été pressé : la date est notée quand même', () => {
        const { apu, chan } = buildHarness();
        chan.NR22.setValue(0x00);
        apu.totalMachineCycles = 700;
        chan.NR24.setValue(TRIGGER);
        expect(chan.triggeredAt, 'l\'événement a eu lieu, seul l\'allumage est refusé').toBe(700);
    });

    it('couper le DAC en vol éteint le canal', () => {
        const { chan } = buildPlayable();
        chan.NR24.setValue(TRIGGER);
        expect(chan.isEnabled, 'le canal jouait').toBe(true);

        chan.NR22.setValue(0x00);
        expect(chan.isEnabled, 'le disjoncteur saute, la note s\'arrête').toBe(false);
    });

    it('rallumer le DAC ne rallume PAS le canal : il faut redéclencher', () => {
        const { chan } = buildPlayable();
        chan.NR24.setValue(TRIGGER);
        chan.NR22.setValue(0x00); // coupé
        chan.NR22.setValue(0xF0); // réalimenté

        expect(chan.isEnabled, 'le disjoncteur ne remonte pas la note avec lui').toBe(false);
        chan.NR24.setValue(TRIGGER);
        expect(chan.isEnabled, 'il faut réappuyer sur le bouton').toBe(true);
    });
});

describe('Canal 2 - un canal éteint ne sort rien', () => {

    it('tout est prêt mais rien n\'a été déclenché : amplitude reste nulle', () => {
        const { chan } = buildPlayable();
        const period = chan.period;
        for (let step = 0; step < 8; step++) {
            expect(chan.amplitude(step * period), `cran ${step}`).toBe(0);
        }
    });

    it('une fois déclenché, le signal sort', () => {
        const { chan } = buildPlayable();
        chan.NR24.setValue(TRIGGER);
        const period = chan.period;
        // pochoir 2 : picots aux crans 0, 5, 6, 7 — volume 15
        expect(chan.amplitude(0), 'cran 0, un picot').toBe(15);
        expect(chan.amplitude(period), 'cran 1, un creux').toBe(0);
        expect(chan.amplitude(5 * period), 'cran 5, un picot').toBe(15);
    });

    it('le rouleau, lui, tourne même canal éteint', () => {
        const { chan } = buildPlayable();
        const period = chan.period;
        expect(chan.dutyStep(3 * period), 'la manivelle ne s\'arrête jamais').toBe(3);
        expect(chan.dutyOutput(5 * period), 'et les picots sont toujours là').toBe(1);
    });
});
