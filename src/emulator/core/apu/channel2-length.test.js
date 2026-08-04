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
 * Le « extra length clocking » — le cran supplémentaire que le matériel donne quand on
 * lève le bit 6 au milieu d'une période de longueur — a ses deux blocs en fin de fichier.
 *
 * Sa règle est documentée, on n'a pas à la deviner : wiki gbdev, section « Obscure
 * Behavior », https://gbdev.gg8.se/wiki/articles/Gameboy_sound_hardware
 *
 *   « Each length counter is clocked at 256 Hz by the frame sequencer. When clocked while
 *     enabled by NRx4 and the counter is not zero, it is decremented. If it becomes zero,
 *     the channel is disabled. »
 *
 * Deux règles obscures s'y greffent, même source. Elles se ressemblent, mais elles ne
 * demandent PAS la même chose :
 *
 *   1. « Extra length clocking occurs when writing to NRx4 when the frame sequencer's
 *      next step is one that doesn't clock the length counter. In this case, if the
 *      length counter was PREVIOUSLY disabled and now enabled and the length counter is
 *      not zero, it is decremented. If this decrement makes it zero and trigger is
 *      clear, the channel is disabled. »
 *
 *   2. « If a channel is triggered when the frame sequencer's next step is one that
 *      doesn't clock the length counter and the length counter is now enabled and length
 *      is being set to 64 (256 for wave channel) because it was previously zero, it is
 *      set to 63 instead. »
 *
 * La 1 exige un FRONT sur le bit 6 — « PREVIOUSLY disabled and now enabled ». La 2 dit
 * seulement « is now enabled », ce qui se lit comme si l'état courant suffisait — mais
 * c'est un raccourci : `02-len ctr` sous-test 6 refuse ce cas en toutes lettres. Un
 * trigger sans front, sur un compteur vidé, remonte à 64 et ne reçoit AUCUN cran. Les
 * deux règles exigent donc le front ; ce qui les sépare, c'est l'état du compteur — la 1
 * le veut non nul, la 2 à zéro, et elles ne peuvent jamais s'appliquer ensemble.
 *
 * (Le wiki ajoute que la CGB-02 se contente d'un « a été débranché un jour » : c'est une
 * variante du front, pas sa disparition. On est sur DMG.)
 */

const TIC = 2048;        // un tic de carillon, en cycles machine
/** Date du n-ième coup de la cloche longueur : elle frappe aux tics impairs. */
const clocheLongueur = (n) => (2 * n - 1) * TIC;

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
        expect(chan.lengthRemaining(clocheLongueur(1)), 'première cloche').toBe(3);
        expect(chan.lengthRemaining(clocheLongueur(2)), 'deuxième').toBe(2);
        expect(chan.lengthRemaining(clocheLongueur(3)), 'troisième').toBe(1);
        expect(chan.lengthRemaining(clocheLongueur(4)), 'quatrième : à sec').toBe(0);
    });

    it('il ne bouge pas entre deux cloches', () => {
        const { chan } = buildCounting();
        expect(chan.lengthRemaining(clocheLongueur(1) - 1), 'un cycle avant la cloche').toBe(4);
        expect(chan.lengthRemaining(clocheLongueur(1)), 'et à la cloche pile').toBe(3);
    });

    it('il ne descend jamais sous zéro', () => {
        const { chan } = buildCounting();
        expect(chan.lengthRemaining(clocheLongueur(100)), 'longtemps après la fin').toBe(0);
    });

    it('four débranché, le minuteur ne tourne pas du tout', () => {
        const { chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3C); // 4 crans
        chan.NR4.setValue(TRIGGER);     // sans le bit 6

        expect(chan.lengthRemaining(0)).toBe(4);
        expect(chan.lengthRemaining(clocheLongueur(10)), 'figé, aucune cloche ne l\'atteint').toBe(4);
    });
});

