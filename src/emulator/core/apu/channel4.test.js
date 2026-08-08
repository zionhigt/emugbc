import { describe, it, expect } from 'vitest';

import buildAPU from './index';
import buildTimer from '../timer/index';

/**
 * CRAN 12a : LE CANAL 4 EXISTE.
 *
 *   NR40 (0xFF1F)  slot 0 fantôme, comme celui du canal 2
 *   NR41 (0xFF20)  longueur sur 6 bits — pas de duty dans les bits de tête
 *   NR42 (0xFF21)  volume, sens et période d'enveloppe — identique à NR22
 *   NR43 (0xFF22)  réglages du générateur de bruit (cran suivant)
 *   NR44 (0xFF23)  trigger et length enable — AUCUN bit de fréquence
 *
 * C'est le canal le moins cher des quatre : longueur, enveloppe, DAC, trigger et bit de
 * NR52 sont rigoureusement ceux d'un canal pulse. Ce qui change, c'est ce qu'il n'a pas —
 * ni fréquence, ni période, ni rouleau. Le registre à décalage qui les remplace viendra
 * à son propre cran, et aucune ROM ne l'écoute.
 *
 * Ce cran vise `01-registers`, à qui il ne manque plus que ces cinq adresses et le mixage.
 */

const NR21 = 0xFF16;
const NR22 = 0xFF17;
const NR24 = 0xFF19;

const NR40 = 0xFF1F;
const NR41 = 0xFF20;
const NR42 = 0xFF21;
const NR43 = 0xFF22;
const NR44 = 0xFF23;

const NR52 = 0xFF26;

const TRIGGER = 0x80;
const LENGTH_ENABLE = 0x40;

const TIC = 2048;
/** Date du n-ième coup de la cloche longueur : elle frappe aux tics impairs. */
const clocheLongueur = (n) => (2 * n - 1) * TIC;
const cloche = (n) => 8 * n * TIC; // n-ième cloche d'enveloppe, 64 Hz

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
    return { machine, apu, chan4: apu.channel4 };
};

describe('Canal 4 - le câblage', () => {

    it('l\'APU expose un canal 4', () => {
        const { chan4 } = buildHarness();
        expect(chan4, 'apu.channel4').toBeDefined();
    });

    it('NR40 est un slot fantôme : il ne retient rien et se lit 0xFF', () => {
        const { apu } = buildHarness();
        apu.write(NR40, 0xC0);
        expect(apu.read(NR40)).toBe(0xFF);
    });

    it('NR44 porte le trigger et le length enable', () => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR42, 0xF0);
        apu.write(NR44, TRIGGER | LENGTH_ENABLE);
        expect(chan4.isEnabled).toBe(true);
        expect(chan4.isLengthEnabled).toBe(true);
    });
});

describe('Canal 4 - la longueur, comme un canal pulse', () => {

    it.each([
        { ecrit: 0x00, reste: 64 },
        { ecrit: 0x01, reste: 63 },
        { ecrit: 0x3C, reste: 4 },
        { ecrit: 0x3F, reste: 1 },
    ])('NR41 = $ecrit remonte le minuteur à $reste crans', ({ ecrit, reste }) => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR41, ecrit);
        expect(chan4.lengthRemaining(0)).toBe(reste);
    });

    it('les deux bits de tête ne servent à rien : pas de duty ici', () => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR41, 0xC0 | 0x3C);
        expect(chan4.lengthRemaining(0), 'seuls les 6 bits de queue comptent').toBe(4);
    });

    it('un cran par coup de cloche, et la note s\'arrête à sec', () => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR41, 0x3C); // 4 crans
        apu.write(NR42, 0xF0);
        apu.write(NR44, TRIGGER | LENGTH_ENABLE);

        expect(chan4.lengthRemaining(clocheLongueur(2))).toBe(2);
        expect(chan4.isEnabledAt(clocheLongueur(3)), 'il reste un cran').toBe(true);
        expect(chan4.isEnabledAt(clocheLongueur(4)), 'à sec').toBe(false);
    });

    it('déclencher un minuteur à sec le remonte à 64, pas à 256', () => {
        const { machine, apu, chan4 } = buildHarness();
        apu.write(NR41, 0x3F); // un cran
        apu.write(NR42, 0xF0);
        apu.write(NR44, TRIGGER | LENGTH_ENABLE);
        expect(chan4.lengthRemaining(clocheLongueur(1)), 'à sec').toBe(0);

        // Tic 2 : l'étape suivante est une étape de longueur, donc pas de cran de la
        // règle 2 — le rechargement se lit à nu.
        machine.totalCycles = 2 * TIC;
        apu.write(NR44, TRIGGER | LENGTH_ENABLE);
        expect(chan4.lengthRemaining(2 * TIC), 'le maximum d\'un canal 6 bits').toBe(64);
    });
});

