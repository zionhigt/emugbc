import { describe, it, expect } from 'vitest';

import buildAPU from './index';
import buildTimer from '../timer/index';

/**
 * CRAN 10b : LE SWEEP (NR10, canal 1 uniquement).
 *
 *   bits 6-4  la cadence, en coups de la cloche sweep (128 Hz) ; 0 = pas d'échéance
 *   bit 3     le sens : 0 = la fréquence monte, 1 = elle descend
 *   bits 2-0  le décalage
 *
 * LA SÉQUENCE EXACTE, celle que blargg 04, 05 et 06 mesurent — ces trois ROMs ne touchent
 * QUE le canal 1, ce sont les seules des douze à notre portée aujourd'hui.
 *
 *   calculer()  =  f ± (f >> décalage), et si le résultat dépasse 2047, ÉTEINDRE le canal
 *
 *   au trigger :
 *       recharger la fréquence de travail depuis NR13/NR14
 *       si décalage ≠ 0 : calculer()          <- contrôle sans réécriture
 *
 *   à chaque échéance (cadence ≠ 0) :
 *       n = calculer()
 *       si n ≤ 2047 ET décalage ≠ 0 :
 *           fréquence de travail = n, réécrite dans NR13/NR14
 *           calculer()                        <- SECOND contrôle, résultat jeté
 *
 * Trois conséquences contre-intuitives, toutes vérifiées plus bas :
 *   - le second contrôle tue la note UN PAS PLUS TÔT qu'on ne l'attendrait ;
 *   - décalage 0 n'empêche PAS le contrôle à l'échéance (il vaut alors f + f), donc une
 *     fréquence au-dessus de 1023 tue la note même sans jamais bouger ;
 *   - la réécriture dans NR13/NR14 fait qu'un redéclenchement repart de la fréquence
 *     BALAYÉE, pas de celle que le programme avait écrite.
 *
 * PREMIÈRE UNITÉ À ÉTAT GARDÉ : la fréquence se réinjecte dans son propre calcul, donc pas
 * de forme close. `frequencyAt(cycle)` avance et retient. Ces tests n'interrogent que des
 * dates CROISSANTES.
 *
 * Hors périmètre : la phase du rouleau ne suit pas encore la période qui bouge — la
 * fréquence de travail évolue, la hauteur entendue non. Aucune ROM ne l'entend.
 */

const NR10 = 0xFF10;
const NR11 = 0xFF11;
const NR12 = 0xFF12;
const NR13 = 0xFF13;
const NR14 = 0xFF14;

const NR22 = 0xFF17;
const NR23 = 0xFF18;
const NR24 = 0xFF19;

const TRIGGER = 0x80;

const TIC = 2048;
/** Date du n-ième coup de la cloche sweep : elle frappe aux tics 2, 6, 10, 14... */
const clocheSweep = (n) => (4 * n - 2) * TIC;

/** NR10 assemblé depuis ses trois champs. */
const nr10 = ({ pace = 0, down = false, shift = 0 }) =>
    ((pace & 0x07) << 4) | (down ? 0x08 : 0x00) | (shift & 0x07);

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
    return { machine, apu, chan1: apu.channel1, chan2: apu.channel2 };
};

/** Canal 1 alimenté, sweep réglé, note lancée à la date 0. */
const buildSweeping = ({ sweep, frequency }) => {
    const harness = buildHarness();
    const { apu } = harness;
    apu.write(NR10, nr10(sweep));
    apu.write(NR11, 0xC0);
    apu.write(NR12, 0xF0);
    apu.write(NR13, frequency & 0xFF);
    apu.write(NR14, TRIGGER | ((frequency >> 8) & 0x07));
    return harness;
};

describe('Sweep - les trois champs de NR10', () => {

    it.each([
        { valeur: 0x00, pace: 0 },
        { valeur: 0x10, pace: 1 },
        { valeur: 0x70, pace: 7 },
        { valeur: 0x7F, pace: 7 },
        { valeur: 0x8F, pace: 0 },
    ])('NR10 = $valeur donne une cadence de $pace', ({ valeur, pace }) => {
        const { apu, chan1 } = buildHarness();
        apu.write(NR10, valeur);
        expect(chan1.sweepPace).toBe(pace);
    });

    it.each([
        { valeur: 0x00, shift: 0 },
        { valeur: 0x01, shift: 1 },
        { valeur: 0x07, shift: 7 },
        { valeur: 0xF7, shift: 7 },
    ])('NR10 = $valeur donne un décalage de $shift', ({ valeur, shift }) => {
        const { apu, chan1 } = buildHarness();
        apu.write(NR10, valeur);
        expect(chan1.sweepShift).toBe(shift);
    });

    it('le bit 3 donne le sens', () => {
        const { apu, chan1 } = buildHarness();
        apu.write(NR10, 0x00);
        expect(chan1.isSweepDown, 'bit 3 bas : la fréquence monte').toBe(false);
        apu.write(NR10, 0x08);
        expect(chan1.isSweepDown, 'bit 3 levé : elle descend').toBe(true);
    });
});

