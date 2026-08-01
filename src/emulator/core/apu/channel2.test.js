import { describe, it, expect } from 'vitest';

import channel2 from './channel2';
import buildAPU from './index';

/**
 * CRAN 1 DU CANAL 2 : L'OSCILLATEUR.
 *
 * Le canal pulse est une boîte à musique : un rouleau à 8 crans qui tourne en boucle,
 * et une manivelle qui le fait avancer d'un cran toutes les `period` cycles machine.
 * Sur chaque cran, un picot est présent (sortie 1) ou absent (sortie 0) ; le motif des
 * picots est le pochoir choisi par `duty`.
 *
 * Ce fichier ne teste QUE l'oscillateur, et seulement à période constante. Le trigger
 * (qui remet le rouleau à zéro), le changement de vitesse en vol, le length counter et
 * l'enveloppe sont des crans suivants, avec leurs propres fichiers.
 *
 * Convention de date : `cycle` est un compteur de CYCLES MACHINE, la même unité que
 * `machine.totalCycles` (1048576 Hz). L'origine du rouleau est la date 0.
 */

const DUTY_PATTERNS = [
    [0, 0, 0, 0, 0, 0, 0, 1], // duty 0 - 12,5 %
    [1, 0, 0, 0, 0, 0, 0, 1], // duty 1 - 25 %
    [1, 0, 0, 0, 0, 1, 1, 1], // duty 2 - 50 %
    [0, 1, 1, 1, 1, 1, 1, 0], // duty 3 - 75 %
];

const MACHINE_FREQUENCE = 1048576;

/**
 * L'APU vu par un canal : `channel2(apu)` en reçoit une référence à la construction.
 * Aucun test de ce fichier n'en a besoin — les deux méthodes datées reçoivent leur date
 * en argument — mais le canal doit pouvoir se construire sans machine derrière.
 */
const buildAPUStub = () => ({
    totalMachineCycles: 0,
    bus: { _read: () => 0xFF, _write: () => {} },
});

const build = ({ nr21 = 0x00, nr22 = 0x00, nr23 = 0x00, nr24 = 0x00 } = {}) => {
    const chan = channel2(buildAPUStub());
    chan.NR21.setValue(nr21);
    chan.NR22.setValue(nr22);
    chan.NR23.setValue(nr23);
    chan.NR24.setValue(nr24);
    return chan;
};

/** Règle le canal sur une période donnée, sans passer par l'arithmétique de frequency. */
const buildWithPeriod = (period, duty = 0) => {
    const frequency = 2048 - period;
    return build({
        nr21: duty << 6,
        nr23: frequency & 0xFF,
        nr24: (frequency >> 8) & 0x07,
    });
};

