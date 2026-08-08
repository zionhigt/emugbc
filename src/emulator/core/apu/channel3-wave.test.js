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
 *   - 32 positions, qui avancent DEUX FOIS plus vite : le minuteur de fréquence du canal 3
 *     décompte tous les 2 T-cycles, là où celui d'un canal pulse décompte tous les 4 ;
 *   - le trigger remet la position à ZÉRO, là où le duty d'un canal pulse continue
 *     imperturbablement ;
 *   - pas d'enveloppe : le volume est un décalage fixe lu dans NR32.
 *
 *     niveau 0  muet          niveau 2  moitié   (>> 1)
 *     niveau 1  pleine échelle niveau 3  quart    (>> 2)
 *
 * LA GRILLE DE CE FICHIER EST LE DEMI-CYCLE MACHINE (2 T-cycles).
 *
 * C'est l'unité du minuteur du canal 3, et c'est la seule grille où le modèle tient : les
 * ROMs 09 et 12 mesurent une distinction de 2 T-cycles, structurellement invisible sur une
 * grille en cycles machine entiers. La période vaut donc `2048 - frequency` DEMI-cycles,
 * soit un échantillon toutes les `(2048 - frequency) / 2` cycles machine.
 *
 * L'interface, elle, ne change pas : `waveStep`, `waveByteIndexAt`, `isAccessingWaveAt`,
 * `waveSample` et `amplitude` reçoivent toujours des CYCLES MACHINE. Le demi-cycle est un
 * détail interne — et c'est précisément pour cela que la parité compte : le CPU n'agit
 * qu'aux demi-cycles PAIRS, `2 × cycle`.
 *
 * Ce que le matériel fait quand on lit ou écrit la wave RAM PENDANT que le canal joue
 * (blargg 09 et 12) a son bloc en milieu de fichier ; la corruption des quatre premiers
 * octets quand on redéclenche PENDANT un accès (blargg 10) a le dernier.
 *
 * ET LES DEUX INSTANTS NE SONT PAS LE MÊME. Un cycle machine dure deux demi-cycles : la
 * lecture du CPU se juge sur le PREMIER, la corruption au trigger sur le SECOND. Un
 * demi-cycle les sépare, et c'est mesuré, pas dérivé : les ROMs 09 et 12 calent la lecture,
 * la ROM 10 cale la corruption, et elles ne tombent d'accord sur aucune valeur commune. Les
 * deux blocs ont donc chacun sa parité de période au trigger, en miroir l'un de l'autre.
 */

const NR30 = 0xFF1A;
const NR32 = 0xFF1C;
const NR33 = 0xFF1D;
const NR34 = 0xFF1E;

const WAVE = 0xFF30;

const TRIGGER = 0x80;
const DAC_ON = 0x80;

/**
 * LE RETARD DU TRIGGER, EN DEMI-CYCLES : UNE CONSTANTE CALIBRÉE, PAS DÉRIVÉE.
 *
 * Au trigger, la date du prochain accès à la wave RAM vaut
 *
 *     prochainAcces = 2 × dateDuTrigger + périodeAuTrigger + RETARD      (en demi-cycles)
 *
 * Ces 3 demi-cycles ne se déduisent d'aucun schéma : ils mêlent le retard réel du trigger
 * de la wave sur DMG et NOTRE convention sur l'instant où une écriture atterrit dans le
 * cycle machine. Ils ont été trouvés par balayage — 170 combinaisons essayées sur
 * `09-wave read while on`, une seule passe — puis confirmés tels quels par
 * `12-wave write while on`, qui a une autre CRC et un autre chemin de code.
 *
 * Deux ROMs indépendantes s'accordent dessus : c'est une mesure, pas une démonstration.
 * Que personne ne la prenne plus tard pour une vérité dérivée.
 */
const RETARD = 3;

/** frequency = 1536 : période de 512 demi-cycles, donc un échantillon tous les 256 cycles. */
const FREQUENCY = 0x600;
const PERIODE = 2048 - FREQUENCY;
const PAS = PERIODE / 2;

/** frequency = 1539 : période de 509 demi-cycles — IMPAIRE, et 509 + RETARD = 512. */
const FREQ_TRIGGER = 0x603;
const PERIODE_TRIGGER = 2048 - FREQ_TRIGGER;

/** frequency = 1540 : période de 508 demi-cycles — PAIRE, et 508 + RETARD = 511, IMPAIR. */
const FREQ_TRIGGER_CORRUPTION = 0x604;
const PERIODE_TRIGGER_CORRUPTION = 2048 - FREQ_TRIGGER_CORRUPTION;

/** Le demi-cycle du premier accès sous cette phase : 511, donc en SECONDE moitié du cycle 255. */
const PREMIER_ACCES_CORRUPTION = PERIODE_TRIGGER_CORRUPTION + RETARD;