describe('Sweep - la fréquence monte', () => {

    // cadence 1, décalage 3 : f' = f + f/8, un pas par cloche
    const build = () => buildSweeping({ sweep: { pace: 1, shift: 3 }, frequency: 1024 });

    it('elle part de la valeur des registres', () => {
        const { chan1 } = build();
        expect(chan1.frequencyAt(0)).toBe(1024);
    });

    it('elle ne bouge pas avant la cloche', () => {
        const { chan1 } = build();
        expect(chan1.frequencyAt(clocheSweep(1) - 1), 'un cycle trop tôt').toBe(1024);
    });

    it('un pas par coup de cloche', () => {
        const { chan1 } = build();
        expect(chan1.frequencyAt(clocheSweep(1)), '1024 + 128').toBe(1152);
        expect(chan1.frequencyAt(clocheSweep(2)), '1152 + 144').toBe(1296);
        expect(chan1.frequencyAt(clocheSweep(3)), '1296 + 162').toBe(1458);
        expect(chan1.frequencyAt(clocheSweep(4)), '1458 + 182').toBe(1640);
    });

    it('la note tient tant que le PAS SUIVANT reste sous le plafond', () => {
        const { chan1 } = build();
        expect(chan1.isEnabledAt(clocheSweep(4)), '1640, et 1845 tiendrait encore').toBe(true);
    });
});

describe('Sweep - le second contrôle tue un pas trop tôt', () => {

    const build = () => buildSweeping({ sweep: { pace: 1, shift: 3 }, frequency: 1024 });

    it('la note meurt alors que sa fréquence courante est encore valide', () => {
        const { chan1 } = build();
        // à la 5e cloche : 1640 + 205 = 1845, sous le plafond, donc retenu.
        // Puis le SECOND contrôle calcule 1845 + 230 = 2075 : au-delà, la note meurt.
        expect(chan1.frequencyAt(clocheSweep(5)), '1845 est bien retenu').toBe(1845);
        expect(chan1.isEnabledAt(clocheSweep(5)), 'et pourtant la note est morte').toBe(false);
    });

    it('sans le second contrôle, elle aurait survécu une cloche de plus', () => {
        const { chan1 } = build();
        chan1.frequencyAt(clocheSweep(4));
        expect(chan1.isEnabledAt(clocheSweep(4)), 'vivante à la 4e').toBe(true);
        expect(chan1.isEnabledAt(clocheSweep(5)), 'morte à la 5e, pas à la 6e').toBe(false);
    });

    it('une fréquence qui déborde n\'est jamais retenue', () => {
        // décalage 1 : 1024 + 512 = 1536 retenu, puis 1536 + 768 = 2304 déborde
        const { chan1 } = buildSweeping({ sweep: { pace: 1, shift: 1 }, frequency: 1024 });
        expect(chan1.frequencyAt(clocheSweep(1)), 'le dernier pas valide').toBe(1536);
        expect(chan1.isEnabledAt(clocheSweep(1)), 'morte dès la première cloche').toBe(false);
        expect(chan1.frequencyAt(clocheSweep(3)), 'et elle n\'évolue plus').toBe(1536);
    });
});

describe('Sweep - la fréquence descend', () => {

    // cadence 2, décalage 2 : f' = f - f/4, un pas toutes les deux cloches
    const build = () => buildSweeping({ sweep: { pace: 2, down: true, shift: 2 }, frequency: 1024 });

    it('elle attend sa cadence', () => {
        const { chan1 } = build();
        expect(chan1.frequencyAt(0)).toBe(1024);
        expect(chan1.frequencyAt(clocheSweep(1)), 'une seule cloche, cadence 2').toBe(1024);
    });

    it('elle décroît d\'un pas toutes les deux cloches', () => {
        const { chan1 } = build();
        expect(chan1.frequencyAt(clocheSweep(2)), '1024 - 256').toBe(768);
        expect(chan1.frequencyAt(clocheSweep(4)), '768 - 192').toBe(576);
        expect(chan1.frequencyAt(clocheSweep(6)), '576 - 144').toBe(432);
    });

    it('en descendant rien ne déborde : la note survit', () => {
        const { chan1 } = build();
        expect(chan1.isEnabledAt(clocheSweep(20)), 'toujours vivante').toBe(true);
    });
});

describe('Sweep - cadence 0 : aucune échéance', () => {

    it('la fréquence est figée, même avec un décalage réglé', () => {
        const { chan1 } = buildSweeping({ sweep: { pace: 0, shift: 3 }, frequency: 1024 });
        expect(chan1.frequencyAt(0)).toBe(1024);
        expect(chan1.frequencyAt(clocheSweep(1))).toBe(1024);
        expect(chan1.frequencyAt(clocheSweep(50)), 'même très longtemps après').toBe(1024);
        expect(chan1.isEnabledAt(clocheSweep(50)), 'et rien ne la tue').toBe(true);
    });
});