describe('Canal 2 - le tableau de bord : ce que la manivelle lit dans NR21/NR23/NR24', () => {

    it('duty est le couple de bits de tête de NR21, rien d\'autre', () => {
        expect(build({ nr21: 0x00 }).duty, 'bits 7-6 = 00').toBe(0);
        expect(build({ nr21: 0x40 }).duty, 'bits 7-6 = 01').toBe(1);
        expect(build({ nr21: 0x80 }).duty, 'bits 7-6 = 10').toBe(2);
        expect(build({ nr21: 0xC0 }).duty, 'bits 7-6 = 11').toBe(3);
    });

    it('les 6 bits de queue de NR21 sont la longueur : ils ne débordent pas sur duty', () => {
        expect(build({ nr21: 0x3F }).duty, 'longueur au maximum, duty toujours 0').toBe(0);
        expect(build({ nr21: 0xFF }).duty, 'longueur au maximum, duty toujours 3').toBe(3);
    });

    it('frequency est un nombre de 11 bits : NR23 en bas, NR24 bits 2-0 en haut', () => {
        expect(build({ nr23: 0x00, nr24: 0x00 }).frequency, 'tout à zéro').toBe(0);
        expect(build({ nr23: 0xFF, nr24: 0x00 }).frequency, 'seuls les 8 bits bas').toBe(0x0FF);
        expect(build({ nr23: 0x00, nr24: 0x07 }).frequency, 'seuls les 3 bits hauts').toBe(0x700);
        expect(build({ nr23: 0x34, nr24: 0x05 }).frequency, 'les deux moitiés assemblées').toBe(0x534);
        expect(build({ nr23: 0xFF, nr24: 0x07 }).frequency, 'le maximum : 2047').toBe(0x7FF);
    });

    it('trigger et length-enable habitent NR24 mais ne fuient pas dans frequency', () => {
        // NR24 bit 7 = trigger, bit 6 = length enable : deux voisins de palier, pas des bits de poids fort
        expect(build({ nr23: 0xFF, nr24: 0xC7 }).frequency, 'bits 7-6 ignorés').toBe(0x7FF);
        expect(build({ nr23: 0x00, nr24: 0xC0 }).frequency, 'bits 7-6 seuls : fréquence nulle').toBe(0);
    });

    it('period est le nombre de cycles machine entre deux crans : elle DÉCROÎT quand frequency monte', () => {
        expect(buildWithPeriod(2048).frequency, 'frequency 0 donne la période la plus longue').toBe(0);
        expect(build({ nr23: 0x00, nr24: 0x00 }).period, 'frequency = 0').toBe(2048);
        expect(build({ nr23: 0x00, nr24: 0x04 }).period, 'frequency = 1024').toBe(1024);
        expect(build({ nr23: 0xFF, nr24: 0x07 }).period, 'frequency = 2047, la note la plus aiguë').toBe(1);
    });
});

describe('Canal 2 - le rouleau tourne : dutyStep', () => {

    it('à la date 0, le rouleau est sur son premier cran', () => {
        expect(buildWithPeriod(2048).dutyStep(0)).toBe(0);
        expect(buildWithPeriod(7).dutyStep(0)).toBe(0);
    });

    it('la frontière du cran est exacte : le dernier cycle appartient encore au cran courant', () => {
        const chan = buildWithPeriod(2048);
        expect(chan.dutyStep(2047), 'un cycle avant la bascule, on est encore au cran 0').toBe(0);
        expect(chan.dutyStep(2048), 'à la bascule pile, on passe au cran 1').toBe(1);
        expect(chan.dutyStep(4095), 'idem au cran suivant').toBe(1);
        expect(chan.dutyStep(4096), 'et on passe au cran 2').toBe(2);
    });

    it('huit crans font un tour, puis le rouleau reboucle', () => {
        const period = 512;
        const chan = buildWithPeriod(period);
        for (let step = 0; step < 8; step++) {
            expect(chan.dutyStep(step * period), `début du cran ${step}`).toBe(step);
            expect(chan.dutyStep(step * period + period - 1), `fin du cran ${step}`).toBe(step);
        }
        expect(chan.dutyStep(8 * period), 'le tour est bouclé : retour au cran 0').toBe(0);
        expect(chan.dutyStep(8 * period + period), 'et ça repart').toBe(1);
    });

    it('le rouleau tourne toujours pendant des dizaines de tours sans dériver', () => {
        const period = 298;
        const chan = buildWithPeriod(period);
        for (const turn of [1, 2, 17, 100, 1000]) {
            const date = turn * 8 * period;
            expect(chan.dutyStep(date), `après ${turn} tours pleins`).toBe(0);
            expect(chan.dutyStep(date - 1), `juste avant la fin du tour ${turn}`).toBe(7);
        }
    });

    it('à la période la plus courte, le rouleau avance d\'un cran par cycle machine', () => {
        const chan = buildWithPeriod(1);
        for (let cycle = 0; cycle < 16; cycle++) {
            expect(chan.dutyStep(cycle), `cycle ${cycle}`).toBe(cycle % 8);
        }
    });
});