describe('Canal 4 - le DAC et l\'enveloppe, comme un canal pulse', () => {

    it('le DAC est alimenté par les cinq bits de tête de NR42', () => {
        const { apu, chan4 } = buildHarness();
        expect(chan4.isDacOn, 'au repos').toBe(false);
        apu.write(NR42, 0x08);
        expect(chan4.isDacOn, 'le seul bit de sens suffit').toBe(true);
        apu.write(NR42, 0x07);
        expect(chan4.isDacOn, 'la période seule n\'alimente rien').toBe(false);
    });

    it('DAC coupé, le trigger n\'allume pas le canal', () => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR44, TRIGGER);
        expect(chan4.isEnabled).toBe(false);
    });

    it('couper le DAC en vol éteint le canal', () => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR42, 0xF0);
        apu.write(NR44, TRIGGER);
        expect(chan4.isEnabled, 'il jouait').toBe(true);

        apu.write(NR42, 0x00);
        expect(chan4.isEnabled, 'coupé').toBe(false);
    });

    it('l\'enveloppe fait dériver le volume', () => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR42, 0xF3); // volume 15, descendant, période 3
        apu.write(NR44, TRIGGER);

        expect(chan4.volumeAt(0)).toBe(15);
        expect(chan4.volumeAt(cloche(3))).toBe(14);
        expect(chan4.volumeAt(cloche(45)), 'à sec').toBe(0);
    });
});

describe('Canal 4 - NR52 le voit sur le bit 3', () => {

    it('le bit 3 se lève quand le canal 4 joue', () => {
        const { apu } = buildHarness();
        apu.write(NR42, 0xF0);
        apu.write(NR44, TRIGGER);
        expect(apu.read(NR52)).toBe(0xF8);
    });

    it('les quatre canaux ont chacun leur bit', () => {
        const { apu } = buildHarness();
        apu.write(0xFF12, 0xF0);
        apu.write(0xFF14, TRIGGER);
        apu.write(NR22, 0xF0);
        apu.write(NR24, TRIGGER);
        apu.write(0xFF1A, 0x80);
        apu.write(0xFF1E, TRIGGER);
        apu.write(NR42, 0xF0);
        apu.write(NR44, TRIGGER);

        expect(apu.read(NR52), 'les quatre allumés').toBe(0xFF);
    });

    it('éteindre l\'APU coupe le canal 4 aussi', () => {
        const { apu, chan4 } = buildHarness();
        apu.write(NR42, 0xF0);
        apu.write(NR44, TRIGGER);

        apu.write(NR52, 0x00);
        expect(chan4.isEnabled).toBe(false);
    });
});

describe('Canal 4 - il est indépendant du canal 2', () => {

    it('même classe, états séparés', () => {
        const { apu } = buildHarness();
        apu.write(NR21, 0x3F); // canal 2 : 1 cran
        apu.write(NR41, 0x3C); // canal 4 : 4 crans
        apu.write(NR22, 0xA0); // canal 2 : volume 10
        apu.write(NR42, 0x50); // canal 4 : volume 5

        expect(apu.channel2.lengthRemaining(0)).toBe(1);
        expect(apu.channel4.lengthRemaining(0)).toBe(4);
        expect(apu.channel2.initialVolume).toBe(10);
        expect(apu.channel4.initialVolume).toBe(5);
    });

    it('déclencher l\'un n\'allume pas l\'autre', () => {
        const { apu } = buildHarness();
        apu.write(NR22, 0xF0);
        apu.write(NR42, 0xF0);

        apu.write(NR44, TRIGGER);
        expect(apu.channel4.isEnabled, 'déclenché').toBe(true);
        expect(apu.channel2.isEnabled, 'pas touché').toBe(false);
    });
});

/**
 * NR50 et NR51 n'appartiennent à aucun canal : ce sont les registres de MIXAGE de l'APU,
 * le volume gauche/droite et le routage de chaque canal vers chaque sortie. Ils ne feront
 * quelque chose qu'à l'arrivée de l'échantillonnage, mais ils sont à l'APU, pas des
 * bouche-trous pour une unité absente — et ce sont les deux dernières adresses qui
 * séparent `01-registers` du vert.
 */
describe('Mixage - NR50 et NR51 existent', () => {

    it.each([
        { addr: 0xFF24, nom: 'NR50' },
        { addr: 0xFF25, nom: 'NR51' },
    ])('$nom retient ce qu\'on lui écrit, sans masque', ({ addr }) => {
        const { apu } = buildHarness();
        apu.write(addr, 0xA5);
        expect(apu.read(addr)).toBe(0xA5);
        apu.write(addr, 0x00);
        expect(apu.read(addr)).toBe(0x00);
    });

    it('éteindre l\'APU les remet à zéro', () => {
        const { apu } = buildHarness();
        apu.write(0xFF24, 0x77);
        apu.write(0xFF25, 0xFF);

        apu.write(NR52, 0x00);
        expect(apu.read(0xFF24)).toBe(0x00);
        expect(apu.read(0xFF25)).toBe(0x00);
    });
});