describe('Sweep - décalage 0 : le contrôle a lieu quand même', () => {

    it('la fréquence ne bouge pas, mais l\'échéance calcule f + f', () => {
        // 1000 + 1000 = 2000, sous le plafond : la note survit et ne bouge pas
        const { chan1 } = buildSweeping({ sweep: { pace: 1, shift: 0 }, frequency: 1000 });
        expect(chan1.frequencyAt(clocheSweep(4)), 'figée').toBe(1000);
        expect(chan1.isEnabledAt(clocheSweep(4)), 'et vivante').toBe(true);
    });

    it('au-dessus de 1023, f + f déborde et tue la note SANS qu\'elle ait bougé', () => {
        const { chan1 } = buildSweeping({ sweep: { pace: 1, shift: 0 }, frequency: 1024 });
        expect(chan1.frequencyAt(clocheSweep(1)), 'jamais réécrite, décalage nul').toBe(1024);
        expect(chan1.isEnabledAt(clocheSweep(1)), 'et pourtant morte').toBe(false);
    });
});

describe('Sweep - le contrôle au déclenchement', () => {

    it('une fréquence qui déborderait au premier calcul tue la note au trigger', () => {
        // 2047 + 1023 dépasse 2047 : vérifié avant même la première cloche
        const { chan1 } = buildSweeping({ sweep: { pace: 0, shift: 1 }, frequency: 2047 });
        expect(chan1.isEnabledAt(0), 'morte au démarrage').toBe(false);
    });

    it('sans décalage, aucun contrôle au trigger : la note démarre même à 2047', () => {
        const { chan1 } = buildSweeping({ sweep: { pace: 0, shift: 0 }, frequency: 2047 });
        expect(chan1.isEnabledAt(0), 'rien à calculer au trigger').toBe(true);
    });

    it('en sens descendant, le contrôle du trigger passe toujours', () => {
        const { chan1 } = buildSweeping({ sweep: { pace: 0, down: true, shift: 1 }, frequency: 2047 });
        expect(chan1.isEnabledAt(0)).toBe(true);
    });
});

describe('Sweep - la réécriture dans NR13/NR14', () => {

    it('l\'octet bas balayé survit au redéclenchement', () => {
        // 1000 = 0x3E8, un pas descendant de décalage 1 donne 500 = 0x1F4.
        // NR13 passe donc de 0xE8 à 0xF4 — c'est cette réécriture qu'on mesure.
        // NR14 ne peut pas être testé de la même façon : écrire le trigger impose
        // forcément ses trois bits de fréquence haute, un programme ne peut pas y couper.
        const { machine, apu, chan1 } = buildSweeping({
            sweep: { pace: 1, down: true, shift: 1 }, frequency: 1000,
        });
        expect(chan1.frequencyAt(clocheSweep(1)), 'descendue à 500').toBe(500);

        machine.totalCycles = clocheSweep(1);
        apu.write(NR14, TRIGGER | 0x01); // 0x1__ : on redonne la haute, pas la basse

        expect(
            chan1.frequencyAt(clocheSweep(1)),
            'NR13 contient 0xF4 et non 0xE8 : le sweep y a bien écrit',
        ).toBe(500);
    });

    it('écrire NR13 et NR14 avant de redéclencher impose la nouvelle valeur', () => {
        const { machine, apu, chan1 } = buildSweeping({
            sweep: { pace: 2, down: true, shift: 2 }, frequency: 1024,
        });
        chan1.frequencyAt(clocheSweep(2));

        machine.totalCycles = clocheSweep(2);
        apu.write(NR13, 0x00);
        apu.write(NR14, TRIGGER | 0x06); // 0x600 = 1536
        expect(chan1.frequencyAt(clocheSweep(2))).toBe(1536);
    });

    it('et la cadence repart de zéro au redéclenchement', () => {
        const { machine, apu, chan1 } = buildSweeping({
            sweep: { pace: 2, down: true, shift: 2 }, frequency: 1024,
        });
        chan1.frequencyAt(clocheSweep(2));

        machine.totalCycles = clocheSweep(2);
        apu.write(NR13, 0x00);
        apu.write(NR14, TRIGGER | 0x04); // 1024

        expect(chan1.frequencyAt(clocheSweep(3)), 'une cloche depuis le trigger').toBe(1024);
        expect(chan1.frequencyAt(clocheSweep(4)), 'deux cloches : un pas').toBe(768);
    });
});

describe('Sweep - le canal 2 n\'en a pas', () => {

    it('sa fréquence ne bouge jamais', () => {
        const { apu, chan2 } = buildHarness();
        apu.write(NR22, 0xF0);
        apu.write(NR23, 0x00);
        apu.write(NR24, TRIGGER | 0x04); // 0x400

        expect(chan2.frequencyAt(0)).toBe(1024);
        expect(chan2.frequencyAt(clocheSweep(10)), 'aucun sweep sur ce canal').toBe(1024);
    });
});