/**
 * Trouvé par blargg `02-len ctr`, pas par les tests ci-dessus : basculer le bit 6 en
 * cours de note change le RÉFÉRENTIEL du minuteur. Sans capture au moment de la bascule,
 * activer la longueur après coup consomme d'un seul coup toutes les cloches passées
 * pendant qu'elle était débranchée, et la note meurt instantanément.
 *
 * Même principe que `_capture()` dans le timer, y compris le piège d'ordre : la valeur
 * doit être matérialisée AVANT que le registre ne prenne sa nouvelle valeur, sinon on la
 * relit déjà à travers le nouveau référentiel.
 */
describe('Minuteur - basculer l\'interrupteur en vol', () => {

    it('activer la longueur ne consomme pas les cloches passées', () => {
        const { machine, chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3C); // 4 crans
        chan.NR4.setValue(TRIGGER);     // déclenché, longueur DÉBRANCHÉE

        // On branche sur un tic PAIR, pour isoler ce test du cran gratuit de l'extra
        // length clocking — qui ne frappe qu'aux tics impairs, et a son propre bloc.
        const branchement = 20 * TIC;
        expect(chan.lengthRemaining(branchement), 'débranché, rien ne bouge').toBe(4);

        machine.totalCycles = branchement;
        chan.NR4.setValue(LENGTH_ENABLE); // on branche, sans redéclencher

        expect(chan.lengthRemaining(branchement), 'le minuteur est intact').toBe(4);
        expect(chan.lengthRemaining(21 * TIC), 'et il repart d\'ici, pas d\'avant').toBe(3);
        expect(chan.isEnabledAt(21 * TIC), 'la note joue encore').toBe(true);
    });

    it('débrancher la longueur ne ressuscite pas une note déjà éteinte', () => {
        // blargg 02-len ctr, sous-test « Disabling length shouldn't re-enable channel ».
        // L'épuisement du minuteur ÉTEINT le canal : c'est un état verrouillé, pas une
        // condition qu'on recalcule à chaque lecture — sinon retirer la condition la lève.
        const { machine, chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3C); // 4 crans
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);

        expect(chan.isEnabledAt(clocheLongueur(4)), 'minuteur à sec').toBe(false);

        machine.totalCycles = clocheLongueur(4);
        chan.NR4.setValue(0x00); // on débranche la longueur

        expect(chan.isEnabledAt(clocheLongueur(4)), 'la note reste morte').toBe(false);
        expect(chan.isEnabled, 'à l\'heure courante aussi').toBe(false);
    });

    it('désactiver la longueur fige le minuteur là où il en est', () => {
        const { machine, chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3C); // 4 crans
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);

        expect(chan.lengthRemaining(clocheLongueur(2)), 'deux crans consommés').toBe(2);

        machine.totalCycles = clocheLongueur(2);
        chan.NR4.setValue(0x00); // on débranche

        expect(chan.lengthRemaining(clocheLongueur(2)), 'figé à 2, pas revenu à 4').toBe(2);
        expect(chan.lengthRemaining(clocheLongueur(20)), 'et il ne bouge plus').toBe(2);
    });
});

/**
 * L'EXTRA LENGTH CLOCKING — la bizarrerie qu'on avait mise de côté au cran 5.
 *
 * Brancher le four alors que la prochaine cloche n'en est pas une retire un cran TOUT DE
 * SUITE, sans attendre. Trois conditions, toutes nécessaires :
 *   - le bit 6 passe de 0 à 1 (un front, pas un état : le réécrire ne compte pas) ;
 *   - le compteur n'est pas déjà à zéro ;
 *   - la PROCHAINE cloche n'est pas une cloche de longueur.
 *
 * Sous notre phase, les cloches de longueur sonnent aux tics impairs. Donc la troisième
 * condition se réduit à : le nombre de tics écoulés est impair.
 *
 * Et si ce cran gratuit amène le compteur à zéro sans trigger dans la même écriture,
 * la note meurt sur-le-champ.
 *
 * Hors périmètre ici : le cas où la même écriture porte AUSSI le trigger. L'ordre exact
 * entre le rechargement et le cran supplémentaire est le coin le plus profond de blargg —
 * c'est le dernier bloc du fichier.
 */
