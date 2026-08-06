import { describe, it, expect } from 'vitest';

import buildAPU from './index';
import buildTimer from '../timer/index';

/**
 * CRAN 13 : LE MIXAGE.
 *
 * Les quatre voix rendent chacune une amplitude de 0 à 15 par `amplitude(cycle)`. Ce cran
 * pose ce qui les assemble en deux sorties, et rien d'autre : NR51 route, NR50 dose.
 *
 * NR51 (0xFF25) est une BAIE DE BRASSAGE — huit interrupteurs indépendants :
 *
 *   bit 0  canal 1 à droite      bit 4  canal 1 à gauche
 *   bit 1  canal 2 à droite      bit 5  canal 2 à gauche
 *   bit 2  canal 3 à droite      bit 6  canal 3 à gauche
 *   bit 3  canal 4 à droite      bit 7  canal 4 à gauche
 *
 * NR50 (0xFF24) est DEUX FADERS, trois bits chacun — bits 6-4 à gauche, bits 2-0 à droite —
 * plus deux bits VIN (7 et 3) que rien ne pilote sur une cartouche commerciale.
 *
 * Pandocs, « Master volume & VIN panning » :
 *
 *   « A value of 0 is treated as a volume of 1 (very quiet), and a value of 7 is treated as
 *     a volume of 8 (no volume reduction). Importantly, the amplifier never mutes a
 *     non-silent input. »
 *
 * D'où le piège de ce cran : le volume 0 N'EST PAS le silence. Le facteur vaut
 * `volume + 1`, huit crans de 1 à 8, et le plus bas laisse encore passer un huitième du
 * signal. Couper, c'est l'affaire de NR51 seul.
 *
 * CE QUE CE CRAN NE VISE PAS. Le vrai DAC est analogique : une amplitude de 0 n'y vaut pas
 * zéro volt mais une extrémité de l'échelle, d'où une composante continue qu'un passe-haut
 * doit manger, et le « pop » qu'on entend quand un DAC s'éteint. On reste ici en numérique,
 * entiers de 0 à 480 ; le filtre appartiendra au front qui produira le son.
 */

const NR50 = 0xFF24;
const NR51 = 0xFF25;
const NR52 = 0xFF26;

/**
 * Les quatre voix sont réglées pour rendre 1, 2, 4 et 8 — les quatre bits d'un chiffre
 * hexadécimal. Toute somme lue dans un test nomme donc sans ambiguïté les canaux qui y
 * sont entrés : 5 c'est 1 et 3, 9 c'est 1 et 4, 15 c'est les quatre.
 */
const VOIX = { chan1: 1, chan2: 2, chan3: 4, chan4: 8 };
const TOUTES = 15;

/**
 * Date de mesure. Les deux canaux pulse tiennent leur premier cran de duty jusqu'à 2047,
 * le canal 3 lit une wave uniforme donc ne bouge jamais — mais le canal 4 sort ses quinze
 * premiers crans à zéro. Sa plage haute suivante couvre les cycles 30 à 57 : on mesure à
 * l'entrée de celle-ci, où les quatre voix valent enfin 1, 2, 4 et 8 ensemble.
 */
const T = 30;

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
    return { machine, apu };
};

/** Les quatre voix lancées à la date 0, chacune sur son amplitude repère. */
const buildMixing = () => {
    const harness = buildHarness();
    const { apu } = harness;

    apu.write(0xFF10, 0x00); // pas de sweep
    apu.write(0xFF11, 0x80); // duty 2
    apu.write(0xFF12, 0x10); // volume 1
    apu.write(0xFF13, 0x00); // fréquence 0 : période 2048
    apu.write(0xFF14, 0x80);

    apu.write(0xFF16, 0x80);
    apu.write(0xFF17, 0x20); // volume 2
    apu.write(0xFF18, 0x00);
    apu.write(0xFF19, 0x80);

    // wave uniforme à 4 : semée avant le trigger, sinon l'écriture serait redirigée
    for (let i = 0; i < 16; i++) apu.write(0xFF30 + i, 0x44);
    apu.write(0xFF1A, 0x80); // DAC
    apu.write(0xFF1C, 0x20); // niveau 1 : pleine échelle
    apu.write(0xFF1D, 0x00);
    apu.write(0xFF1E, 0x80);

    apu.write(0xFF21, 0x80); // volume 8
    apu.write(0xFF22, 0x00); // bruit le plus rapide
    apu.write(0xFF23, 0x80);

    return harness;
};

