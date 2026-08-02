import { describe, it, expect } from 'vitest';

import buildAPU from './index';
import buildTimer from '../timer/index';

/**
 * CRAN 5 : LE LENGTH COUNTER.
 *
 * Un minuteur de cuisson. On le remonte en écrivant NR21, la cloche longueur du carillon
 * le fait tourner d'un cran (256 Hz), et à zéro il coupe le canal.
 *
 * Deux inversions à garder en tête :
 *   - la valeur écrite est un RETRAIT, pas une durée : le compteur part de 64 - valeur ;
 *   - NR24 bit 6 (length enable) relie le minuteur au four. Baissé, le minuteur ne tourne
 *     pas du tout et la note joue indéfiniment.
 *
 * Ce cran ne couvre PAS le « extra length clocking » — le cran supplémentaire que le
 * matériel donne quand on lève le bit 6 au milieu d'une période de longueur. C'est une
 * bizarrerie que blargg `02-len ctr` arbitre, et elle attendra son propre cran.
 */

const TIC = 2048;        // un tic de carillon, en cycles machine
const CLOCHE = 2 * TIC;  // la cloche longueur sonne un tic sur deux : 4096 cycles machine

const TRIGGER = 0x80;
const LENGTH_ENABLE = 0x40;

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

/** Un canal alimenté, volume 15, pochoir 3 (6 picots sur 8) — prêt à être déclenché. */
const buildPlayable = () => {
    const harness = buildHarness();
    harness.chan.NR1.setValue(0xC0); // pochoir 3, minuteur à 0 donc compteur à 64
    harness.chan.NR2.setValue(0xF0); // DAC alimenté, volume 15
    return harness;
};

describe('Minuteur - le remonter', () => {

    it.each([
        { ecrit: 0x00, reste: 64 },
        { ecrit: 0x01, reste: 63 },
        { ecrit: 0x20, reste: 32 },
        { ecrit: 0x3E, reste: 2 },
        { ecrit: 0x3F, reste: 1 },
    ])('NR21 = $ecrit remonte le minuteur à $reste crans', ({ ecrit, reste }) => {
        const { chan } = buildHarness();
        chan.NR1.setValue(ecrit);
        expect(chan.lengthRemaining(0)).toBe(reste);
    });

    it('les bits de duty ne perturbent pas le remontage', () => {
        const { chan } = buildHarness();
        chan.NR1.setValue(0xC1); // pochoir 3 ET retrait de 1
        expect(chan.duty, 'le pochoir est bien passé').toBe(3);
        expect(chan.lengthRemaining(0), 'et le minuteur aussi').toBe(63);
    });

    it('écrire NR21 remonte le minuteur même sans déclencher', () => {
        const { chan } = buildHarness();
        chan.NR1.setValue(0x3C); // retrait de 60
        expect(chan.isEnabled, 'aucune note ne joue').toBe(false);
        expect(chan.lengthRemaining(0), 'le minuteur est pourtant remonté').toBe(4);
    });
});

describe('Minuteur - l\'interrupteur du four (NR24 bit 6)', () => {

    it('isLengthEnabled suit le bit 6 de NR24', () => {
        const { chan } = buildHarness();
        expect(chan.isLengthEnabled, 'au repos').toBe(false);
        chan.NR4.setValue(LENGTH_ENABLE);
        expect(chan.isLengthEnabled).toBe(true);
        chan.NR4.setValue(0x00);
        expect(chan.isLengthEnabled).toBe(false);
    });

    it('le trigger n\'allume pas l\'interrupteur tout seul', () => {
        const { chan } = buildPlayable();
        chan.NR4.setValue(TRIGGER);
        expect(chan.isLengthEnabled, 'bit 7 levé, bit 6 non').toBe(false);
    });
});

