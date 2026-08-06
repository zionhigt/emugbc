import { describe, it, expect } from 'vitest';

import buildAPU from './index';
import buildTimer from '../timer/index';

/**
 * CRAN 12b : LE GÉNÉRATEUR DE BRUIT.
 *
 * Le canal 4 n'a ni fréquence ni rouleau : à la place, un registre à décalage à
 * rétroaction — LFSR — qui débite une suite de bits pseudo-aléatoire. Tout tient dans
 * NR43 (0xFF22) :
 *
 *   bits 7-4  clock shift        décalage de la période, 0 à 15
 *   bit  3    LFSR width         0 = 15 bits (32767 crans), 1 = 7 bits (127 crans)
 *   bits 2-0  clock divider      code de diviseur, 0 à 7
 *
 * Wiki gbdev, https://gbdev.gg8.se/wiki/articles/Gameboy_sound_hardware :
 *
 *   « When clocked by the frequency timer, the low two bits (0 and 1) are XORed, all bits
 *     are shifted right by one, and the result of the XOR is put into the now-empty high
 *     bit. If width mode is 1, the XOR result is ALSO put into bit 6 AFTER the shift,
 *     resulting in a 7-bit LFSR. The waveform output is bit 0 of the LFSR, INVERTED. »
 *
 * Et dans la liste des effets du trigger, sur la même page :
 *
 *   « Noise channel's LFSR bits are all set to 1. »
 *
 * DE LA SUITE À LA FORME CLOSE. Chaque cran dépend du précédent : c'est le contraire d'un
 * rouleau qu'on peut lire à l'index voulu. Mais la suite est PÉRIODIQUE — 32767 crans en
 * mode long, 127 en mode court — et son point de départ est fixé par le trigger, toujours
 * le même. Elle ne dépend donc que du NOMBRE de décalages écoulés.
 *
 * D'où la forme visée : une table engendrée une fois pour toutes, et `lfsrStep(cycle)` qui
 * sert d'index dedans. C'est le canal 3, à ceci près que le rouleau n'est pas écrit par le
 * jeu mais calculé — et qu'il fait 32767 crans au lieu de 32. Aucune boucle à l'exécution.
 *
 * CE QUE CE CRAN NE VISE PAS. Changer le BIT DE LARGEUR en vol n'est pas modélisable
 * ainsi : le matériel garde le contenu du registre et se contente d'alimenter le bit 6 en
 * plus, alors que deux tables n'ont aucun cran en commun. Aucun test ici ne l'exige, et
 * aucune ROM de blargg ne l'arbitre. La PÉRIODE, elle, change bien en vol : c'est la même
 * règle que la position de wave, troisième application de la capture.
 */

const NR41 = 0xFF20;
const NR42 = 0xFF21;
const NR43 = 0xFF22;
const NR44 = 0xFF23;

const TRIGGER = 0x80;
const LENGTH_ENABLE = 0x40;

/** NR42 = 0xF0 : DAC alimenté, volume 15, pas d'enveloppe. */
const DAC_ON = 0xF0;

/** NR43 = 0x00 : diviseur 0 et décalage 0, soit un cran tous les 2 cycles machine. */
const PAS = 2;

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
    return { machine, apu, chan4: apu.channel4 };
};

/** Canal 4 alimenté, bruit réglé, note lancée à la date 0. */
const buildPlaying = (nr43 = 0x00, nr42 = DAC_ON) => {
    const harness = buildHarness();
    const { apu } = harness;
    apu.write(NR42, nr42);
    apu.write(NR43, nr43);
    apu.write(NR44, TRIGGER);
    return harness;
};

/**
 * Les 64 premiers bits que sort le LFSR long depuis le trigger, chiffre à chiffre.
 * Le registre part à 15 bits à 1, donc bit 0 vaut 1 et la SORTIE — inversée — vaut 0 :
 * les quinze premiers crans sont muets, le temps que les zéros entrés par le haut
 * traversent le registre.
 */
const SUITE_LONGUE =
    '000000000000000' + // 15 crans à 0 : le registre se vide par la droite
    '11111111111111' +  // 14
    '0' +
    '1111111111111' +   // 13
    '00' +
    '111111111111' +    // 12
    '0' + '1' + '0' +
    '1111';

