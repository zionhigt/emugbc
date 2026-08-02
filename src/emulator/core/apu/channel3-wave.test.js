import { describe, it, expect } from 'vitest';

import buildAPU from './index';
import buildTimer from '../timer/index';

/**
 * CRAN 11b : LA LECTURE DE LA WAVE.
 *
 * Le canal 3 ne fabrique pas sa forme d'onde, il la lit dans la wave RAM : 16 octets,
 * 32 échantillons de 4 bits, QUARTET HAUT D'ABORD. L'octet 0xFF30 porte l'échantillon 0
 * dans ses bits 7-4 et l'échantillon 1 dans ses bits 3-0.
 *
 * Trois écarts avec le rouleau des canaux pulse, et ce fichier les vise tous les trois :
 *   - 32 positions, qui avancent DEUX FOIS plus vite : une toutes les
 *     (2048 - frequency) / 2 cycles machine ;
 *   - le trigger remet la position à ZÉRO, là où le duty d'un canal pulse continue
 *     imperturbablement ;
 *   - pas d'enveloppe : le volume est un décalage fixe lu dans NR32.
 *
 *     niveau 0  muet          niveau 2  moitié   (>> 1)
 *     niveau 1  pleine échelle niveau 3  quart    (>> 2)
 *
 * Hors périmètre : ce que le matériel fait quand on lit ou écrit la wave RAM PENDANT que
 * le canal joue (blargg 09, 10 et 12). C'est son propre cran.
 */

const NR30 = 0xFF1A;
const NR32 = 0xFF1C;
const NR33 = 0xFF1D;
const NR34 = 0xFF1E;

const WAVE = 0xFF30;

const TRIGGER = 0x80;
const DAC_ON = 0x80;

/** frequency = 1536 : période de 512, donc un échantillon tous les 256 cycles machine. */
const FREQUENCY = 0x600;
const PAS = 256;

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
    return { machine, apu, chan3: apu.channel3 };
};

/**
 * Motif repère : l'octet i vaut (i << 4) | (15 - i).
 * Donc l'échantillon 2i vaut i, et l'échantillon 2i+1 vaut 15 - i.
 * Les 32 échantillons sont ainsi tous identifiables à l'œil.
 */
const MOTIF = Array.from({ length: 16 }, (_, i) => (i << 4) | (15 - i));
const attendu = (position) => (position % 2 === 0 ? position / 2 : 15 - (position - 1) / 2);

/** Canal 3 alimenté, wave remplie, note lancée à la date 0. */
const buildPlaying = (niveau = 1) => {
    const harness = buildHarness();
    const { apu } = harness;
    MOTIF.forEach((octet, i) => apu.write(WAVE + i, octet));
    apu.write(NR30, DAC_ON);
    apu.write(NR32, niveau << 5);
    apu.write(NR33, FREQUENCY & 0xFF);
    apu.write(NR34, TRIGGER | ((FREQUENCY >> 8) & 0x07));
    return harness;
};

describe('Wave - le niveau de sortie', () => {

    it.each([
        { nr32: 0x00, niveau: 0 },
        { nr32: 0x20, niveau: 1 },
        { nr32: 0x40, niveau: 2 },
        { nr32: 0x60, niveau: 3 },
        { nr32: 0xFF, niveau: 3 },
        { nr32: 0x9F, niveau: 0 },
    ])('NR32 = $nr32 donne le niveau $niveau', ({ nr32, niveau }) => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR32, nr32);
        expect(chan3.outputLevel).toBe(niveau);
    });
});

describe('Wave - la position tourne', () => {

    it('elle part de zéro au trigger', () => {
        const { chan3 } = buildPlaying();
        expect(chan3.waveStep(0)).toBe(0);
    });

    it('un échantillon tous les 256 cycles machine, et la frontière est exacte', () => {
        const { chan3 } = buildPlaying();
        expect(chan3.waveStep(PAS - 1), 'un cycle trop tôt').toBe(0);
        expect(chan3.waveStep(PAS), 'pile').toBe(1);
        expect(chan3.waveStep(2 * PAS)).toBe(2);
        expect(chan3.waveStep(31 * PAS)).toBe(31);
    });

    it('elle avance DEUX FOIS plus vite que le rouleau d\'un canal pulse', () => {
        const { chan3 } = buildPlaying();
        // période 512 : un canal pulse changerait de cran tous les 512 cycles
        expect(chan3.period, 'la période est bien 512').toBe(512);
        expect(chan3.waveStep(512), 'deux échantillons en une période').toBe(2);
    });

    it('trente-deux positions font un tour', () => {
        const { chan3 } = buildPlaying();
        expect(chan3.waveStep(32 * PAS), 'le tour est bouclé').toBe(0);
        expect(chan3.waveStep(33 * PAS)).toBe(1);
        expect(chan3.waveStep(100 * 32 * PAS), 'cent tours plus tard').toBe(0);
    });

    it('le trigger la remet à zéro — contrairement au duty d\'un canal pulse', () => {
        const { machine, apu, chan3 } = buildPlaying();
        expect(chan3.waveStep(5 * PAS)).toBe(5);

        machine.totalCycles = 5 * PAS;
        apu.write(NR34, TRIGGER | ((FREQUENCY >> 8) & 0x07));

        expect(chan3.waveStep(5 * PAS), 'repart de zéro').toBe(0);
        expect(chan3.waveStep(6 * PAS), 'et compte depuis là').toBe(1);
    });
});