describe('Canal 2 - les pochoirs : dutyOutput', () => {

    it.each([0, 1, 2, 3])('duty %i grave son motif de picots sur le tour complet', (duty) => {
        const period = 64;
        const chan = buildWithPeriod(period, duty);
        const tour = [];
        for (let step = 0; step < 8; step++) {
            tour.push(chan.dutyOutput(step * period));
        }
        expect(tour).toEqual(DUTY_PATTERNS[duty]);
    });

    it('la sortie ne bouge pas À L\'INTÉRIEUR d\'un cran : c\'est un signal en marches d\'escalier', () => {
        const period = 100;
        const chan = buildWithPeriod(period, 3); // duty 3 : le cran 1 est un picot
        for (let offset = 0; offset < period; offset++) {
            expect(chan.dutyOutput(period + offset), `offset ${offset} dans le cran 1`).toBe(1);
        }
        expect(chan.dutyOutput(period - 1), 'et le cran 0 juste avant est creux').toBe(0);
    });

    it('la sortie ne vaut jamais autre chose que 0 ou 1 : le volume viendra plus tard', () => {
        const chan = buildWithPeriod(37, 2);
        for (let cycle = 0; cycle < 1000; cycle++) {
            expect([0, 1]).toContain(chan.dutyOutput(cycle));
        }
    });

    it('changer le pochoir en vol ne déplace PAS le rouleau', () => {
        const period = 256;
        const chan = buildWithPeriod(period, 0);
        const date = 3 * period + 40; // quelque part dans le cran 3

        expect(chan.dutyStep(date)).toBe(3);
        chan.NR21.setValue((3 << 6) | 0x1F); // on passe au duty 3, longueur au passage
        expect(chan.duty, 'le nouveau pochoir est bien pris en compte').toBe(3);
        expect(chan.dutyStep(date), 'mais le rouleau est resté exactement où il était').toBe(3);
        expect(chan.dutyOutput(date), 'seule la sortie change : cran 3 du pochoir 3 est un picot').toBe(1);
    });
});

describe('Canal 2 - la note produite', () => {

    it('frequency = 1750 fait tourner le rouleau 440 fois par seconde : un la 440', () => {
        // 8 crans par tour, une période de 2048 - 1750 = 298 cycles machine par cran.
        const chan = build({ nr23: 1750 & 0xFF, nr24: (1750 >> 8) & 0x07 });
        expect(chan.period, 'la période du cran').toBe(298);

        let tours = 0;
        for (let cycle = 1; cycle <= MACHINE_FREQUENCE; cycle++) {
            if (chan.dutyStep(cycle) === 0 && chan.dutyStep(cycle - 1) === 7) tours++;
        }
        expect(tours, 'tours complets en une seconde machine : un la 440 à 0,05 % près').toBe(439);
    });
});

describe('Canal 2 - le raccordement au bus', () => {

    const buildMachineStub = () => ({
        totalCycles: 0,
        memory: { _read: () => 0xFF, _write: () => {} },
    });

    it('l\'APU route 0xFF16-0xFF19 vers les registres du canal 2', () => {
        const APU = buildAPU(buildMachineStub());
        const apu = new APU();

        apu.write(0xFF16, 0x80); // NR21 : duty 2
        apu.write(0xFF18, 0x34); // NR23 : 8 bits bas
        apu.write(0xFF19, 0x05); // NR24 : 3 bits hauts

        expect(apu.channel2.duty, 'NR21 est arrivé').toBe(2);
        expect(apu.channel2.frequency, 'NR23 et NR24 sont arrivés').toBe(0x534);
    });

    it('une adresse hors du canal ne passe pas par ses registres', () => {
        const APU = buildAPU(buildMachineStub());
        const apu = new APU();

        expect(() => apu.write(0xFF10, 0x80), 'NR10 n\'existe pas encore : le bus nu encaisse').not.toThrow();
        expect(apu.channel2.duty, 'et le canal 2 n\'a pas bougé').toBe(0);
    });
});