describe('Mixage - NR50, les deux faders', () => {

    it.each([
        { nom: '0x00', nr50: 0x00, gauche: 1, droite: 1 },
        { nom: '0x77', nr50: 0x77, gauche: 8, droite: 8 },
        { nom: '0x34', nr50: 0x34, gauche: 4, droite: 5 },
        { nom: '0x07', nr50: 0x07, gauche: 1, droite: 8 },
        { nom: '0x70', nr50: 0x70, gauche: 8, droite: 1 },
    ])('NR50 = $nom donne les facteurs $gauche et $droite', ({ nr50, gauche, droite }) => {
        const { apu } = buildHarness();
        apu.write(NR50, nr50);

        expect(apu.leftVolume, 'leftVolume').toBe(gauche);
        expect(apu.rightVolume, 'rightVolume').toBe(droite);
    });

    it('trois bits à zéro valent un facteur de UN, pas de zéro', () => {
        const { apu } = buildHarness();
        apu.write(NR50, 0x00);
        expect(apu.leftVolume, 'le cran le plus bas laisse passer').toBe(1);
        expect(apu.rightVolume).toBe(1);
    });

    it('les deux bits VIN ne changent aucun facteur', () => {
        const { apu } = buildHarness();
        apu.write(NR50, 0x34);
        expect([apu.leftVolume, apu.rightVolume]).toEqual([4, 5]);

        apu.write(NR50, 0x34 | 0x88); // les deux VIN levés par-dessus
        expect([apu.leftVolume, apu.rightVolume], 'rien n\'a bougé').toEqual([4, 5]);
    });
});

describe('Mixage - NR51, la baie de brassage', () => {

    it.each([
        { nom: 'bit 0', nr51: 0x01, canal: 1, cote: 'droite' },
        { nom: 'bit 1', nr51: 0x02, canal: 2, cote: 'droite' },
        { nom: 'bit 2', nr51: 0x04, canal: 3, cote: 'droite' },
        { nom: 'bit 3', nr51: 0x08, canal: 4, cote: 'droite' },
        { nom: 'bit 4', nr51: 0x10, canal: 1, cote: 'gauche' },
        { nom: 'bit 5', nr51: 0x20, canal: 2, cote: 'gauche' },
        { nom: 'bit 6', nr51: 0x40, canal: 3, cote: 'gauche' },
        { nom: 'bit 7', nr51: 0x80, canal: 4, cote: 'gauche' },
    ])('$nom route le canal $canal vers la $cote, et lui seul', ({ nr51, canal, cote }) => {
        const { apu } = buildHarness();
        apu.write(NR51, nr51);

        for (let n = 1; n <= 4; n++) {
            expect(apu.isRoutedLeft(n), `canal ${n} à gauche`)
                .toBe(n === canal && cote === 'gauche');
            expect(apu.isRoutedRight(n), `canal ${n} à droite`)
                .toBe(n === canal && cote === 'droite');
        }
    });

    it('une voie peut aller des deux côtés à la fois', () => {
        const { apu } = buildHarness();
        apu.write(NR51, 0x11); // canal 1, les deux bits

        expect(apu.isRoutedLeft(1)).toBe(true);
        expect(apu.isRoutedRight(1)).toBe(true);
    });

    it('NR51 à zéro ne route rien nulle part', () => {
        const { apu } = buildHarness();
        apu.write(NR51, 0x00);

        for (let n = 1; n <= 4; n++) {
            expect(apu.isRoutedLeft(n), `canal ${n}`).toBe(false);
            expect(apu.isRoutedRight(n), `canal ${n}`).toBe(false);
        }
    });
});

describe('Mixage - la somme des voies routées', () => {

    it('les quatre voix rendent bien leurs amplitudes repères', () => {
        const { apu } = buildMixing();
        expect(apu.channel1.amplitude(T), 'canal 1').toBe(VOIX.chan1);
        expect(apu.channel2.amplitude(T), 'canal 2').toBe(VOIX.chan2);
        expect(apu.channel3.amplitude(T), 'canal 3').toBe(VOIX.chan3);
        expect(apu.channel4.amplitude(T), 'canal 4').toBe(VOIX.chan4);
    });

    /** Facteurs à 1 des deux côtés : la somme se lit à nu. */
    it.each([
        { nom: '0x00', nr51: 0x00, gauche: 0,  droite: 0 },
        { nom: '0x10', nr51: 0x10, gauche: 1,  droite: 0 },
        { nom: '0x20', nr51: 0x20, gauche: 2,  droite: 0 },
        { nom: '0x40', nr51: 0x40, gauche: 4,  droite: 0 },
        { nom: '0x80', nr51: 0x80, gauche: 8,  droite: 0 },
        { nom: '0x0F', nr51: 0x0F, gauche: 0,  droite: 15 },
        { nom: '0xF0', nr51: 0xF0, gauche: 15, droite: 0 },
        { nom: '0x59', nr51: 0x59, gauche: 5,  droite: 9 },
        { nom: '0xFF', nr51: 0xFF, gauche: 15, droite: 15 },
    ])('NR51 = $nom mélange $gauche à gauche et $droite à droite', ({ nr51, gauche, droite }) => {
        const { apu } = buildMixing();
        apu.write(NR50, 0x00); // facteur 1 partout
        apu.write(NR51, nr51);

        expect(apu.sample(T)).toEqual({ left: gauche, right: droite });
    });

    it('le fader multiplie la somme, côté par côté', () => {
        const { apu } = buildMixing();
        apu.write(NR51, 0xFF);
        apu.write(NR50, 0x70); // gauche 8, droite 1

        expect(apu.sample(T)).toEqual({ left: 8 * TOUTES, right: TOUTES });
    });

    it('le maximum absolu : quatre voies pleines, faders au bout', () => {
        const { apu } = buildHarness();
        // les quatre à 15 cette fois, pas les amplitudes repères
        apu.write(0xFF11, 0x80); apu.write(0xFF12, 0xF0); apu.write(0xFF14, 0x80);
        apu.write(0xFF16, 0x80); apu.write(0xFF17, 0xF0); apu.write(0xFF19, 0x80);
        for (let i = 0; i < 16; i++) apu.write(0xFF30 + i, 0xFF);
        apu.write(0xFF1A, 0x80); apu.write(0xFF1C, 0x20); apu.write(0xFF1E, 0x80);
        apu.write(0xFF21, 0xF0); apu.write(0xFF22, 0x00); apu.write(0xFF23, 0x80);
        apu.write(NR50, 0x77);
        apu.write(NR51, 0xFF);

        expect(apu.sample(T), '4 voix x 15, x 8').toEqual({ left: 480, right: 480 });
    });

    it('le volume 0 n\'est pas le silence', () => {
        const { apu } = buildMixing();
        apu.write(NR51, 0xFF);
        apu.write(NR50, 0x00);

        expect(apu.sample(T), 'un huitième, pas rien').toEqual({ left: TOUTES, right: TOUTES });
    });

    it('seul NR51 coupe vraiment', () => {
        const { apu } = buildMixing();
        apu.write(NR50, 0x77); // faders au maximum
        apu.write(NR51, 0x00);

        expect(apu.sample(T)).toEqual({ left: 0, right: 0 });
    });
});