describe('Minuteur - le cran gratuit du branchement', () => {

    /** Minuteur à 4 crans, déclenché à la date 0, four DÉBRANCHÉ. */
    const buildArmed = (retrait = 0x3C) => {
        const harness = buildPlayable();
        harness.chan.NR1.setValue(0xC0 | retrait);
        harness.chan.NR4.setValue(TRIGGER); // pas de bit 6
        return harness;
    };

    it('brancher sur un tic IMPAIR retire un cran immédiatement', () => {
        const { machine, chan } = buildArmed();
        machine.totalCycles = TIC; // un tic écoulé : impair

        chan.NR4.setValue(LENGTH_ENABLE);
        expect(chan.lengthRemaining(TIC), 'un cran parti sans qu\'aucune cloche ne sonne').toBe(3);
    });

    it('brancher sur un tic PAIR ne retire rien', () => {
        const { machine, chan } = buildArmed();
        machine.totalCycles = 2 * TIC; // deux tics : pair

        chan.NR4.setValue(LENGTH_ENABLE);
        expect(chan.lengthRemaining(2 * TIC), 'la prochaine cloche EST une cloche de longueur').toBe(4);
    });

    it('le cran gratuit ne se répète pas : il faut un FRONT sur le bit 6', () => {
        const { machine, chan } = buildArmed();
        machine.totalCycles = TIC;
        chan.NR4.setValue(LENGTH_ENABLE);
        expect(chan.lengthRemaining(TIC)).toBe(3);

        chan.NR4.setValue(LENGTH_ENABLE); // déjà à 1 : aucun front
        expect(chan.lengthRemaining(TIC), 'réécrire le même bit ne coûte rien').toBe(3);
    });

    it('un compteur déjà à zéro ne perd rien de plus', () => {
        const { machine, chan } = buildArmed(0x3F); // un seul cran
        machine.totalCycles = TIC;
        chan.NR4.setValue(LENGTH_ENABLE);
        expect(chan.lengthRemaining(TIC), 'le cran gratuit l\'a vidé').toBe(0);

        chan.NR4.setValue(0x00);
        machine.totalCycles = 3 * TIC;
        chan.NR4.setValue(LENGTH_ENABLE); // nouveau front, mais compteur à zéro
        expect(chan.lengthRemaining(3 * TIC)).toBe(0);
    });

    it('le cran gratuit peut tuer la note', () => {
        const { machine, chan } = buildArmed(0x3F); // un seul cran
        expect(chan.isEnabledAt(0), 'elle jouait').toBe(true);

        machine.totalCycles = TIC;
        chan.NR4.setValue(LENGTH_ENABLE); // sans trigger

        expect(chan.lengthRemaining(TIC), 'à sec').toBe(0);
        expect(chan.isEnabledAt(TIC), 'et morte, sans qu\'aucune cloche n\'ait sonné').toBe(false);
    });

    it('four déjà branché au trigger : pas de front, pas de cran gratuit', () => {
        const { chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3C);
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE); // le bit 6 arrive AVEC le trigger

        expect(chan.lengthRemaining(0), 'les 4 crans sont intacts').toBe(4);
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
        expect(chan.isEnabledAt(clocheLongueur(3)), 'il reste un cran, ça joue encore').toBe(true);
        expect(chan.isEnabledAt(clocheLongueur(4)), 'minuteur à sec : coupé').toBe(false);
        expect(chan.isEnabledAt(clocheLongueur(50)), 'et ça ne revient pas tout seul').toBe(false);
    });

    it('amplitude tombe en même temps que la note', () => {
        const { chan } = buildCounting();
        const period = chan.period;
        // pochoir 3, volume 15 : le cran 1 du rouleau porte un picot
        expect(chan.amplitude(period), 'avant la fin, le signal sort').toBe(15);
        expect(chan.amplitude(clocheLongueur(4) + period), 'après la fin, plus rien').toBe(0);
    });

    it('le rouleau continue de tourner sous une note éteinte', () => {
        const { chan } = buildCounting();
        // clocheLongueur(4) vaut 7 tics, et la période du canal vaut un tic :
        // 7 + 5 périodes = 12, soit le cran 4 du rouleau.
        const date = clocheLongueur(4) + 5 * chan.period;
        expect(chan.dutyStep(date), 'la manivelle ne s\'arrête jamais').toBe(4);
        expect(chan.amplitude(date), 'mais rien ne sort').toBe(0);
    });

    it('four débranché, la note ne s\'arrête jamais', () => {
        const { chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3F); // un seul cran
        chan.NR4.setValue(TRIGGER);     // sans le bit 6
        expect(chan.isEnabledAt(clocheLongueur(1000)), 'aucun minuteur ne la coupe').toBe(true);
    });

    it('isEnabled sans date répond pour l\'heure courante', () => {
        const { machine, chan } = buildCounting();
        machine.totalCycles = clocheLongueur(3);
        expect(chan.isEnabled, 'il reste un cran').toBe(true);

        machine.totalCycles = clocheLongueur(4);
        expect(chan.isEnabled, 'minuteur à sec').toBe(false);
    });
});

