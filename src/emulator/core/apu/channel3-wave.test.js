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
 * Ce que le matériel fait quand on lit ou écrit la wave RAM PENDANT que le canal joue
 * (blargg 09 et 12) a son bloc en fin de fichier. La corruption au trigger (blargg 10)
 * attend encore son cran.
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

    /**
     * Semer un octet précis dans la wave RAM demande que le canal se taise : tant qu'il
     * joue, l'écriture est redirigée vers l'octet qu'il occupe (voir le dernier bloc).
     * Couper le DAC l'éteint sans toucher à `triggeredAt`, donc sans bouger la position.
     */
    const semer = (apu, index, octet) => {
        apu.write(NR30, 0x00);
        apu.write(WAVE + index, octet);
        apu.write(NR30, DAC_ON);
    };

    it('quartet HAUT d\'abord : 0xFF30 porte les échantillons 0 et 1', () => {
        const { apu, chan3 } = buildPlaying();
        semer(apu, 0, 0x1A);
        expect(chan3.waveSample(0), 'bits 7-4').toBe(0x1);
        expect(chan3.waveSample(PAS), 'bits 3-0').toBe(0xA);
    });

    it('le dernier octet porte les échantillons 30 et 31', () => {
        const { apu, chan3 } = buildPlaying();
        semer(apu, 15, 0xC7);
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

/**
 * LIRE ET ÉCRIRE LA WAVE RAM PENDANT QUE LE CANAL JOUE.
 *
 * Wiki gbdev, section « Obscure Behavior »,
 * https://gbdev.gg8.se/wiki/articles/Gameboy_sound_hardware :
 *
 *   « If the wave channel is enabled, accessing any byte from $FF30-$FF3F is equivalent
 *     to accessing the current byte selected by the waveform position. »
 *
 *   « on the DMG accesses will only work in this manner if made within a couple of clocks
 *     of the wave channel accessing wave RAM; if made at any other time, reads return $FF
 *     and writes have no effect. »
 *
 * Deux notions à distinguer, d'où les deux méthodes :
 *   - QUEL octet le canal occupe — `waveByteIndexAt`, la position divisée par deux ;
 *   - QUAND il y touche — `isAccessingWaveAt`, l'instant où il passe à l'octet suivant.
 *
 * La fenêtre est modélisée ici au cycle machine près, notre grain le plus fin : elle
 * s'ouvre sur le cycle du changement d'octet, et sur lui seul. Le « couple of clocks » du
 * wiki compte en T-cycles, donc en dessous ; si blargg réclame plus large, c'est ce seul
 * chiffre qu'on élargira.
 *
 * Arbitré par `09-wave read while on` et `12-wave write while on`.
 */
describe('Wave - lire et écrire pendant que le canal joue', () => {

    /** Un octet dure deux échantillons. */
    const OCTET = 2 * PAS;

    it('waveByteIndexAt suit la position, deux échantillons par octet', () => {
        const { chan3 } = buildPlaying();

        expect(chan3.waveByteIndexAt(0), 'quartet haut du premier octet').toBe(0);
        expect(chan3.waveByteIndexAt(PAS), 'quartet bas : toujours le même octet').toBe(0);
        expect(chan3.waveByteIndexAt(OCTET), 'octet suivant').toBe(1);
        expect(chan3.waveByteIndexAt(15 * OCTET), 'le dernier').toBe(15);
        expect(chan3.waveByteIndexAt(16 * OCTET), 'et le tour est bouclé').toBe(0);
    });

    it('la fenêtre ne s\'ouvre qu\'au changement d\'octet', () => {
        const { chan3 } = buildPlaying();

        expect(chan3.isAccessingWaveAt(0), 'le canal attaque son premier octet').toBe(true);
        expect(chan3.isAccessingWaveAt(1), 'un cycle plus tard, c\'est fini').toBe(false);
        expect(chan3.isAccessingWaveAt(PAS), 'le quartet bas ne relit rien').toBe(false);
        expect(chan3.isAccessingWaveAt(OCTET), 'octet suivant : elle se rouvre').toBe(true);
        expect(chan3.isAccessingWaveAt(OCTET + 1)).toBe(false);
    });

    it('hors fenêtre, la lecture rend 0xFF', () => {
        const { machine, apu } = buildPlaying();

        machine.totalCycles = OCTET + 1;
        expect(apu.read(WAVE + 0), 'le canal joue, mais il ne touche pas la RAM').toBe(0xFF);
        expect(apu.read(WAVE + 0x0F)).toBe(0xFF);
    });

    it('dans la fenêtre, la lecture rend l\'octet COURANT, quelle que soit l\'adresse', () => {
        const { machine, apu } = buildPlaying();

        machine.totalCycles = OCTET; // le canal attaque l'octet 1
        expect(apu.read(WAVE + 0x0F), 'l\'adresse demandée est ignorée').toBe(MOTIF[1]);
        expect(apu.read(WAVE + 0x00), 'elle l\'est dans les deux sens').toBe(MOTIF[1]);
    });

    it('hors fenêtre, l\'écriture est perdue', () => {
        const { machine, apu } = buildPlaying();

        machine.totalCycles = OCTET + 1;
        apu.write(WAVE + 0x03, 0xAB);

        apu.write(NR30, 0x00); // DAC coupé : le canal s'éteint, la RAM redevient lisible
        expect(apu.read(WAVE + 0x03), 'rien n\'est passé').toBe(MOTIF[3]);
    });

    it('dans la fenêtre, l\'écriture atteint l\'octet courant', () => {
        const { machine, apu } = buildPlaying();

        machine.totalCycles = 3 * OCTET; // le canal attaque l'octet 3
        apu.write(WAVE + 0x0F, 0xAB);    // adresse ignorée, c'est l'octet 3 qui prend

        apu.write(NR30, 0x00);
        expect(apu.read(WAVE + 0x03), 'l\'octet courant a pris la valeur').toBe(0xAB);
        expect(apu.read(WAVE + 0x0F), 'celui qu\'on visait n\'a pas bougé').toBe(MOTIF[15]);
    });

    it('canal éteint, tout redevient normal', () => {
        const { machine, apu } = buildHarness();
        MOTIF.forEach((octet, i) => apu.write(WAVE + i, octet));

        machine.totalCycles = OCTET + 1; // une date qui serait hors fenêtre si ça jouait
        expect(apu.read(WAVE + 0x07), 'aucune note en cours').toBe(MOTIF[7]);
        apu.write(WAVE + 0x07, 0xAB);
        expect(apu.read(WAVE + 0x07)).toBe(0xAB);
    });
});

/**
 * LA POSITION SURVIT AU CHANGEMENT DE PÉRIODE.
 *
 * `waveStep` était une forme close sur `triggeredAt` et la période COURANTE. Écrire une
 * nouvelle fréquence ne se contentait donc pas d'accélérer la suite : elle recomptait tout
 * le temps déjà écoulé au nouveau rythme, et la position sautait.
 *
 * C'est la deuxième unité à état gardé après le sweep, et pour la même raison : ce qui
 * s'est déjà produit ne doit pas dépendre d'un réglage posé après coup. D'où la capture —
 * `_lastWaveStep` et `_lastWaveAt` — au trigger et à chaque écriture qui touche la
 * fréquence, NR33 comme NR34.
 *
 * Arbitré par `09-wave read while on`, qui pose la période MINIMALE juste après le trigger
 * avant de lire la wave RAM — la manœuvre qui rend le défaut visible.
 */
describe('Wave - la position et les changements de période', () => {

    it('changer la fréquence en vol ne réécrit pas le passé', () => {
        const { machine, apu, chan3 } = buildPlaying();
        expect(chan3.waveStep(3 * PAS), 'trois échantillons écoulés').toBe(3);

        // 0x700 : période 256, donc un échantillon tous les 128 cycles machine — deux fois
        // plus vite. Bit 7 bas : on change la fréquence sans redéclencher.
        machine.totalCycles = 3 * PAS;
        apu.write(NR34, 0x07);

        expect(chan3.waveStep(3 * PAS), 'la position ne bouge pas à l\'instant du changement').toBe(3);
        expect(chan3.waveStep(3 * PAS + 128), 'et repart d\'ici, au nouveau rythme').toBe(4);
        expect(chan3.waveStep(3 * PAS + 256)).toBe(5);
    });

    it('NR33 capture aussi : la position tient, seul le rythme change', () => {
        const { machine, apu, chan3 } = buildPlaying();
        expect(chan3.waveStep(5 * PAS)).toBe(5);

        // 0x680 : période 384, un échantillon tous les 192 cycles machine.
        machine.totalCycles = 5 * PAS;
        apu.write(NR33, 0x80);

        expect(chan3.waveStep(5 * PAS), 'la position est capturée').toBe(5);
        expect(chan3.waveStep(5 * PAS + 192), 'nouveau rythme').toBe(6);
    });

    it('réécrire la même fréquence ne fait rien sauter', () => {
        const { machine, apu, chan3 } = buildPlaying();

        machine.totalCycles = 7 * PAS;
        apu.write(NR33, FREQUENCY & 0xFF); // la valeur qui y était déjà

        expect(chan3.waveStep(7 * PAS), 'toujours la même position').toBe(7);
        expect(chan3.waveStep(8 * PAS), 'et le même rythme').toBe(8);
    });

    it('la séquence de blargg 09 : la période minimale posée juste après le trigger', () => {
        const { machine, apu, chan3 } = buildHarness();
        MOTIF.forEach((octet, i) => apu.write(WAVE + i, octet));
        apu.write(NR30, DAC_ON);
        apu.write(NR32, 1 << 5);
        apu.write(NR33, 0xDD);
        apu.write(NR34, TRIGGER | 0x07); // fréquence 0x7DD : période 35

        machine.totalCycles = 10;
        apu.write(NR33, 0xFE);           // fréquence 0x7FE : période 2

        // Dix cycles sous une période de 35, ce n'est pas même un échantillon. Les
        // recompter à la période 2 en ferait dix.
        expect(chan3.waveStep(10), 'toujours au premier échantillon').toBe(0);
        expect(chan3.waveStep(11), 'ensuite, un échantillon par cycle machine').toBe(1);
        expect(chan3.waveStep(12)).toBe(2);
    });
});