/** Les 32 premiers du LFSR court : même départ, mais le bit 6 réinjecté raccourcit tout. */
const SUITE_COURTE =
    '0000000' +         // 7 seulement, au lieu de 15
    '111111' +
    '0' +
    '11111' +
    '00' +
    '1111' +
    '0' + '1' + '0' +
    '111' +
    '0';

/** La sortie relevée sur `count` crans, en chaîne, pour la comparer d'un coup d'œil. */
const releve = (chan4, count, pas = PAS, depuis = 0) => {
    let suite = '';
    for (let step = 0; step < count; step++) {
        suite += chan4.lfsrOutput((depuis + step) * pas);
    }
    return suite;
};

describe('Bruit - la période se lit dans NR43', () => {

    it.each([
        { nom: '0x00', nr43: 0x00, shift: 0,  divider: 0, court: false },
        { nom: '0x07', nr43: 0x07, shift: 0,  divider: 7, court: false },
        { nom: '0x08', nr43: 0x08, shift: 0,  divider: 0, court: true  },
        { nom: '0x34', nr43: 0x34, shift: 3,  divider: 4, court: false },
        { nom: '0xBD', nr43: 0xBD, shift: 11, divider: 5, court: true  },
        { nom: '0xFF', nr43: 0xFF, shift: 15, divider: 7, court: true  },
    ])('NR43 = $nom se découpe en shift $shift, divider $divider', ({ nr43, shift, divider, court }) => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR43, nr43);

        expect(chan4.clockShift, 'clockShift').toBe(shift);
        expect(chan4.clockDivider, 'clockDivider').toBe(divider);
        expect(chan4.isShortLfsr, 'isShortLfsr').toBe(court);
    });

    /**
     * Le wiki donne les diviseurs en T-cycles — 8, 16, 32, 48, 64, 80, 96, 112 — et la
     * période vaut `divisor << shift`. Ici tout est en cycles machine, donc le quart :
     * 2 pour le code 0, puis 4 par unité de code.
     */
    it.each([
        { nom: '0x00', nr43: 0x00, period: 2 },
        { nom: '0x01', nr43: 0x01, period: 4 },
        { nom: '0x03', nr43: 0x03, period: 12 },
        { nom: '0x07', nr43: 0x07, period: 28 },
        { nom: '0x10', nr43: 0x10, period: 4 },
        { nom: '0x23', nr43: 0x23, period: 48 },
        { nom: '0x34', nr43: 0x34, period: 128 },
        { nom: '0x08', nr43: 0x08, period: 2 },
    ])('NR43 = $nom donne une période de $period cycles machine', ({ nr43, period }) => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR43, nr43);
        expect(chan4.period).toBe(period);
    });

    it('le bit de largeur ne touche pas à la période', () => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR43, 0x34);
        expect(chan4.period).toBe(128);
        apu.write(NR43, 0x3C); // le même, mode court
        expect(chan4.period, 'seul le bit 3 a bougé').toBe(128);
    });

    it('NR44 ne porte aucun bit de fréquence', () => {
        const { apu, chan4 } = buildPlaying(0x34);
        expect(chan4.period).toBe(128);

        apu.write(NR44, LENGTH_ENABLE | 0x07); // ces trois bits sont la fréquence ailleurs
        expect(chan4.period, 'ici ils ne veulent rien dire').toBe(128);
    });
});

describe('Bruit - le compteur de décalages', () => {

    it('il part de zéro au trigger', () => {
        const { chan4 } = buildPlaying();
        expect(chan4.lfsrStep(0)).toBe(0);
    });

    it('un décalage par période, et la frontière est exacte', () => {
        const { chan4 } = buildPlaying();
        expect(chan4.lfsrStep(PAS - 1), 'un cycle trop tôt').toBe(0);
        expect(chan4.lfsrStep(PAS), 'pile').toBe(1);
        expect(chan4.lfsrStep(2 * PAS)).toBe(2);
        expect(chan4.lfsrStep(15 * PAS)).toBe(15);
    });

    it('une période plus lente ralentit d\'autant', () => {
        const { chan4 } = buildPlaying(0x34); // période 128
        expect(chan4.lfsrStep(127), 'un cycle trop tôt').toBe(0);
        expect(chan4.lfsrStep(128)).toBe(1);
        expect(chan4.lfsrStep(10 * 128)).toBe(10);
    });

    it('c\'est un compteur, pas une position : il ne reboucle pas', () => {
        const { chan4 } = buildPlaying();
        expect(chan4.lfsrStep(32767 * PAS), 'le tour de la suite longue').toBe(32767);
        expect(chan4.lfsrStep(40000 * PAS)).toBe(40000);
    });

    it('le trigger le remet à zéro', () => {
        const { machine, apu, chan4 } = buildPlaying();
        expect(chan4.lfsrStep(20 * PAS)).toBe(20);

        machine.totalCycles = 20 * PAS;
        apu.write(NR44, TRIGGER);

        expect(chan4.lfsrStep(20 * PAS), 'repart de zéro').toBe(0);
        expect(chan4.lfsrStep(21 * PAS), 'et compte depuis là').toBe(1);
    });
});