describe('Minuteur - il tourne', () => {

    /** Minuteur à 4 crans, four relié, note lancée à la date 0. */
    const buildCounting = () => {
        const harness = buildPlayable();
        harness.chan.NR1.setValue(0xC0 | 0x3C); // pochoir 3, retrait 60, donc 4 crans
        harness.chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);
        return harness;
    };

    it('un cran par coup de cloche', () => {
        const { chan } = buildCounting();
        expect(chan.lengthRemaining(0), 'au départ').toBe(4);
        expect(chan.lengthRemaining(CLOCHE), 'première cloche').toBe(3);
        expect(chan.lengthRemaining(2 * CLOCHE), 'deuxième').toBe(2);
        expect(chan.lengthRemaining(3 * CLOCHE), 'troisième').toBe(1);
        expect(chan.lengthRemaining(4 * CLOCHE), 'quatrième : à sec').toBe(0);
    });

    it('il ne bouge pas entre deux cloches', () => {
        const { chan } = buildCounting();
        expect(chan.lengthRemaining(CLOCHE - 1), 'un cycle avant la cloche').toBe(4);
        expect(chan.lengthRemaining(CLOCHE), 'et à la cloche pile').toBe(3);
    });

    it('il ne descend jamais sous zéro', () => {
        const { chan } = buildCounting();
        expect(chan.lengthRemaining(100 * CLOCHE), 'longtemps après la fin').toBe(0);
    });

    it('four débranché, le minuteur ne tourne pas du tout', () => {
        const { chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3C); // 4 crans
        chan.NR4.setValue(TRIGGER);     // sans le bit 6

        expect(chan.lengthRemaining(0)).toBe(4);
        expect(chan.lengthRemaining(10 * CLOCHE), 'figé, aucune cloche ne l\'atteint').toBe(4);
    });
});

describe('Minuteur - il coupe la note', () => {

    const buildCounting = () => {
        const harness = buildPlayable();
        harness.chan.NR1.setValue(0xC0 | 0x3C); // 4 crans
        harness.chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);
        return harness;
    };

    it('la note tient jusqu\'au dernier cran, puis s\'arrête', () => {
        const { chan } = buildCounting();
        expect(chan.isEnabledAt(0), 'la note démarre').toBe(true);
        expect(chan.isEnabledAt(3 * CLOCHE), 'il reste un cran, ça joue encore').toBe(true);
        expect(chan.isEnabledAt(4 * CLOCHE), 'minuteur à sec : coupé').toBe(false);
        expect(chan.isEnabledAt(50 * CLOCHE), 'et ça ne revient pas tout seul').toBe(false);
    });

    it('amplitude tombe en même temps que la note', () => {
        const { chan } = buildCounting();
        const period = chan.period;
        // pochoir 3, volume 15 : le cran 1 du rouleau porte un picot
        expect(chan.amplitude(period), 'avant la fin, le signal sort').toBe(15);
        expect(chan.amplitude(4 * CLOCHE + period), 'après la fin, plus rien').toBe(0);
    });

    it('le rouleau continue de tourner sous une note éteinte', () => {
        const { chan } = buildCounting();
        const date = 4 * CLOCHE + 5 * chan.period;
        expect(chan.dutyStep(date), 'la manivelle ne s\'arrête jamais').toBe(5);
        expect(chan.amplitude(date), 'mais rien ne sort').toBe(0);
    });

    it('four débranché, la note ne s\'arrête jamais', () => {
        const { chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3F); // un seul cran
        chan.NR4.setValue(TRIGGER);     // sans le bit 6
        expect(chan.isEnabledAt(1000 * CLOCHE), 'aucun minuteur ne la coupe').toBe(true);
    });

    it('isEnabled sans date répond pour l\'heure courante', () => {
        const { machine, chan } = buildCounting();
        machine.totalCycles = 3 * CLOCHE;
        expect(chan.isEnabled, 'il reste un cran').toBe(true);

        machine.totalCycles = 4 * CLOCHE;
        expect(chan.isEnabled, 'minuteur à sec').toBe(false);
    });
});

describe('Minuteur - le trigger le remonte, mais seulement à sec', () => {

    it('déclencher un minuteur à sec le remonte au maximum', () => {
        const { machine, chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3F); // un seul cran
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);
        expect(chan.lengthRemaining(CLOCHE), 'à sec après une cloche').toBe(0);

        machine.totalCycles = CLOCHE;
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);
        expect(chan.lengthRemaining(CLOCHE), 'remonté à fond, pas à 1').toBe(64);
        expect(chan.isEnabledAt(CLOCHE), 'et la note repart').toBe(true);
    });

    it('déclencher un minuteur encore plein ne le remonte pas', () => {
        const { machine, chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3C); // 4 crans
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);
        expect(chan.lengthRemaining(2 * CLOCHE), 'deux crans consommés').toBe(2);

        machine.totalCycles = 2 * CLOCHE;
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);
        expect(chan.lengthRemaining(2 * CLOCHE), 'il reprend là où il en était').toBe(2);
        expect(chan.lengthRemaining(3 * CLOCHE), 'et repart de là').toBe(1);
    });
});