describe('Mixage - ce qui n\'arrive jamais au mixeur', () => {

    it('un DAC coupé retire sa part de la somme', () => {
        const { apu } = buildMixing();
        apu.write(NR50, 0x00);
        apu.write(NR51, 0xFF);
        expect(apu.sample(T).left, 'les quatre').toBe(TOUTES);

        apu.write(0xFF1A, 0x00); // DAC du canal 3
        expect(apu.sample(T).left, 'moins le canal 3').toBe(TOUTES - VOIX.chan3);
    });

    it('un canal jamais déclenché ne pèse rien, même routé', () => {
        const { apu } = buildHarness();
        apu.write(0xFF17, 0xF0); // canal 2 alimenté mais sans trigger
        apu.write(NR50, 0x77);
        apu.write(NR51, 0xFF);

        expect(apu.sample(T)).toEqual({ left: 0, right: 0 });
    });

    /**
     * Le canal 3 est le seul dont l'amplitude ne dépend pas de la date — sa wave est
     * uniforme. C'est donc la seule voix qui isole proprement l'effet du minuteur : ce qui
     * tombe entre les deux mesures ne peut être que lui, et ne peut être que la longueur.
     */
    it('une longueur à sec retire sa part', () => {
        const { apu } = buildMixing();
        apu.write(NR50, 0x00);
        apu.write(NR51, 0x44); // le canal 3 seul, des deux côtés

        apu.write(0xFF1B, 0xFF);        // NR31 : 256 - 255, un seul cran
        apu.write(0xFF1E, 0x80 | 0x40); // relancé, longueur branchée

        const TIC = 2048;
        expect(apu.sample(T), 'avant la cloche').toEqual({ left: VOIX.chan3, right: VOIX.chan3 });
        expect(apu.sample(TIC), 'le minuteur est à sec').toEqual({ left: 0, right: 0 });
    });
});

describe('Mixage - l\'extinction', () => {

    it('APU éteint, les deux sorties sont muettes', () => {
        const { apu } = buildMixing();
        apu.write(NR50, 0x77);
        apu.write(NR51, 0xFF);
        expect(apu.sample(T).left, 'ça jouait').toBe(8 * TOUTES);

        apu.write(NR52, 0x00);
        expect(apu.sample(T)).toEqual({ left: 0, right: 0 });
    });

    it('rallumer ne ressuscite ni les voies ni le routage', () => {
        const { apu } = buildMixing();
        apu.write(NR51, 0xFF);
        apu.write(NR52, 0x00);
        apu.write(NR52, 0x80);

        expect(apu.read(NR51), 'la baie est restée à zéro').toBe(0x00);
        expect(apu.sample(T)).toEqual({ left: 0, right: 0 });
    });
});

/**
 * Le mixeur est daté comme tout le reste de l'APU : on lui demande l'état du son à une
 * date, il ne « tourne » pas. Le canal 4 le montre le mieux — ses quinze premiers crans
 * sont muets, donc la même console rend deux sommes différentes selon l'instant visé.
 */
describe('Mixage - la sortie est datée', () => {

    it('la même console rend des sommes différentes selon la date', () => {
        const { apu } = buildMixing();
        apu.write(NR50, 0x00);
        apu.write(NR51, 0xFF);

        expect(apu.sample(0).left, 'le bruit est encore muet')
            .toBe(VOIX.chan1 + VOIX.chan2 + VOIX.chan3);
        expect(apu.sample(T).left, 'il a rejoint les autres').toBe(TOUTES);
        expect(apu.sample(2048).left, 'les deux pulse ont changé de cran').toBe(VOIX.chan3);
    });
});