const buildHarness = () => {
    const machine = {
        totalCycles: 0,
        // Vitesse simple : les deux montres portent le même nombre (jalon KEY1, lot 0).
        get systemCycles() { return this.totalCycles; },
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

/** Pose une fréquence ET déclenche, à la date courante. */
const declencherA = (apu, frequence) => {
    apu.write(NR33, frequence & 0xFF);
    apu.write(NR34, TRIGGER | ((frequence >> 8) & 0x07));
};

/**
 * DÉCLENCHER EN LAISSANT LES ACCÈS TOMBER SUR DES CYCLES MACHINE ENTIERS.
 *
 * L'échéance du premier accès vaut `2 × trigger + périodeAuTrigger + RETARD` demi-cycles ;
 * le CPU, lui, n'agit qu'aux demi-cycles PAIRS. Déclencher directement à 0x600 (période
 * 512, PAIRE) poserait l'échéance sur un demi-cycle impair, et tous les accès de la note
 * avec elle : le canal jouerait, mais le CPU ne verrait JAMAIS sa fenêtre — c'est le bloc
 * « la parité de la période au trigger » qui le vérifie.
 *
 * On déclenche donc à 0x603, période 509, impaire, et 509 + 3 = 512 pile. Puis on pose
 * 0x600 AVANT que l'échéance n'échoie : l'échéance en vol garde sa valeur, si bien que le
 * premier accès tombe à 512 demi-cycles du trigger, soit PAS cycles machine, et que tous
 * les suivants, espacés d'une période PAIRE, restent sur la grille du CPU.
 *
 * Le harnais s'appuie donc sur deux règles du modèle : la période est lue AU trigger, et
 * l'échéance en vol survit à l'écriture de fréquence. Chacune a par ailleurs son test.
 */
const declencher = (apu) => {
    declencherA(apu, FREQ_TRIGGER);
    apu.write(NR33, FREQUENCY & 0xFF); // même octet haut : NR33 suffit, pas de re-trigger
};

/** Canal 3 alimenté, wave remplie, note lancée à la date 0. */
const buildPlaying = (niveau = 1) => {
    const harness = buildHarness();
    const { apu } = harness;
    MOTIF.forEach((octet, i) => apu.write(WAVE + i, octet));
    apu.write(NR30, DAC_ON);
    apu.write(NR32, niveau << 5);
    declencher(apu);
    return harness;
};

/**
 * DÉCLENCHER EN LAISSANT LA CORRUPTION TOMBER SUR DES CYCLES MACHINE ENTIERS.
 *
 * Miroir exact de `declencher`, à la parité près, et pour la raison inverse.
 *
 * La corruption au trigger se juge un demi-cycle APRÈS la lecture (voir l'en-tête du
 * dernier bloc). Sur la phase de `declencher` — période IMPAIRE, accès aux demi-cycles
 * PAIRS — elle tomberait donc systématiquement entre deux cycles machine, et aucune
 * écriture de NR34 ne pourrait jamais l'atteindre. Il faut l'autre parité.
 *
 * On déclenche donc à 0x604, période 508, PAIRE : l'échéance vaut 508 + 3 = 511 demi-cycles,
 * IMPAIRE. Les accès du canal tombent aux demi-cycles 511, 1023, 1535… — invisibles au CPU
 * en lecture, mais chacun dans la seconde moitié d'un cycle machine, là où la corruption se
 * juge. Puis on pose 0x600 comme dans `declencher` : même octet haut, donc NR33 suffit, et
 * l'échéance en vol garde sa valeur, si bien que la période redevient 512 sans bouger la
 * phase.
 */
const declencherPourLaCorruption = (apu) => {
    declencherA(apu, FREQ_TRIGGER_CORRUPTION);
    apu.write(NR33, FREQUENCY & 0xFF); // même octet haut : NR33 suffit, pas de re-trigger
};

/** Canal 3 alimenté, wave remplie, note lancée à la date 0 sur la phase de la CORRUPTION. */
const buildCorrupting = (niveau = 1) => {
    const harness = buildHarness();
    const { apu } = harness;
    MOTIF.forEach((octet, i) => apu.write(WAVE + i, octet));
    apu.write(NR30, DAC_ON);
    apu.write(NR32, niveau << 5);
    declencherPourLaCorruption(apu);
    return harness;
};

/** Même chose, mais déclenché tel quel sur la fréquence demandée — parité comprise. */
const buildTriggered = (frequence, niveau = 1) => {
    const harness = buildHarness();
    const { apu } = harness;
    MOTIF.forEach((octet, i) => apu.write(WAVE + i, octet));
    apu.write(NR30, DAC_ON);
    apu.write(NR32, niveau << 5);
    declencherA(apu, frequence);
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

    it('un échantillon toutes les 512 demi-cycles, et la frontière est exacte', () => {
        const { chan3 } = buildPlaying();
        // le premier accès est à 512 demi-cycles du trigger, soit PAS cycles machine
        expect(chan3.waveStep(PAS - 1), 'un cycle trop tôt, soit deux demi-cycles').toBe(0);
        expect(chan3.waveStep(PAS), 'pile').toBe(1);
        expect(chan3.waveStep(2 * PAS)).toBe(2);
        expect(chan3.waveStep(31 * PAS)).toBe(31);
    });

    it('elle avance DEUX FOIS plus vite que le rouleau d\'un canal pulse', () => {
        const { chan3 } = buildPlaying();
        // 512 : le canal pulse le lirait en cycles machine, le canal 3 en demi-cycles
        expect(chan3.period, 'la période est bien 512').toBe(512);
        expect(chan3.waveStep(512), 'deux échantillons en 512 cycles machine').toBe(2);
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
        declencher(apu);

        expect(chan3.waveStep(5 * PAS), 'repart de zéro').toBe(0);
        expect(chan3.waveStep(6 * PAS), 'et compte depuis là').toBe(1);
    });
});

describe('Wave - lire les quartets', () => {

    /**
     * Semer un octet précis dans la wave RAM demande que le canal se taise : tant qu'il
     * joue, l'écriture est redirigée vers l'octet qu'il occupe (voir le dernier bloc).
     * Couper le DAC l'éteint sans toucher à l'échéance, donc sans bouger la position.
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
 * L'ÉCHÉANCE DU PROCHAIN ACCÈS.
 *
 * Le canal 3 ne se souvient pas d'une paire (position, date) qu'on recompte après coup :
 * il porte un compteur qui décompte vers un ACCÈS, et ce compteur a été rechargé une fois
 * pour toutes au moment où il a été armé. D'où le modèle :
 *
 *   - au trigger, position = 0 et échéance = 2 × trigger + périodeAuTrigger + RETARD ;
 *   - à chaque échéance, position + 1, et rechargement avec la période COURANTE ;
 *   - une écriture de NR33 ou NR34 sans trigger fait avancer la position jusqu'à maintenant
 *     avec l'ANCIENNE période, mais NE TOUCHE PAS à l'échéance en cours.
 *
 * C'est toute la différence entre « le compteur en vol garde sa valeur de rechargement »
 * (le matériel) et « on repart de zéro à chaque écriture de fréquence » — cette dernière
 * détruit exactement l'information que `09-wave read while on` mesure.
 */
describe('Wave - l\'échéance du prochain accès', () => {

    it('le trigger arme l\'échéance : la période lue AU trigger, plus le retard calibré', () => {
        const { chan3 } = buildTriggered(FREQ_TRIGGER); // période 509

        // 509 + 3 = 512 demi-cycles, soit 256 cycles machine
        const echeance = (PERIODE_TRIGGER + RETARD) / 2;
        expect(echeance, 'l\'échéance tombe sur un cycle machine entier').toBe(256);
        expect(chan3.isAccessingWaveAt(echeance - 1), 'un cycle trop tôt').toBe(false);
        expect(chan3.isAccessingWaveAt(echeance), 'pile').toBe(true);
        expect(chan3.waveStep(echeance - 1), 'la position ne bouge qu\'à l\'accès').toBe(0);
        expect(chan3.waveStep(echeance), 'l\'accès la fait passer à 1').toBe(1);
    });

    it('une écriture de fréquence en vol ne touche pas l\'échéance en cours', () => {
        const { machine, apu, chan3 } = buildPlaying();

        // 0x700 : période 256 demi-cycles, deux fois plus rapide. On la pose à la date 0,
        // donc bien avant que l'échéance armée à 512 demi-cycles n'échoie.
        machine.totalCycles = 0;
        apu.write(NR34, 0x07); // bit 7 bas : on change la fréquence sans redéclencher

        expect(chan3.isAccessingWaveAt(128), 'la nouvelle période ne raccourcit pas l\'échéance en vol').toBe(false);
        expect(chan3.isAccessingWaveAt(PAS), 'elle échoit à l\'heure posée par le trigger').toBe(true);
        expect(chan3.isAccessingWaveAt(PAS + 128), 'seul le rechargement suivant prend le nouveau rythme').toBe(true);
        expect(chan3.waveStep(PAS + 128), 'deux accès écoulés').toBe(2);
    });

    it('le trigger repose l\'échéance : elle repart d\'une période pleine', () => {
        const { machine, apu, chan3 } = buildPlaying();
        expect(chan3.isAccessingWaveAt(PAS), 'l\'échéance d\'origine').toBe(true);

        machine.totalCycles = 100;
        declencher(apu);

        expect(chan3.waveStep(100), 'la position est remise à zéro').toBe(0);
        expect(chan3.isAccessingWaveAt(PAS), 'l\'ancienne échéance est annulée').toBe(false);
        expect(chan3.isAccessingWaveAt(100 + PAS), 'la nouvelle compte depuis le trigger').toBe(true);
        expect(chan3.waveStep(100 + PAS)).toBe(1);
    });
});

/**
 * LA PARITÉ DE LA PÉRIODE AU TRIGGER.
 *
 * La fenêtre d'accès est large d'UN demi-cycle, et le CPU n'agit qu'aux demi-cycles PAIRS
 * (`2 × cycle`). L'échéance vaut `2 × trigger + période + RETARD` : `2 × trigger` est pair
 * et RETARD est impair, donc la parité de l'échéance est CELLE DE LA PÉRIODE, inversée.
 *
 *     période IMPAIRE au trigger  ->  accès sur la grille du CPU, la wave RAM est lisible
 *     période PAIRE au trigger    ->  accès 2 T-cycles à côté, invisible pour toute la note
 *
 * Ce n'est pas un artefact : c'est l'observable que `09-wave read while on` balaye. La ROM
 * descend la période un cran à la fois et lit un octet sur deux — la moitié des périodes ne
 * rend jamais que 0xFF.
 */
describe('Wave - la parité de la période au trigger', () => {

    it.each([
        { nom: '0x601', frequence: 0x601, periode: 511 },
        { nom: '0x603', frequence: 0x603, periode: 509 },
        { nom: '0x605', frequence: 0x605, periode: 507 },
    ])('$nom, période IMPAIRE $periode : le CPU tombe pile sur l\'accès', ({ frequence, periode }) => {
        const { machine, apu } = buildTriggered(frequence);

        machine.totalCycles = (periode + RETARD) / 2;
        expect(apu.read(WAVE + 0x0F), 'l\'octet courant, adresse ignorée').toBe(MOTIF[0]);
    });

    it.each([
        { nom: '0x600', frequence: 0x600, periode: 512 },
        { nom: '0x602', frequence: 0x602, periode: 510 },
        { nom: '0x604', frequence: 0x604, periode: 508 },
    ])('$nom, période PAIRE $periode : l\'accès tombe entre deux cycles machine', ({ frequence, periode }) => {
        const { machine, apu } = buildTriggered(frequence);

        machine.totalCycles = (periode + RETARD - 1) / 2;
        expect(apu.read(WAVE), 'un demi-cycle trop tôt').toBe(0xFF);
        machine.totalCycles = (periode + RETARD + 1) / 2;
        expect(apu.read(WAVE), 'un demi-cycle trop tard').toBe(0xFF);
    });

    it('période PAIRE : le canal joue, mais le CPU ne verra la wave RAM à aucun cycle', () => {
        const { machine, apu, chan3 } = buildTriggered(0x604); // période 508

        for (let cycle = 0; cycle <= 4 * PAS; cycle++) {
            machine.totalCycles = cycle;
            expect(apu.read(WAVE), `cycle ${cycle}`).toBe(0xFF);
        }
        // 511, 1019, 1527, 2035 : quatre accès sous la lecture, tous sur des demi-cycles impairs
        expect(chan3.waveStep(4 * PAS), 'le canal, lui, a bien avancé').toBe(4);
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
 * Pandocs, `Audio_details.md`, dit QUAND le canal y touche :
 *
 *   « CH3 contains an internal sample index counter… Each increment causes the
 *     corresponding nibble to be read from wave RAM. »
 *
 * Donc à CHAQUE ÉCHANTILLON, pas à chaque octet : un octet porte deux échantillons, il est
 * lu deux fois. Et seulement à l'instant EXACT de l'accès, largeur un demi-cycle — c'est ce
 * qui rend la parité observable, et c'est pour cela que ce bloc n'existe que grâce au
 * harnais `declencher` (voir son commentaire).
 *
 * Deux notions à distinguer, d'où les deux méthodes :
 *   - QUEL octet le canal occupe — `waveByteIndexAt`, la position divisée par deux ;
 *   - QUAND il y touche — `isAccessingWaveAt`, l'instant où l'échéance échoit.
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

    it('la fenêtre s\'ouvre à CHAQUE échantillon, pas à chaque octet', () => {
        const { chan3 } = buildPlaying();

        expect(chan3.isAccessingWaveAt(0), 'le trigger ne lit rien : le premier accès est une période plus loin').toBe(false);
        expect(chan3.isAccessingWaveAt(PAS), 'premier accès').toBe(true);
        expect(chan3.isAccessingWaveAt(PAS + 1), 'un cycle plus tard, c\'est fini').toBe(false);
        expect(chan3.isAccessingWaveAt(2 * PAS), 'échantillon suivant : la fenêtre se rouvre').toBe(true);
        expect(chan3.isAccessingWaveAt(3 * PAS), 'et encore, sans avoir changé d\'octet').toBe(true);
        expect(chan3.isAccessingWaveAt(4 * PAS)).toBe(true);
    });

    it('deux accès par octet, et le second relit le MÊME octet', () => {
        const { machine, apu } = buildPlaying();

        // positions 1, 2, 3, 4 aux accès : octets 0, 1, 1, 2
        const lus = [1, 2, 3, 4].map((n) => {
            machine.totalCycles = n * PAS;
            return apu.read(WAVE);
        });
        expect(lus, 'le quartet bas rouvre la fenêtre sur son propre octet')
            .toEqual([MOTIF[0], MOTIF[1], MOTIF[1], MOTIF[2]]);
    });

    it('hors fenêtre, la lecture rend 0xFF', () => {
        const { machine, apu } = buildPlaying();

        machine.totalCycles = PAS + 1; // deux T-cycles après l'accès, c'est déjà trop tard
        expect(apu.read(WAVE + 0), 'le canal joue, mais il ne touche pas la RAM').toBe(0xFF);
        expect(apu.read(WAVE + 0x0F)).toBe(0xFF);

        machine.totalCycles = OCTET + 1;
        expect(apu.read(WAVE + 0), 'un échantillon plus loin, toujours pas').toBe(0xFF);
    });

    it('dans la fenêtre, la lecture rend l\'octet COURANT, quelle que soit l\'adresse', () => {
        const { machine, apu } = buildPlaying();

        machine.totalCycles = OCTET; // position 2 : le canal attaque l'octet 1
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

        machine.totalCycles = 3 * OCTET; // position 6 : le canal attaque l'octet 3
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
 * s'est déjà produit ne doit pas dépendre d'un réglage posé après coup. D'où l'avance
 * jusqu'à maintenant À L'ANCIENNE PÉRIODE au trigger et à chaque écriture qui touche la
 * fréquence, NR33 comme NR34 — sans toucher à l'échéance en vol.
 *
 * Arbitré par `09-wave read while on`, qui pose la période MINIMALE juste après le trigger
 * avant de lire la wave RAM — la manœuvre qui rend le défaut visible.
 */
describe('Wave - la position et les changements de période', () => {

    it('changer la fréquence en vol ne réécrit pas le passé', () => {
        const { machine, apu, chan3 } = buildPlaying();
        expect(chan3.waveStep(3 * PAS), 'trois échantillons écoulés').toBe(3);

        // 0x700 : période 256 demi-cycles, donc un échantillon tous les 128 cycles machine
        // — deux fois plus vite. Bit 7 bas : on change la fréquence sans redéclencher.
        machine.totalCycles = 3 * PAS;
        apu.write(NR34, 0x07);

        expect(chan3.waveStep(3 * PAS), 'la position ne bouge pas à l\'instant du changement').toBe(3);
        expect(chan3.waveStep(3 * PAS + 128), 'l\'échéance en vol court encore sur l\'ancienne période').toBe(3);
        expect(chan3.waveStep(3 * PAS + 256), 'elle échoit à l\'heure prévue avant le changement').toBe(4);
        expect(chan3.waveStep(3 * PAS + 256 + 128), 'et c\'est le rechargement suivant qui adopte le nouveau rythme').toBe(5);
        expect(chan3.waveStep(3 * PAS + 256 + 256)).toBe(6);
    });

    it('NR33 capture aussi : la position tient, seul le rythme change', () => {
        const { machine, apu, chan3 } = buildPlaying();
        expect(chan3.waveStep(5 * PAS)).toBe(5);

        // 0x680 : période 384 demi-cycles, un échantillon tous les 192 cycles machine.
        machine.totalCycles = 5 * PAS;
        apu.write(NR33, 0x80);

        expect(chan3.waveStep(5 * PAS), 'la position est capturée').toBe(5);
        expect(chan3.waveStep(5 * PAS + 192), 'l\'échéance en vol tient encore').toBe(5);
        expect(chan3.waveStep(5 * PAS + 256), 'elle échoit sur l\'ancienne période').toBe(6);
        expect(chan3.waveStep(5 * PAS + 256 + 192), 'nouveau rythme ensuite').toBe(7);
    });

    it('réécrire la même fréquence ne fait rien sauter', () => {
        const { machine, apu, chan3 } = buildPlaying();

        machine.totalCycles = 7 * PAS;
        apu.write(NR33, FREQUENCY & 0xFF); // la valeur qui y était déjà

        expect(chan3.waveStep(7 * PAS), 'toujours la même position').toBe(7);
        expect(chan3.waveStep(8 * PAS), 'et le même rythme').toBe(8);
    });
});

/**
 * LA SÉQUENCE MESURÉE DE `09-wave read while on`.
 *
 * La ROM déclenche le canal, pose IMMÉDIATEMENT la période minimale, laisse passer un délai
 * fixe, puis lit la wave RAM — et recommence en descendant la période du trigger d'un cran
 * à chaque tour. Le calage, mesuré :
 *
 *     cycle 0    NR33 = 2048 - période, NR34 = trigger | 0x07
 *     cycle 2    NR33 = 0xFE                  (fréquence 0x7FE, période 2)
 *     cycle 52   lecture de 0xFF30            (demi-cycle 104)
 *
 * Toute l'arithmétique tient en une ligne. L'échéance armée au trigger vaut `période + 3`
 * demi-cycles ; l'écriture de NR33 ne la touche pas, mais les rechargements SUIVANTS se
 * font à 2 demi-cycles. Les accès sont donc aux demi-cycles
 *
 *     période + 3,  période + 5,  période + 7,  …
 *
 * et la lecture, au demi-cycle 104, en attrape un si et seulement si
 * `104 >= période + 3` ET `104 - (période + 3)` est PAIR — c'est-à-dire période IMPAIRE et
 * période <= 101. Le k-ième accès (k à partir de 0) porte la position k + 1, donc l'octet
 * (k + 1) / 2 arrondi par le bas.
 *
 * La wave RAM est semée avec l'octet i = i × 0x11, et la ROM attend
 *
 *     FF FF 00 FF 11 FF 11 FF 22 …
 *
 * C'est le test qui a le plus de valeur du fichier : il fixe RETARD, la parité, la survie
 * de l'échéance et le pas d'un échantillon d'un seul coup. Le faire passer autrement, c'est
 * l'avoir cassé.
 */
describe('Wave - la séquence mesurée de blargg 09', () => {

    const ECRITURE = 2;  // cycle machine de l'écriture de NR33
    const LECTURE = 52;  // cycle machine de la lecture, soit le demi-cycle 104

    /** Octet i = i × 0x11, le motif de la ROM : 0x00, 0x11, 0x22 … 0xFF. */
    const RAMPE = Array.from({ length: 16 }, (_, i) => i * 0x11);

    const jouerLaSequence = (periode) => {
        const { machine, apu } = buildHarness();
        RAMPE.forEach((octet, i) => apu.write(WAVE + i, octet));
        apu.write(NR30, DAC_ON);
        apu.write(NR32, 1 << 5);

        const frequence = 2048 - periode;
        machine.totalCycles = 0;
        declencherA(apu, frequence);

        machine.totalCycles = ECRITURE;
        apu.write(NR33, 0xFE); // fréquence 0x7FE : période 2, la plus courte

        machine.totalCycles = LECTURE;
        return apu.read(WAVE);
    };

    it('la ROM pose bien 0x99 puis 0x87 pour la période 103', () => {
        const frequence = 2048 - 103;
        expect(frequence & 0xFF, 'NR33').toBe(0x99);
        expect(TRIGGER | ((frequence >> 8) & 0x07), 'NR34').toBe(0x87);
    });

    it.each([
        { nom: '0x99', periode: 103, lu: 0xFF, pourquoi: 'échéance 106 : encore devant la lecture' },
        { nom: '0x9A', periode: 102, lu: 0xFF, pourquoi: 'échéance 105 : devant, et impaire' },
        { nom: '0x9B', periode: 101, lu: 0x00, pourquoi: 'échéance 104 : la lecture tombe dessus, position 1, octet 0' },
        { nom: '0x9C', periode: 100, lu: 0xFF, pourquoi: 'échéance 103, impaire : 2 T-cycles à côté pour toujours' },
        { nom: '0x9D', periode: 99, lu: 0x11, pourquoi: 'accès à 102 puis 104 : position 2, octet 1' },
        { nom: '0x9E', periode: 98, lu: 0xFF, pourquoi: 'échéance 101, impaire' },
        { nom: '0x9F', periode: 97, lu: 0x11, pourquoi: 'accès à 100, 102, 104 : position 3, octet 1' },
        { nom: '0xA0', periode: 96, lu: 0xFF, pourquoi: 'échéance 99, impaire' },
        { nom: '0xA1', periode: 95, lu: 0x22, pourquoi: 'accès à 98, 100, 102, 104 : position 4, octet 2' },
    ])('NR33 = $nom, période $periode : la lecture rend $lu — $pourquoi', ({ periode, lu }) => {
        expect(jouerLaSequence(periode)).toBe(lu);
    });

    it('la séquence entière, telle que la ROM l\'attend', () => {
        const sequence = [103, 102, 101, 100, 99, 98, 97, 96, 95].map(jouerLaSequence);
        expect(sequence).toEqual([0xFF, 0xFF, 0x00, 0xFF, 0x11, 0xFF, 0x11, 0xFF, 0x22]);
    });

    /**
     * `12-wave write while on` emprunte le même chemin en sens inverse : la parité qui
     * décide si la lecture voit l'octet décide aussi si l'écriture l'atteint.
     */
    it('la même parité gouverne l\'ÉCRITURE — le chemin de blargg 12', () => {
        const ecrireLaSequence = (periode) => {
            const { machine, apu } = buildHarness();
            RAMPE.forEach((octet, i) => apu.write(WAVE + i, octet));
            apu.write(NR30, DAC_ON);
            apu.write(NR32, 1 << 5);

            machine.totalCycles = 0;
            declencherA(apu, 2048 - periode);
            machine.totalCycles = ECRITURE;
            apu.write(NR33, 0xFE);

            machine.totalCycles = LECTURE;
            apu.write(WAVE + 0x0F, 0xAB); // adresse ignorée si la fenêtre est ouverte

            apu.write(NR30, 0x00); // DAC coupé : la RAM redevient lisible telle quelle
            return [apu.read(WAVE + 0x00), apu.read(WAVE + 0x0F)];
        };

        expect(ecrireLaSequence(101), 'période impaire : l\'octet courant prend, pas celui visé')
            .toEqual([0xAB, RAMPE[15]]);
        expect(ecrireLaSequence(100), 'période paire : l\'écriture est perdue des deux côtés')
            .toEqual([RAMPE[0], RAMPE[15]]);
    });
});

/**
 * LA CORRUPTION DE LA WAVE RAM AU TRIGGER.
 *
 * Wiki gbdev, section « Obscure Behavior »,
 * https://gbdev.gg8.se/wiki/articles/Gameboy_sound_hardware :
 *
 *   « Triggering the wave channel on the DMG while it reads a sample byte will alter the
 *     first four bytes of wave RAM. If the channel was reading one of the first four bytes,
 *     the only first byte will be rewritten with the byte being read. If the channel was
 *     reading one of the later 12 bytes, the first FOUR bytes of wave RAM will be rewritten
 *     with the four aligned bytes that the read was from (bytes 4-7, 8-11, or 12-15); for
 *     example if it were reading byte 9 when it was retriggered, the first four bytes would
 *     be rewritten with the contents of bytes 8-11. »
 *
 *   « To avoid this corruption you should stop the wave by writing 0 then $80 to NR30
 *     before triggering it again. The game Duck Tales encounters this issue part way
 *     through most songs. »
 *
 * En clair, avec `index` l'octet que le canal occupait à l'instant du trigger :
 *
 *     index < 4    ->  octet 0 = octet index, et RIEN d'autre ne bouge
 *     index >= 4   ->  octets 0..3 = octets (index & ~3) .. (index & ~3) + 3
 *
 * Deux paramètres, donc, et deux seulement : la FRONTIÈRE à 4, et l'ALIGNEMENT par 4
 * au-delà. Les douze derniers octets ne sont jamais touchés, dans aucun des deux cas.
 *
 * La règle ne s'arme que si le canal était ALLUMÉ et DANS SA FENÊTRE d'accès à l'instant
 * précis du trigger — les deux mêmes conditions que la lecture et l'écriture portées du
 * bloc précédent. C'est ce qui rend le contournement possible : éteindre le canal juste
 * avant, comme le wiki le recommande, ferme la fenêtre et la corruption n'a pas lieu.
 *
 * MAIS PAS AU MÊME INSTANT QUE LA LECTURE, ET C'EST TOUT L'OBJET DE CE BLOC.
 *
 * Un cycle machine dure deux demi-cycles. La lecture et l'écriture de la wave RAM se jugent
 * sur le PREMIER — c'est ce que fixent `09` et `12`, à `période + 3` demi-cycles du trigger.
 * La corruption, elle, se juge sur le SECOND : un demi-cycle plus tard, soit `période + 2`
 * ramené sur la grille des dates du CPU. C'est ce que fixe `10`, et rien d'autre : sous le
 * calage de la lecture, la ROM reste rouge ; d'un demi-cycle plus loin, elle passe.
 *
 * CALIBRÉ PAR LES ROMs, PAS DÉRIVÉ DU MATÉRIEL — comme RETARD lui-même, dont ce second
 * instant est le voisin immédiat. Il a été trouvé par balayage : 84 combinaisons de largeur
 * et de phase, chacune une exécution complète de la ROM, une seule passante. La piste « la
 * fenêtre du trigger est plus large que celle de la lecture » a été essayée et RÉFUTÉE :
 * aucune largeur supérieure à un demi-cycle ne passe, à aucune phase. Ce n'est pas une
 * tolérance, c'est un décalage. Que personne ne le prenne plus tard pour une vérité dérivée.
 *
 * CONSÉQUENCE SUR LE HARNAIS, et c'est structurel, pas un réglage. La fenêtre est large d'UN
 * demi-cycle et le CPU n'agit qu'aux demi-cycles PAIRS : sur une même note, la lecture et la
 * corruption ne peuvent donc pas être toutes deux atteignables. La parité de la période au
 * trigger choisit laquelle. `buildPlaying` (période 509, IMPAIRE) rend la LECTURE visible —
 * c'est la phase des blocs précédents ; `buildCorrupting` (période 508, PAIRE) rend la
 * CORRUPTION atteignable — c'est celle-ci. Les deux formes sont des miroirs exacts : mêmes
 * octets, mêmes indices, mêmes quadruplets, à un cycle machine près.
 *
 * PIÈGE D'ORDRE, pour qui implémente. `NRegister4.setValue` pose `_isEnabled` PUIS appelle
 * `onTrigger`, qui remet la position à zéro : quand `onTrigger` s'exécute, l'état qui
 * décide de la corruption a déjà disparu. Elle se lit donc à l'entrée de l'écriture de
 * NR34, avant que quoi que ce soit n'ait bougé. Ces tests, eux, n'exigent que le résultat
 * observable : on redéclenche, on éteint, on relit les seize octets.
 *
 * LA SÉQUENCE DE `10-wave trigger while on`, source lu : la ROM charge son motif, joue une
 * note, puis redéclenche par une écriture de NR34 SEULE — NR33 a été posé 168 clocks plus
 * tôt. Elle recommence 69 fois en décalant la période du premier trigger, ce qui déplace la
 * phase de 2 T-cycles par itération : chaque tour attrape le canal sur un autre octet, ou
 * hors fenêtre. C'est ce balayage qui rend les deux moitiés de la règle observables, et
 * c'est pourquoi le redéclenchement se fait ici aussi par NR34 seul.
 */
describe('Wave - la corruption de la wave RAM au trigger', () => {

    /** NR34 seul, bit 7 armé : `buildCorrupting` a laissé la fréquence à 0x600, on la reprend. */
    const REDECLENCHEMENT = TRIGGER | ((FREQUENCY >> 8) & 0x07);

    /**
     * LE CYCLE MACHINE DONT LA SECONDE MOITIÉ ATTRAPE L'OCTET `index`.
     *
     * Sous `buildCorrupting`, l'échéance vaut 508 + RETARD = 511 demi-cycles et se recharge
     * toutes les 512 : les accès du canal tombent aux demi-cycles IMPAIRS 511, 1023, 1535…
     * Le n-ième d'entre eux occupe donc la SECONDE moitié du cycle machine n × PAS − 1, et
     * porte la position n, donc l'octet `n / 2` arrondi par le bas.
     *
     * n = 2 × index vise le quartet HAUT de l'octet voulu. L'octet 0 fait exception — sa
     * première occurrence, n = 0, est l'instant du trigger lui-même, où aucun accès n'a
     * encore eu lieu. On le prend un tour plus loin, n = 32, qui ramène la position à 0 :
     * même octet, même quartet, même phase.
     *
     * Ce sont exactement les dates de la phase de lecture, MOINS UN CYCLE MACHINE.
     */
    const accesA = (index) => {
        const rang = index === 0 ? 32 : 2 * index;
        const demiCycle = PREMIER_ACCES_CORRUPTION + (rang - 1) * PERIODE;
        return (demiCycle - 1) / 2; // le cycle machine dont il occupe la seconde moitié
    };

    /** Éteindre le canal rouvre la RAM à l'adressage normal ; NR30 ne touche pas son contenu. */
    const lireLaRAM = (apu) => {
        apu.write(NR30, 0x00);
        return Array.from({ length: 16 }, (_, i) => apu.read(WAVE + i));
    };

    /** Redéclenche PILE sur l'accès à `index`, puis rend les seize octets. */
    const corrompreSur = (index) => {
        const { machine, apu } = buildCorrupting();
        machine.totalCycles = accesA(index);
        apu.write(NR34, REDECLENCHEMENT);
        return lireLaRAM(apu);
    };

    it.each([
        { nom: '0x00', index: 0, precedent: 15 },
        { nom: '0x01', index: 1, precedent: 0 },
        { nom: '0x04', index: 4, precedent: 3 },
        { nom: '0x09', index: 9, precedent: 8 },
        { nom: '0x0F', index: 15, precedent: 14 },
    ])('le harnais vise juste : l\'accès à l\'octet $nom tombe dans la seconde moitié du cycle', ({ index, precedent }) => {
        const { chan3 } = buildCorrupting();
        const cycle = accesA(index);

        expect(chan3.isAccessingWaveAt(cycle), 'la fenêtre de LECTURE, elle, reste fermée : ce n\'est pas la même phase').toBe(false);
        expect(chan3.waveByteIndexAt(cycle), 'au début du cycle machine, le canal en est encore à l\'octet précédent').toBe(precedent);
        expect(chan3.waveByteIndexAt(cycle + 1), 'l\'accès a eu lieu entre les deux : c\'est cet octet-là qu\'il portait').toBe(index);
    });

    it.each([
        { nom: '0x01', index: 1 },
        { nom: '0x02', index: 2 },
        { nom: '0x03', index: 3 },
    ])('octet $nom, sous la frontière : seul l\'octet 0 est réécrit, avec l\'octet lu', ({ index }) => {
        const ram = corrompreSur(index);

        expect(ram[0], 'l\'octet 0 prend la valeur de l\'octet que le canal lisait').toBe(MOTIF[index]);
        expect(ram.slice(1), 'les quinze autres ne bougent pas d\'un bit').toEqual(MOTIF.slice(1));
    });

    it('octet 0x00 : la règle s\'applique, mais elle recopie l\'octet 0 sur lui-même', () => {
        expect(corrompreSur(0), 'rien de visible — et c\'est la règle qui le dit, pas une exemption')
            .toEqual(MOTIF);
    });

    it.each([
        { nom: '0x04', index: 4, base: 4 },
        { nom: '0x05', index: 5, base: 4 },
        { nom: '0x07', index: 7, base: 4 },
        { nom: '0x08', index: 8, base: 8 },
        { nom: '0x09', index: 9, base: 8 }, // l'exemple donné par le wiki
        { nom: '0x0B', index: 11, base: 8 },
        { nom: '0x0C', index: 12, base: 12 },
        { nom: '0x0F', index: 15, base: 12 },
    ])('octet $nom : les quatre premiers prennent le quadruplet aligné qui commence en $base', ({ index, base }) => {
        const ram = corrompreSur(index);

        expect(ram.slice(0, 4), `le quadruplet ${base}..${base + 3} est recopié en tête`)
            .toEqual(MOTIF.slice(base, base + 4));
        expect(ram.slice(4), 'les douze derniers octets ne sont jamais touchés')
            .toEqual(MOTIF.slice(4));
    });

    it('la frontière est bien à 4 : l\'octet 3 n\'en réécrit qu\'un, l\'octet 4 en réécrit quatre', () => {
        expect(corrompreSur(3).slice(0, 4), 'octet 3 : seul l\'octet 0 bouge')
            .toEqual([MOTIF[3], MOTIF[1], MOTIF[2], MOTIF[3]]);
        expect(corrompreSur(4).slice(0, 4), 'octet 4 : les quatre bougent d\'un coup')
            .toEqual([MOTIF[4], MOTIF[5], MOTIF[6], MOTIF[7]]);
    });

    it('l\'alignement écrase le reste du quadruplet : lire l\'octet 11 ramène 8, 9, 10, 11', () => {
        expect(corrompreSur(11).slice(0, 4), 'ce n\'est pas « les quatre octets à partir de 11 »')
            .toEqual(MOTIF.slice(8, 12));
    });

    /**
     * Le témoin en tête n'est pas décoratif : sur cette phase, la fenêtre de LECTURE n'est
     * ouverte à aucun cycle machine de la note, donc `isAccessingWaveAt` répond false
     * partout et ne peut plus servir de garde-fou. Sans le témoin, ces trois cas passeraient
     * aussi sur une implémentation qui ne corrompt jamais rien.
     */
    it.each([
        { nom: '+1', decalage: 1, quand: 'un cycle machine après l\'accès' },
        { nom: '-1', decalage: -1, quand: 'un cycle machine avant l\'accès' },
        { nom: '+128', decalage: PAS / 2, quand: 'à mi-chemin entre deux accès' },
    ])('hors fenêtre ($nom, $quand), rien ne bouge', ({ decalage }) => {
        expect(corrompreSur(9).slice(0, 4), 'témoin : à deux demi-cycles près, cet instant corrompt')
            .toEqual(MOTIF.slice(8, 12));

        const { machine, apu } = buildCorrupting();
        const cycle = accesA(9) + decalage;

        machine.totalCycles = cycle;
        apu.write(NR34, REDECLENCHEMENT);

        expect(lireLaRAM(apu), 'le canal jouait, mais il ne touchait pas la RAM à cet instant')
            .toEqual(MOTIF);
    });

    it('canal jamais déclenché : le premier trigger d\'une note ne corrompt rien', () => {
        const { machine, apu } = buildHarness();
        MOTIF.forEach((octet, i) => apu.write(WAVE + i, octet));
        apu.write(NR30, DAC_ON);
        apu.write(NR32, 1 << 5);

        machine.totalCycles = 1000; // une date quelconque : aucun accès n'est encore armé
        declencherPourLaCorruption(apu);

        expect(lireLaRAM(apu), 'aucun octet en cours de lecture, donc rien à recopier')
            .toEqual(MOTIF);
    });

    /**
     * LE CONTOURNEMENT DE DUCK TALES.
     *
     * « To avoid this corruption you should stop the wave by writing 0 then $80 to NR30
     *   before triggering it again. »
     *
     * C'est le test qui a le plus de valeur d'usage du bloc : couper le DAC éteint le canal,
     * donc ferme sa fenêtre, et le trigger qui suit ne trouve plus rien à recopier. Le
     * témoin en tête vérifie que l'instant choisi corrompt bel et bien sans la manœuvre —
     * sans lui, ce test passerait aussi sur un émulateur qui ignore purement la règle.
     */
    it('le contournement documenté : 0 puis 0x80 dans NR30 avant de redéclencher', () => {
        expect(corrompreSur(9).slice(0, 4), 'témoin : à nu, cet instant corrompt')
            .toEqual(MOTIF.slice(8, 12));

        const { machine, apu } = buildCorrupting();
        machine.totalCycles = accesA(9);
        apu.write(NR30, 0x00);   // le canal s'éteint : il ne lit plus la RAM
        apu.write(NR30, DAC_ON); // le DAC revient, mais le canal reste éteint jusqu'au trigger
        apu.write(NR34, REDECLENCHEMENT);

        expect(lireLaRAM(apu), 'la manœuvre préserve les seize octets').toEqual(MOTIF);
    });

    it('le trigger fait son office par ailleurs : position à zéro, échéance réarmée', () => {
        const { machine, apu, chan3 } = buildCorrupting();
        const cycle = accesA(9);
        expect(chan3.waveStep(cycle), 'position 17 au début du cycle machine').toBe(17);
        expect(chan3.waveStep(cycle + 1), 'l\'accès attrapé porte la position 18, le quartet haut de l\'octet 9').toBe(18);

        machine.totalCycles = cycle;
        apu.write(NR34, REDECLENCHEMENT);

        expect(chan3.waveStep(cycle), 'la position repart de zéro').toBe(0);
        // 0x600 : période PAIRE au trigger, donc l'échéance tombe un demi-cycle après le
        // cycle machine — le canal joue, mais le CPU ne verra pas sa fenêtre (voir le bloc
        // « la parité de la période au trigger »). La position, elle, avance quand même.
        expect(chan3.waveStep(cycle + (PERIODE + RETARD - 1) / 2), 'un cycle trop tôt').toBe(0);
        expect(chan3.waveStep(cycle + (PERIODE + RETARD + 1) / 2), 'l\'échéance réarmée').toBe(1);

        expect(lireLaRAM(apu), 'et la corruption a bien eu lieu au passage')
            .toEqual([...MOTIF.slice(8, 12), ...MOTIF.slice(4)]);
    });

    /**
     * LES DEUX INSTANTS NE SONT PAS LE MÊME, ET C'EST CE QUE CES DEUX TESTS NOMMENT.
     *
     * Le reste du bloc décrit CE QUE la corruption recopie ; ces deux-là disent QUAND, et
     * disent que ce quand n'est pas celui de la lecture. Ils se lisent ensemble : chacun
     * prend une parité de période au trigger, et montre que sur cette parité l'une des deux
     * règles s'arme pendant que l'autre reste muette. Un modèle qui juge les deux au même
     * demi-cycle en échoue forcément un — c'est là toute la mesure, réduite à deux cas.
     *
     * Le second, en particulier, est le seul test du fichier qui exige un NON-effet à un
     * instant où le canal touche pourtant la RAM sous les yeux du CPU.
     */
    it('sur la phase de la corruption, le CPU ne voit RIEN de la wave RAM', () => {
        const { machine, apu, chan3 } = buildCorrupting();
        const cycle = accesA(9);

        machine.totalCycles = cycle;
        expect(chan3.isAccessingWaveAt(cycle), 'la fenêtre de lecture est fermée').toBe(false);
        expect(apu.read(WAVE), 'le CPU ne lit que 0xFF').toBe(0xFF);
        expect(apu.read(WAVE + 0x09), 'à toute adresse').toBe(0xFF);

        apu.write(NR34, REDECLENCHEMENT);

        expect(lireLaRAM(apu).slice(0, 4), 'la corruption, elle, a bien eu lieu au même cycle machine')
            .toEqual(MOTIF.slice(8, 12));
    });

    it('et réciproquement : là où le CPU lit l\'octet, le trigger ne corrompt pas', () => {
        const { machine, apu, chan3 } = buildPlaying(); // période IMPAIRE : la phase de la LECTURE
        const cycle = 2 * 9 * PAS;                      // l'accès qui porte l'octet 9

        machine.totalCycles = cycle;
        expect(chan3.isAccessingWaveAt(cycle), 'la fenêtre de lecture est grande ouverte').toBe(true);
        expect(apu.read(WAVE), 'le CPU lit bien l\'octet 9 en direct').toBe(MOTIF[9]);

        apu.write(NR34, REDECLENCHEMENT);

        expect(lireLaRAM(apu), 'un demi-cycle plus loin, l\'accès est déjà passé : rien n\'est corrompu')
            .toEqual(MOTIF);
    });
});