describe('Wave - lire les quartets', () => {

    it('quartet HAUT d\'abord : 0xFF30 porte les échantillons 0 et 1', () => {
        const { apu, chan3 } = buildPlaying();
        apu.write(WAVE, 0x1A);
        expect(chan3.waveSample(0), 'bits 7-4').toBe(0x1);
        expect(chan3.waveSample(PAS), 'bits 3-0').toBe(0xA);
    });

    it('le dernier octet porte les échantillons 30 et 31', () => {
        const { apu, chan3 } = buildPlaying();
        apu.write(WAVE + 15, 0xC7);
        expect(chan3.waveSample(30 * PAS)).toBe(0xC);
        expect(chan3.waveSample(31 * PAS)).toBe(0x7);
    });

    it('les 32 échantillons du motif sortent dans l\'ordre', () => {
        const { chan3 } = buildPlaying();
        const tour = [];
        for (let position = 0; position < 32; position++) {
            tour.push(chan3.waveSample(position * PAS));
        }
        expect(tour).toEqual(Array.from({ length: 32 }, (_, p) => attendu(p)));
    });

    it('le quartet ne change pas entre deux positions', () => {
        const { chan3 } = buildPlaying();
        for (let offset = 0; offset < PAS; offset++) {
            expect(chan3.waveSample(PAS + offset), `offset ${offset}`).toBe(attendu(1));
        }
    });
});

describe('Wave - le niveau met le quartet à l\'échelle', () => {

    // l'échantillon 1 du motif vaut 15 : le plus lisible pour mesurer un décalage
    const AU_MAX = PAS;

    it.each([
        { niveau: 1, sortie: 15, quoi: 'pleine échelle' },
        { niveau: 2, sortie: 7, quoi: 'moitié' },
        { niveau: 3, sortie: 3, quoi: 'quart' },
    ])('niveau $niveau : $quoi, soit $sortie', ({ niveau, sortie }) => {
        const { chan3 } = buildPlaying(niveau);
        expect(chan3.waveSample(AU_MAX), 'le quartet brut ne bouge pas').toBe(15);
        expect(chan3.amplitude(AU_MAX)).toBe(sortie);
    });

    it('niveau 0 : muet, quel que soit le quartet', () => {
        const { chan3 } = buildPlaying(0);
        for (let position = 0; position < 32; position++) {
            expect(chan3.amplitude(position * PAS), `position ${position}`).toBe(0);
        }
    });

    it('amplitude suit le motif à pleine échelle', () => {
        const { chan3 } = buildPlaying(1);
        const tour = [];
        for (let position = 0; position < 32; position++) {
            tour.push(chan3.amplitude(position * PAS));
        }
        expect(tour).toEqual(Array.from({ length: 32 }, (_, p) => attendu(p)));
    });
});

describe('Wave - les deux interrupteurs en amont', () => {

    it('DAC coupé, rien ne sort', () => {
        const { apu, chan3 } = buildPlaying();
        apu.write(NR30, 0x00);
        expect(chan3.amplitude(PAS), 'le quartet vaut pourtant 15').toBe(0);
    });

    it('canal non déclenché, rien ne sort', () => {
        const { apu, chan3 } = buildHarness();
        MOTIF.forEach((octet, i) => apu.write(WAVE + i, octet));
        apu.write(NR30, DAC_ON);
        apu.write(NR32, 1 << 5);
        apu.write(NR33, FREQUENCY & 0xFF);
        apu.write(NR34, (FREQUENCY >> 8) & 0x07); // pas de trigger

        expect(chan3.amplitude(PAS)).toBe(0);
    });

    it('la wave continue de défiler sous un canal éteint', () => {
        const { apu, chan3 } = buildPlaying();
        apu.write(NR30, 0x00);
        expect(chan3.waveStep(5 * PAS), 'la position ne s\'arrête pas').toBe(5);
        expect(chan3.waveSample(5 * PAS), 'le quartet non plus').toBe(attendu(5));
        expect(chan3.amplitude(5 * PAS), 'seule la sortie est coupée').toBe(0);
    });
});
