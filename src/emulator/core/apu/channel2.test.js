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
    // Les cloches du carillon, sans reset de DIV. Longueur : un coup tous les 4096 cycles
    // machine. Enveloppe : un coup en position 7 du carillon, donc aux tics 7, 15, 23...
    lengthTicks: (cycle) => Math.floor(cycle / 4096),
    envelopeTicks: (cycle) => Math.floor((Math.floor(cycle / 2048) + 1) / 8),
});

const build = ({ nr21 = 0x00, nr22 = 0x00, nr23 = 0x00, nr24 = 0x00 } = {}) => {
    const chan = channel2(buildAPUStub());
    chan.NR21.setValue(nr21);
    chan.NR22.setValue(nr22);
    chan.NR23.setValue(nr23);
    chan.NR24.setValue(nr24);
    return chan;
};

/**
 * Appuie sur le bouton sans perdre les bits hauts de frequency déjà posés dans NR24.
 * Depuis le cran du trigger, un canal non déclenché ne sort rien : les tests d'amplitude
 * doivent donc démarrer la note, alors que ceux du rouleau (dutyStep/dutyOutput) non.
 */
const trigger = (chan) => {
    const high = chan.NR24.getValue() & 0x07;
    chan.NR24.setValue(0x80 | high);
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

describe('Canal 2 - le volume : la hauteur de la marche (NR22)', () => {

    it('initialVolume est le quartet de tête de NR22', () => {
        expect(build({ nr22: 0x00 }).initialVolume, 'silence').toBe(0);
        expect(build({ nr22: 0x10 }).initialVolume, 'la plus petite marche').toBe(1);
        expect(build({ nr22: 0xA0 }).initialVolume).toBe(10);
        expect(build({ nr22: 0xF0 }).initialVolume, 'la plus haute').toBe(15);
    });

    it('le quartet de queue appartient à l\'enveloppe : il ne déborde pas sur le volume', () => {
        expect(build({ nr22: 0xAF }).initialVolume, 'queue au maximum, volume inchangé').toBe(10);
        expect(build({ nr22: 0x0F }).initialVolume, 'rien que la queue : aucun volume').toBe(0);
    });

    it('le trigger charge le volume courant depuis le volume réglé', () => {
        const chan = build({ nr22: 0xA0 });
        expect(chan.volume, 'rien ne l\'a encore chargé').toBe(0);
        trigger(chan);
        expect(chan.volume, 'le trigger recopie le réglage').toBe(chan.initialVolume);
        expect(chan.volume).toBe(10);
    });
});

describe('Canal 2 - le disjoncteur : le DAC', () => {

    it('les cinq bits de tête de NR22 alimentent le DAC, et un seul suffit', () => {
        expect(build({ nr22: 0x08 }).isDacOn, 'le bit de direction seul : alimenté malgré un volume nul').toBe(true);
        expect(build({ nr22: 0x10 }).isDacOn, 'volume 1').toBe(true);
        expect(build({ nr22: 0xF0 }).isDacOn, 'volume maximum').toBe(true);
        expect(build({ nr22: 0xFF }).isDacOn, 'tout allumé').toBe(true);
    });

    it('les trois bits de queue n\'alimentent rien : ce n\'est que la période de l\'enveloppe', () => {
        expect(build({ nr22: 0x00 }).isDacOn, 'NR22 à zéro : disjoncteur baissé').toBe(false);
        expect(build({ nr22: 0x07 }).isDacOn, 'queue au maximum, toujours rien pour alimenter').toBe(false);
    });

    it('écrire 0x00 dans NR22 en vol baisse le disjoncteur', () => {
        const chan = build({ nr22: 0xA0 });
        expect(chan.isDacOn, 'le canal était alimenté').toBe(true);
        chan.NR22.setValue(0x00);
        expect(chan.isDacOn, 'coupé, et pas seulement mis en sourdine').toBe(false);
    });
});

describe('Canal 2 - amplitude : ce qui sort vraiment du canal', () => {

    it('amplitude est la marche du rouleau, portée à la hauteur du volume', () => {
        const period = 64;
        const chan = buildWithPeriod(period, 2);
        chan.NR22.setValue(0xA0); // volume 10
        trigger(chan);

        const tour = [];
        for (let step = 0; step < 8; step++) {
            tour.push(chan.amplitude(step * period));
        }
        expect(tour, 'le pochoir 2 mis à l\'échelle 10').toEqual([10, 0, 0, 0, 0, 10, 10, 10]);
    });

    it('changer le volume change la hauteur, jamais la forme', () => {
        const period = 64;
        const chan = buildWithPeriod(period, 1); // pochoir 1 : picots aux crans 0 et 7

        chan.NR22.setValue(0x30); // volume 3
        trigger(chan);
        expect(chan.amplitude(0), 'cran 0, un picot').toBe(3);
        expect(chan.amplitude(period), 'cran 1, un creux').toBe(0);

        chan.NR22.setValue(0xF0); // volume 15
        trigger(chan);            // seul le trigger recharge le volume courant
        expect(chan.amplitude(0), 'le même picot, plus haut').toBe(15);
        expect(chan.amplitude(period), 'un creux reste un creux, quel que soit le volume').toBe(0);
    });

    it('amplitude est un escalier : elle ne bouge pas à l\'intérieur d\'un cran', () => {
        const period = 100;
        const chan = buildWithPeriod(period, 3); // pochoir 3 : le cran 1 est un picot
        chan.NR22.setValue(0x70); // volume 7
        trigger(chan);
        for (let offset = 0; offset < period; offset++) {
            expect(chan.amplitude(period + offset), `offset ${offset} dans le cran 1`).toBe(7);
        }
    });

    it('disjoncteur baissé, le rouleau tourne dans le vide', () => {
        const period = 32;
        const chan = buildWithPeriod(period, 3); // pochoir 3 : 6 picots sur 8
        chan.NR22.setValue(0x00);

        for (let cycle = 0; cycle < 8 * period; cycle++) {
            expect(chan.amplitude(cycle), `cycle ${cycle}`).toBe(0);
        }
        expect(chan.dutyStep(3 * period), 'le rouleau, lui, n\'a pas cessé de tourner').toBe(3);
        expect(chan.dutyOutput(3 * period), 'et son cran porte toujours un picot').toBe(1);
    });

    it('le disjoncteur coupe EN AMONT du volume, pas seulement par coïncidence', () => {
        const period = 64;
        const chan = buildWithPeriod(period, 3); // pochoir 3 : le cran 1 porte un picot

        // Le chemin authentique, désormais atteignable : on charge un volume de 10 par un
        // trigger, PUIS on coupe le DAC. Écrire NR22 ne recharge pas le volume courant,
        // donc il vaut toujours 10 alors que le disjoncteur est baissé — l'unique état où
        // une garde explicite sur isDacOn se distingue de son absence.
        chan.NR22.setValue(0xA0); // volume 10, enveloppe débranchée
        trigger(chan);
        chan.NR22.setValue(0x00); // disjoncteur baissé

        expect(chan.volume, 'le volume courant a survécu à l\'écriture de NR22').toBe(10);
        expect(chan.dutyOutput(period), 'et le cran porte bien un picot').toBe(1);
        expect(chan.amplitude(period), 'rien ne sort quand même : le DAC coupe avant').toBe(0);
    });

    it('amplitude ne sort jamais de la plage 0..15, quelles que soient les manettes', () => {
        const chan = build({ nr21: 0xFF, nr22: 0xFF, nr23: 0xFF, nr24: 0xFF });
        for (let cycle = 0; cycle < 1000; cycle++) {
            const value = chan.amplitude(cycle);
            expect(value, `cycle ${cycle}`).toBeGreaterThanOrEqual(0);
            expect(value, `cycle ${cycle}`).toBeLessThanOrEqual(15);
        }
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
