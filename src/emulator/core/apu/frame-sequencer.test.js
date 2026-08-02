import { describe, it, expect } from 'vitest';

import buildAPU from './index';
import buildTimer from '../timer/index';

/**
 * CRAN 3 : LE CARILLON.
 *
 * Un métronome à 512 Hz — un tic tous les 2048 cycles machine — qui tourne sur 8
 * positions. À chaque position il frappe certaines cloches :
 *
 *     position     0   1   2   3   4   5   6   7
 *     longueur     x       x       x       x        256 Hz
 *     sweep                x               x        128 Hz
 *     enveloppe                                x     64 Hz
 *
 * Il n'a pas d'horloge à lui : il est monté sur le bit 4 de DIV, donc sur le MÊME
 * compteur 16 bits que le timer. D'où le comportement que ce fichier vérifie en dernier,
 * et qui est toute la raison d'être de ce montage : écrire dans DIV décale le son.
 *
 * CONVENTION, arbitrée par l'oracle le 2026-08-02 :
 *
 *   - le tic n° k tombe sur la position `(k - 1) % 8` : le PREMIER tic tombe SUR la
 *     position 0. Donc la première cloche de longueur sonne au tic 1, le premier sweep
 *     au tic 3, la première enveloppe au tic 8 ;
 *   - les compteurs de cloches comptent les COUPS DÉJÀ FRAPPÉS depuis la dernière remise
 *     à zéro du compteur, pas les positions traversées.
 *
 * On avait d'abord posé l'autre phase à l'aveugle — tic k sur la position `k % 8`, donc
 * première cloche au tic 2. L'essai comparatif sur les 12 ROMs a tranché : avec celle-ci,
 * `07-len sweep period sync` — la ROM faite pour arbitrer cette phase — passe de 35 à 46
 * trames, `05-sweep details` gagne une trame, et aucune ne régresse.
 */

const DIV = 0xFF04;

/** Un tic de carillon, en cycles machine : 1048576 / 512. */
const TIC = 2048;

/** Une seconde machine. */
const SECONDE = 1048576;

const buildHarness = () => {
    const machine = {
        totalCycles: 0,
        timer: null,
        memory: { _read: () => 0xFF, _write: () => {} },
    };
    const Timer = buildTimer(machine);
    machine.timer = new Timer();

    const APU = buildAPU(machine);
    return { machine, timer: machine.timer, apu: new APU() };
};

describe('Carillon - le tic à 512 Hz', () => {

    it('rien n\'a sonné à l\'origine', () => {
        const { apu } = buildHarness();
        expect(apu.frameTicks(0)).toBe(0);
    });

    it('un tic tous les 2048 cycles machine, et la frontière est exacte', () => {
        const { apu } = buildHarness();
        expect(apu.frameTicks(TIC - 1), 'un cycle avant le premier tic').toBe(0);
        expect(apu.frameTicks(TIC), 'le premier tic, pile').toBe(1);
        expect(apu.frameTicks(2 * TIC - 1), 'un cycle avant le deuxième').toBe(1);
        expect(apu.frameTicks(2 * TIC), 'le deuxième').toBe(2);
    });

    it('les tics s\'accumulent sans se remettre à zéro au bout d\'un tour', () => {
        const { apu } = buildHarness();
        expect(apu.frameTicks(8 * TIC), 'un tour complet du carillon').toBe(8);
        expect(apu.frameTicks(9 * TIC), 'et le compteur continue').toBe(9);
        expect(apu.frameTicks(100 * TIC)).toBe(100);
    });

    it('512 tics par seconde machine : c\'est la définition du frame sequencer', () => {
        const { apu } = buildHarness();
        expect(apu.frameTicks(SECONDE)).toBe(512);
    });

    it('interroger le carillon ne fait rien avancer', () => {
        const { machine, apu } = buildHarness();
        apu.frameTicks(50 * TIC);
        apu.frameStep(50 * TIC);
        expect(machine.totalCycles, 'l\'horloge n\'a pas bougé').toBe(0);
        expect(apu.frameTicks(0), 'et la réponse à l\'origine non plus').toBe(0);
    });
});

describe('Carillon - la position', () => {

    it('part de la position 0 et avance d\'un cran par tic', () => {
        const { apu } = buildHarness();
        for (let k = 0; k < 8; k++) {
            expect(apu.frameStep(k * TIC), `au tic ${k}`).toBe(k);
        }
    });

    it('reboucle au bout de 8 positions', () => {
        const { apu } = buildHarness();
        expect(apu.frameStep(8 * TIC), 'le tour est bouclé').toBe(0);
        expect(apu.frameStep(9 * TIC)).toBe(1);
        expect(apu.frameStep(15 * TIC)).toBe(7);
        expect(apu.frameStep(16 * TIC)).toBe(0);
    });

    it('la position ne change pas entre deux tics', () => {
        const { apu } = buildHarness();
        for (let offset = 0; offset < TIC; offset++) {
            expect(apu.frameStep(3 * TIC + offset), `offset ${offset} dans le tic 3`).toBe(3);
        }
    });
});