describe('Bruit - la suite du LFSR long', () => {

    it('les quinze premiers crans sont muets', () => {
        const { chan4 } = buildPlaying();
        for (let step = 0; step < 15; step++) {
            expect(chan4.lfsrOutput(step * PAS), `cran ${step}`).toBe(0);
        }
        expect(chan4.lfsrOutput(15 * PAS), 'le premier bit haut').toBe(1);
    });

    it('les 64 premiers bits sont ceux du matériel', () => {
        const { chan4 } = buildPlaying();
        expect(releve(chan4, 64)).toBe(SUITE_LONGUE);
    });

    it('la sortie tient entre deux décalages', () => {
        const { chan4 } = buildPlaying(0x34); // période 128
        for (let offset = 0; offset < 128; offset++) {
            expect(chan4.lfsrOutput(15 * 128 + offset), `offset ${offset}`).toBe(1);
        }
        expect(chan4.lfsrOutput(16 * 128), 'le cran suivant').toBe(1);
        expect(chan4.lfsrOutput(29 * 128), 'et le zéro isolé du cran 29').toBe(0);
    });

    it('la suite reboucle après 32767 crans', () => {
        const { chan4 } = buildPlaying();
        expect(releve(chan4, 20, PAS, 32767), 'le tour est bouclé').toBe(SUITE_LONGUE.slice(0, 20));
        expect(chan4.lfsrOutput(32766 * PAS), 'le cran d\'avant, lui, est haut').toBe(1);
    });

    it('le trigger renvoie la suite à son début', () => {
        const { machine, apu, chan4 } = buildPlaying();
        expect(chan4.lfsrOutput(20 * PAS), 'en plein régime').toBe(1);

        machine.totalCycles = 20 * PAS;
        apu.write(NR44, TRIGGER);

        expect(releve(chan4, 20, PAS, 20), 'les quinze crans muets reviennent')
            .toBe(SUITE_LONGUE.slice(0, 20));
    });
});

describe('Bruit - la suite du LFSR court', () => {

    it('sept crans muets au lieu de quinze', () => {
        const { chan4 } = buildPlaying(0x08);
        for (let step = 0; step < 7; step++) {
            expect(chan4.lfsrOutput(step * PAS), `cran ${step}`).toBe(0);
        }
        expect(chan4.lfsrOutput(7 * PAS), 'le premier bit haut, huit crans plus tôt').toBe(1);
    });

    it('les 32 premiers bits sont ceux du matériel', () => {
        const { chan4 } = buildPlaying(0x08);
        expect(releve(chan4, 32)).toBe(SUITE_COURTE);
    });

    it('elle reboucle après 127 crans, pas 32767', () => {
        const { chan4 } = buildPlaying(0x08);
        expect(releve(chan4, 20, PAS, 127), 'le tour est bouclé').toBe(SUITE_COURTE.slice(0, 20));
        expect(chan4.lfsrOutput(126 * PAS), 'le cran d\'avant est haut').toBe(1);
    });

    it('les deux modes divergent dès le huitième cran', () => {
        const long = buildPlaying(0x00).chan4;
        const court = buildPlaying(0x08).chan4;

        expect(releve(court, 7), 'jusque-là, identiques').toBe(releve(long, 7));
        expect(court.lfsrOutput(7 * PAS)).toBe(1);
        expect(long.lfsrOutput(7 * PAS)).toBe(0);
    });
});