describe('Minuteur - le trigger le remonte, mais seulement à sec', () => {

    it('déclencher un minuteur à sec le remonte au maximum', () => {
        const { machine, chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3F); // un seul cran
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);
        expect(chan.lengthRemaining(clocheLongueur(1)), 'à sec après une cloche').toBe(0);

        // On redéclenche au tic 2, dont l'étape suivante EST une étape de longueur : la
        // règle 2 ne mord pas là, et le rechargement se lit à nu. Le tic 1 en donnerait 63,
        // et c'est le bloc « trigger et branchement dans la même écriture » qui le couvre.
        machine.totalCycles = 2 * TIC;
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);
        expect(chan.lengthRemaining(2 * TIC), 'remonté à fond, pas à 1').toBe(64);
        expect(chan.isEnabledAt(2 * TIC), 'et la note repart').toBe(true);
    });

    it('déclencher un minuteur encore plein ne le remonte pas', () => {
        const { machine, chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3C); // 4 crans
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);
        expect(chan.lengthRemaining(clocheLongueur(2)), 'deux crans consommés').toBe(2);

        machine.totalCycles = clocheLongueur(2);
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);
        expect(chan.lengthRemaining(clocheLongueur(2)), 'il reprend là où il en était').toBe(2);
        expect(chan.lengthRemaining(clocheLongueur(3)), 'et repart de là').toBe(1);
    });
});

/**
 * LE COIN LE PLUS PROFOND : QUAND LA MÊME ÉCRITURE FAIT LES DEUX.
 *
 * Deux règles que blargg attrape et que rien au-dessus ne couvre — `02-len ctr` à son
 * sous-test 7, `03-trigger` au sien 8. Elles ne parlent ni du carillon ni de sa phase :
 * elles parlent de l'ORDRE des trois gestes dans une seule écriture de NR24.
 *
 *   1. Le rechargement à sec ne dépend PAS du bit 6. Un trigger remonte le minuteur vidé
 *      au maximum même si la longueur est débranchée — l'état est reconstitué en silence,
 *      et ne se voit que plus tard, quand on rebranche.
 *
 *   2. Quand la même écriture lève le bit 6 ET déclenche, le minuteur reçoit le cran
 *      gratuit APRÈS son rechargement : il repart à 63, pas à 64. C'est le seul endroit
 *      où l'ordre des deux gestes est observable, et il se lit dans cet ordre :
 *          le cran gratuit du front, sur l'ANCIENNE valeur (à sec : rien à retirer),
 *          puis le rechargement au maximum,
 *          puis le cran gratuit à nouveau, sur la valeur RECHARGÉE.
 */