describe('Carillon - les trois cloches', () => {

    // Une cloche par bloc : chacune doit pouvoir rougir seule.

    // positions 0, 2, 4, 6 — donc les tics impairs
    it.each([
        { ticks: 0, coups: 0 },
        { ticks: 1, coups: 1 },
        { ticks: 2, coups: 1 },
        { ticks: 3, coups: 2 },
        { ticks: 4, coups: 2 },
        { ticks: 6, coups: 3 },
        { ticks: 7, coups: 4 },
        { ticks: 8, coups: 4 },
        { ticks: 10, coups: 5 },
        { ticks: 15, coups: 8 },
        { ticks: 16, coups: 8 },
    ])('longueur : $coups coups après $ticks tics', ({ ticks, coups }) => {
        const { apu } = buildHarness();
        expect(apu.lengthTicks(ticks * TIC)).toBe(coups);
    });

    // positions 2 et 6 — donc les tics 3, 7, 11, 15...
    it.each([
        { ticks: 0, coups: 0 },
        { ticks: 2, coups: 0 },
        { ticks: 3, coups: 1 },
        { ticks: 6, coups: 1 },
        { ticks: 7, coups: 2 },
        { ticks: 10, coups: 2 },
        { ticks: 11, coups: 3 },
        { ticks: 14, coups: 3 },
        { ticks: 15, coups: 4 },
        { ticks: 16, coups: 4 },
    ])('sweep : $coups coups après $ticks tics', ({ ticks, coups }) => {
        const { apu } = buildHarness();
        expect(apu.sweepTicks(ticks * TIC)).toBe(coups);
    });

    // position 7 — donc les tics multiples de 8
    it.each([
        { ticks: 0, coups: 0 },
        { ticks: 7, coups: 0 },
        { ticks: 8, coups: 1 },
        { ticks: 10, coups: 1 },
        { ticks: 15, coups: 1 },
        { ticks: 16, coups: 2 },
        { ticks: 23, coups: 2 },
        { ticks: 24, coups: 3 },
    ])('enveloppe : $coups coups après $ticks tics', ({ ticks, coups }) => {
        const { apu } = buildHarness();
        expect(apu.envelopeTicks(ticks * TIC)).toBe(coups);
    });

    it('longueur : la cloche ne sonne pas entre deux tics', () => {
        const { apu } = buildHarness();
        expect(apu.lengthTicks(TIC - 1), 'un cycle trop tôt').toBe(0);
        expect(apu.lengthTicks(TIC), 'et le voilà, au premier tic').toBe(1);
    });

    it('sweep : la cloche ne sonne pas entre deux tics', () => {
        const { apu } = buildHarness();
        expect(apu.sweepTicks(3 * TIC - 1), 'un cycle trop tôt').toBe(0);
        expect(apu.sweepTicks(3 * TIC), 'et le voilà, au tic 3').toBe(1);
    });

    it('enveloppe : la cloche ne sonne pas entre deux tics', () => {
        const { apu } = buildHarness();
        expect(apu.envelopeTicks(8 * TIC - 1), 'un cycle trop tôt').toBe(0);
        expect(apu.envelopeTicks(8 * TIC), 'et le voilà, au tic 8').toBe(1);
    });

    it.each([
        { cloche: 'lengthTicks', attendu: 256 },
        { cloche: 'sweepTicks', attendu: 128 },
        { cloche: 'envelopeTicks', attendu: 64 },
    ])('$cloche frappe $attendu fois par seconde', ({ cloche, attendu }) => {
        const { apu } = buildHarness();
        expect(apu[cloche](SECONDE)).toBe(attendu);
    });
});

describe('Carillon - il est monté sur DIV, pas sur son propre ressort', () => {

    it('écrire dans DIV remet le carillon à zéro', () => {
        const { machine, timer, apu } = buildHarness();

        machine.totalCycles = 5 * TIC;
        expect(apu.frameTicks(5 * TIC), 'cinq tics écoulés').toBe(5);
        expect(apu.frameStep(5 * TIC), 'position 5').toBe(5);

        timer.write(DIV, 0x00);

        expect(apu.frameTicks(5 * TIC), 'la date du reset est la nouvelle origine').toBe(0);
        expect(apu.frameStep(5 * TIC), 'retour en position 0').toBe(0);
    });

    it('après un reset de DIV, le carillon repart d\'un tic plein', () => {
        const { machine, timer, apu } = buildHarness();

        machine.totalCycles = 5 * TIC;
        timer.write(DIV, 0x00);

        machine.totalCycles = 6 * TIC;
        expect(apu.frameTicks(6 * TIC), 'un tic depuis le reset, pas six depuis l\'allumage').toBe(1);
        expect(apu.frameStep(6 * TIC)).toBe(1);
    });

    it('écrire dans DIV juste avant un coup de cloche l\'ANNULE et le repousse', () => {
        const { machine, timer, apu } = buildHarness();

        // Le tic 1 frappe la cloche de longueur : il est à un cycle machine d'ici.
        machine.totalCycles = TIC - 1;
        expect(apu.lengthTicks(TIC - 1), 'pas encore sonné').toBe(0);

        timer.write(DIV, 0x00);

        expect(apu.lengthTicks(TIC), 'la cloche qui allait sonner ne sonne pas').toBe(0);
        // La nouvelle origine est TIC - 1 : un tic plein plus tard, on est à 2*TIC - 1.
        expect(apu.lengthTicks(2 * TIC - 1), 'elle a été repoussée d\'un tic plein').toBe(1);
    });

    it('sans écriture de DIV, aucun décalage : le carillon suit l\'horloge machine', () => {
        const { machine, apu } = buildHarness();
        machine.totalCycles = 300 * TIC;
        expect(apu.frameTicks(300 * TIC)).toBe(300);
        expect(apu.frameStep(300 * TIC), '300 % 8').toBe(4);
    });
});