/**
 * LA PÉRIODE CHANGE EN VOL, LA SUITE NE SE RÉÉCRIT PAS.
 *
 * Même règle que la position de wave, pour la même raison : les crans déjà passés l'ont
 * été à l'ANCIENNE période, et un réglage posé après coup ne peut pas les recompter. Donc
 * capture — `_lastLfsrStep` et `_lastLfsrAt` — au trigger et à chaque écriture de NR43.
 */
describe('Bruit - NR43 écrit en vol', () => {

    it('changer le décalage ne réécrit pas le passé', () => {
        const { machine, apu, chan4 } = buildPlaying(); // période 2
        expect(chan4.lfsrStep(20 * PAS), 'vingt crans écoulés').toBe(20);

        machine.totalCycles = 20 * PAS;
        apu.write(NR43, 0x30); // décalage 3, diviseur 0 : période 16

        expect(chan4.lfsrStep(20 * PAS), 'le compteur ne bouge pas').toBe(20);
        expect(chan4.lfsrStep(20 * PAS + 16), 'et repart d\'ici, au nouveau rythme').toBe(21);
        expect(chan4.lfsrStep(20 * PAS + 32)).toBe(22);
    });

    it('changer le diviseur capture aussi', () => {
        const { machine, apu, chan4 } = buildPlaying();

        machine.totalCycles = 9 * PAS;
        apu.write(NR43, 0x02); // diviseur 2, décalage 0 : période 8

        expect(chan4.lfsrStep(9 * PAS), 'la position est capturée').toBe(9);
        expect(chan4.lfsrStep(9 * PAS + 8), 'nouveau rythme').toBe(10);
    });

    it('réécrire la même valeur ne fait rien sauter', () => {
        const { machine, apu, chan4 } = buildPlaying();

        machine.totalCycles = 30 * PAS;
        apu.write(NR43, 0x00); // la valeur qui y était déjà

        expect(chan4.lfsrStep(30 * PAS), 'toujours le même cran').toBe(30);
        expect(chan4.lfsrStep(31 * PAS), 'et le même rythme').toBe(31);
    });

    it('la suite continue là où elle en était', () => {
        const { machine, apu, chan4 } = buildPlaying();

        machine.totalCycles = 20 * PAS;
        apu.write(NR43, 0x30); // période 16

        // Cran 29 : l'unique zéro entre les deux longues plages de uns.
        expect(chan4.lfsrOutput(20 * PAS + 9 * 16), 'le zéro isolé tombe au bon cran').toBe(0);
        expect(chan4.lfsrOutput(20 * PAS + 10 * 16)).toBe(1);
    });
});

describe('Bruit - l\'amplitude', () => {

    it('la sortie est mise à l\'échelle du volume', () => {
        expect(buildPlaying(0x00, 0xF0).chan4.amplitude(15 * PAS), 'volume 15').toBe(15);
        expect(buildPlaying(0x00, 0x50).chan4.amplitude(15 * PAS), 'volume 5').toBe(5);
    });

    it('un cran muet ne sort rien, quel que soit le volume', () => {
        const { chan4 } = buildPlaying();
        expect(chan4.amplitude(0), 'le premier cran est bas').toBe(0);
        expect(chan4.amplitude(14 * PAS)).toBe(0);
    });

    it('DAC coupé, rien ne sort', () => {
        const { apu, chan4 } = buildPlaying();
        apu.write(NR42, 0x00);
        expect(chan4.amplitude(15 * PAS), 'le cran vaut pourtant 1').toBe(0);
    });

    it('canal non déclenché, rien ne sort', () => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR42, DAC_ON);
        apu.write(NR43, 0x00); // pas de trigger

        expect(chan4.amplitude(15 * PAS)).toBe(0);
    });

    it('la longueur à sec coupe la sortie', () => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR41, 0x3F); // un cran de longueur
        apu.write(NR42, DAC_ON);
        apu.write(NR43, 0x00);
        apu.write(NR44, TRIGGER | LENGTH_ENABLE);

        const TIC = 2048;
        expect(chan4.amplitude(15 * PAS), 'avant la cloche').toBe(15);
        expect(chan4.amplitude(TIC), 'après le premier coup, à sec').toBe(0);
    });
});