describe('Minuteur - trigger et branchement dans la même écriture', () => {

    /** Un minuteur d'un seul cran, déclenché à la date 0, à sec dès la première cloche. */
    const buildDrained = () => {
        const harness = buildPlayable();
        harness.chan.NR1.setValue(0xC0 | 0x3F); // un seul cran
        harness.chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);
        return harness;
    };

    it('déclencher longueur DÉBRANCHÉE remonte quand même le minuteur à sec', () => {
        const { machine, chan } = buildDrained();
        expect(chan.lengthRemaining(clocheLongueur(1)), 'à sec après une cloche').toBe(0);

        machine.totalCycles = 2 * TIC;
        chan.NR4.setValue(0x00);    // on débranche la longueur
        chan.NR4.setValue(TRIGGER); // et on déclenche SANS le bit 6

        expect(chan.lengthRemaining(2 * TIC), 'remonté au maximum, pas laissé à sec').toBe(64);
    });

    it('et ce rechargement silencieux tient vraiment la durée pleine', () => {
        const { machine, chan } = buildDrained();

        machine.totalCycles = 2 * TIC;
        chan.NR4.setValue(0x00);
        chan.NR4.setValue(TRIGGER);

        // On rebranche sur un tic PAIR : pas de cran gratuit, le minuteur part à 64.
        machine.totalCycles = 4 * TIC;
        chan.NR4.setValue(LENGTH_ENABLE);

        // Les cloches de longueur tombent maintenant aux tics 5, 7, 9... : la 64e est au 131.
        expect(chan.isEnabledAt(129 * TIC), 'encore vivante au 63e coup').toBe(true);
        expect(chan.isEnabledAt(131 * TIC), 'et elle s\'arrête au 64e').toBe(false);
    });

    it('trigger ET branchement à sec : le minuteur repart à 63, pas à 64', () => {
        const { machine, chan } = buildDrained();

        machine.totalCycles = 2 * TIC;
        chan.NR4.setValue(0x00); // on débranche, pour avoir un FRONT à la prochaine écriture

        // Tic 3 : la prochaine étape est la 3, elle ne frappe pas la longueur — le cran
        // gratuit s'applique donc, et il s'applique au minuteur DÉJÀ rechargé.
        machine.totalCycles = 3 * TIC;
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);

        expect(chan.lengthRemaining(3 * TIC), 'rechargé à 64, puis le cran gratuit').toBe(63);
        expect(chan.isEnabledAt(3 * TIC), 'la note repart bel et bien').toBe(true);
    });

    it('sur un tic où la longueur va sonner, le même geste laisse 64', () => {
        const { machine, chan } = buildDrained();

        machine.totalCycles = 2 * TIC;
        chan.NR4.setValue(0x00);

        // Tic 4 : la prochaine étape EST une étape de longueur, pas de cran gratuit.
        machine.totalCycles = 4 * TIC;
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);

        expect(chan.lengthRemaining(4 * TIC), 'rechargé, et rien ne lui est retiré').toBe(64);
    });

    /**
     * SANS FRONT, PAS DE CRAN — arbitré par `02-len ctr` sous-test 6, relevé au journal :
     * il déclenche au tic 377 (étape 1, donc une étape qui ne clocke pas la longueur) sur
     * un compteur vidé par les cloches, sans avoir retouché le bit 6, et il exige 64.
     *
     * C'est le garde-fou de la règle 2 : sa formulation « and the length counter is now
     * enabled » laisse croire que l'état courant suffit. Il n'en est rien.
     */
    it('trigger sans front, sur un compteur vidé par la cloche du même tic : 64', () => {
        const { machine, chan } = buildPlayable();

        machine.totalCycles = 479 * TIC;
        chan.NR1.setValue(0xC0 | 0x3F);              // compteur à 1
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);  // le front est consommé ICI

        machine.totalCycles = 480 * TIC;
        chan.NR1.setValue(0xC0 | 0x3F);              // on le remonte à 1

        // Le tic 481 est impair : sa cloche vide le compteur. L'écriture qui suit porte le
        // trigger, mais aucun front — le bit 6 était déjà levé au tic 479.
        machine.totalCycles = 481 * TIC;
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);

        expect(chan.lengthRemaining(481 * TIC), 'rechargé à fond, et rien ne lui est retiré').toBe(64);
    });

    it('sur un minuteur encore plein, le trigger ne recharge pas mais le cran tombe', () => {
        const { machine, chan } = buildPlayable();
        chan.NR1.setValue(0xC0 | 0x3C); // 4 crans
        chan.NR4.setValue(TRIGGER);     // déclenché, longueur DÉBRANCHÉE : rien ne bouge

        machine.totalCycles = 3 * TIC;
        chan.NR4.setValue(TRIGGER | LENGTH_ENABLE);

        expect(chan.lengthRemaining(3 * TIC), 'pas de rechargement, mais le cran gratuit').toBe(3);
    });
});
