import { describe, it, expect } from 'vitest';

import buildAPU from './index';
import buildTimer from '../timer/index';

/**
 * CRAN 11a : LE CANAL 3 EXISTE.
 *
 *   NR30 (0xFF1A)  bit 7 = alimentation du DAC — un vrai bit dédié
 *   NR31 (0xFF1B)  longueur sur 8 bits pleins
 *   NR32 (0xFF1C)  niveau de sortie (cran suivant)
 *   NR33 (0xFF1D)  fréquence basse
 *   NR34 (0xFF1E)  trigger, length enable, fréquence haute
 *
 * Trois différences avec les canaux pulse, et ce sont elles que ce fichier vérifie :
 *   - le DAC n'est plus déduit des bits de volume, il a son propre bit ;
 *   - le minuteur part de 256 - valeur, pas de 64 - valeur, et lit les 8 bits ;
 *   - il n'y a pas d'enveloppe.
 *
 * Pas de son dans ce cran : la lecture de la wave RAM et le niveau de sortie viennent
 * après. Ce qui est visé ici, c'est ce que blargg `02-len ctr` réclame — il bute
 * aujourd'hui sur 0xFF1B et 0xFF1E.
 */

const NR30 = 0xFF1A;
const NR31 = 0xFF1B;
const NR32 = 0xFF1C;
const NR33 = 0xFF1D;
const NR34 = 0xFF1E;

const NR12 = 0xFF12;
const NR14 = 0xFF14;
const NR21 = 0xFF16;
const NR22 = 0xFF17;
const NR24 = 0xFF19;
const NR52 = 0xFF26;

const TRIGGER = 0x80;
const LENGTH_ENABLE = 0x40;
const DAC_ON = 0x80;

const TIC = 2048;
const CLOCHE = 2 * TIC; // la cloche longueur, 256 Hz

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
    return { machine, apu, chan3: apu.channel3 };
};

describe('Canal 3 - le câblage', () => {

    it('l\'APU expose un canal 3', () => {
        const { chan3 } = buildHarness();
        expect(chan3, 'apu.channel3').toBeDefined();
    });

    it('NR33 et NR34 portent la fréquence', () => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR33, 0x34);
        apu.write(NR34, 0x05);
        expect(chan3.frequency).toBe(0x534);
    });

    it('NR34 porte le length enable', () => {
        const { apu, chan3 } = buildHarness();
        expect(chan3.isLengthEnabled, 'au repos').toBe(false);
        apu.write(NR34, LENGTH_ENABLE);
        expect(chan3.isLengthEnabled).toBe(true);
    });
});

describe('Canal 3 - le DAC a son propre bit', () => {

    it('bit 7 de NR30, et rien d\'autre', () => {
        const { apu, chan3 } = buildHarness();
        expect(chan3.isDacOn, 'au repos').toBe(false);
        apu.write(NR30, DAC_ON);
        expect(chan3.isDacOn).toBe(true);
    });

    it('les bits de queue de NR30 n\'alimentent rien', () => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR30, 0x7F); // tout sauf le bit 7
        expect(chan3.isDacOn, 'aucun de ces bits ne compte').toBe(false);
    });

    it('ce n\'est PAS le mécanisme des canaux pulse', () => {
        const { apu, chan3 } = buildHarness();
        // sur un canal pulse, 0x08 dans NR2 suffirait à alimenter le DAC
        apu.write(NR32, 0xFF);
        expect(chan3.isDacOn, 'NR32 n\'alimente rien').toBe(false);
    });

    it('DAC coupé, le trigger n\'allume pas le canal', () => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR34, TRIGGER);
        expect(chan3.isEnabled).toBe(false);
    });

    it('DAC alimenté, le trigger allume le canal', () => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR30, DAC_ON);
        apu.write(NR34, TRIGGER);
        expect(chan3.isEnabled).toBe(true);
    });

    it('couper le DAC en vol éteint le canal', () => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR30, DAC_ON);
        apu.write(NR34, TRIGGER);
        expect(chan3.isEnabled, 'il jouait').toBe(true);

        apu.write(NR30, 0x00);
        expect(chan3.isEnabled, 'coupé').toBe(false);
    });

    it('rallumer le DAC ne rallume pas le canal', () => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR30, DAC_ON);
        apu.write(NR34, TRIGGER);
        apu.write(NR30, 0x00);
        apu.write(NR30, DAC_ON);
        expect(chan3.isEnabled, 'il faut redéclencher').toBe(false);
    });
});

describe('Canal 3 - le minuteur compte sur 8 bits', () => {

    it.each([
        { ecrit: 0x00, reste: 256 },
        { ecrit: 0x01, reste: 255 },
        { ecrit: 0x3F, reste: 193 },
        { ecrit: 0xFC, reste: 4 },
        { ecrit: 0xFF, reste: 1 },
    ])('NR31 = $ecrit remonte le minuteur à $reste crans', ({ ecrit, reste }) => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR31, ecrit);
        expect(chan3.lengthRemaining(0)).toBe(reste);
    });

    it('les 8 bits comptent : 0x3F ne vaut PAS la même chose que sur un canal pulse', () => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR31, 0x3F);
        expect(chan3.lengthRemaining(0), '256 - 63, et non 64 - 63').toBe(193);
    });

    it('un cran par coup de cloche, et la note s\'arrête à sec', () => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR30, DAC_ON);
        apu.write(NR31, 0xFC); // 4 crans
        apu.write(NR34, TRIGGER | LENGTH_ENABLE);

        expect(chan3.lengthRemaining(0)).toBe(4);
        expect(chan3.lengthRemaining(2 * CLOCHE)).toBe(2);
        expect(chan3.isEnabledAt(3 * CLOCHE), 'il reste un cran').toBe(true);
        expect(chan3.isEnabledAt(4 * CLOCHE), 'à sec').toBe(false);
    });

    it('four débranché, le minuteur ne tourne pas', () => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR30, DAC_ON);
        apu.write(NR31, 0xFC);
        apu.write(NR34, TRIGGER); // sans le bit 6

        expect(chan3.lengthRemaining(10 * CLOCHE)).toBe(4);
        expect(chan3.isEnabledAt(10 * CLOCHE)).toBe(true);
    });

    it('déclencher un minuteur à sec le remonte à 256, pas à 64', () => {
        const { machine, apu, chan3 } = buildHarness();
        apu.write(NR30, DAC_ON);
        apu.write(NR31, 0xFF); // un seul cran
        apu.write(NR34, TRIGGER | LENGTH_ENABLE);
        expect(chan3.lengthRemaining(CLOCHE), 'à sec').toBe(0);

        machine.totalCycles = CLOCHE;
        apu.write(NR34, TRIGGER | LENGTH_ENABLE);
        expect(chan3.lengthRemaining(CLOCHE), 'le maximum du canal 3').toBe(256);
    });

    it('débrancher la longueur ne ressuscite pas une note éteinte', () => {
        const { machine, apu, chan3 } = buildHarness();
        apu.write(NR30, DAC_ON);
        apu.write(NR31, 0xFC); // 4 crans
        apu.write(NR34, TRIGGER | LENGTH_ENABLE);
        expect(chan3.isEnabledAt(4 * CLOCHE), 'à sec').toBe(false);

        machine.totalCycles = 4 * CLOCHE;
        apu.write(NR34, 0x00);
        expect(chan3.isEnabledAt(4 * CLOCHE), 'toujours morte').toBe(false);
    });
});

describe('Canal 3 - NR52 le voit sur le bit 2', () => {

    it('le bit 2 se lève quand le canal 3 joue', () => {
        const { apu } = buildHarness();
        apu.write(NR30, DAC_ON);
        apu.write(NR34, TRIGGER);
        expect(apu.read(NR52)).toBe(0xF4);
    });

    it('les trois canaux ont chacun leur bit', () => {
        const { apu } = buildHarness();
        apu.write(NR12, 0xF0);
        apu.write(NR14, TRIGGER);
        apu.write(NR22, 0xF0);
        apu.write(NR24, TRIGGER);
        apu.write(NR30, DAC_ON);
        apu.write(NR34, TRIGGER);
        expect(apu.read(NR52), 'canaux 1, 2 et 3').toBe(0xF7);
    });

    it('éteindre l\'APU coupe le canal 3 aussi', () => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR30, DAC_ON);
        apu.write(NR34, TRIGGER);

        apu.write(NR52, 0x00);
        expect(chan3.isEnabled).toBe(false);
        expect(apu.read(NR52)).toBe(0x70);
    });
});

/**
 * La wave RAM, 0xFF30-0xFF3F : 16 octets, 32 échantillons de 4 bits lus en boucle par le
 * canal 3. Ce cran ne la fait pas encore sonner — il vérifie seulement qu'elle existe,
 * qu'elle se relit sans masque, et surtout qu'elle est le SEUL endroit de l'APU qui
 * survive à une extinction. Blargg le vérifie sous le nom « Powering APU shouldn't
 * affect wave ».
 */
describe('Canal 3 - la wave RAM', () => {

    const ADRESSES = Array.from({ length: 16 }, (_, i) => 0xFF30 + i);
    const nommees = ADRESSES.map((addr) => ({ addr, nom: '0x' + addr.toString(16).toUpperCase() }));

    it.each(nommees)('$nom se relit exactement comme on l\'écrit', ({ addr }) => {
        const { apu } = buildHarness();
        apu.write(addr, 0xA5);
        expect(apu.read(addr), 'aucun masque sur la wave RAM').toBe(0xA5);
        apu.write(addr, 0x00);
        expect(apu.read(addr)).toBe(0x00);
    });

    it('les seize octets sont distincts', () => {
        const { apu } = buildHarness();
        ADRESSES.forEach((addr, i) => apu.write(addr, i * 0x11));
        ADRESSES.forEach((addr, i) => {
            expect(apu.read(addr), `octet ${i}`).toBe(i * 0x11);
        });
    });

    it('elle survit à l\'extinction de l\'APU, contrairement à tout le reste', () => {
        const { apu } = buildHarness();
        ADRESSES.forEach((addr, i) => apu.write(addr, 0xF0 | i));
        apu.write(NR33, 0x34); // un registre ordinaire, pour comparaison

        apu.write(NR52, 0x00);

        expect(apu.read(NR33), 'NR33 est effacé').toBe(0xFF); // masque write-only
        ADRESSES.forEach((addr, i) => {
            expect(apu.read(addr), `octet ${i} intact`).toBe(0xF0 | i);
        });
    });

    it('elle reste écrivable pendant que l\'APU est éteint', () => {
        const { apu } = buildHarness();
        apu.write(NR52, 0x00);
        apu.write(0xFF30, 0x5A);
        expect(apu.read(0xFF30)).toBe(0x5A);
    });
});

describe('Canal 3 - il est indépendant des autres', () => {

    it('sa fréquence et son minuteur lui appartiennent', () => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR33, 0xFF);
        apu.write(NR34, 0x07);
        apu.write(NR31, 0xFC); // 256 - 252 = 4 crans
        apu.write(NR21, 0x3F); // canal 2 : 64 - 63 = 1 cran

        expect(chan3.frequency).toBe(0x7FF);
        expect(chan3.lengthRemaining(0), 'sur 8 bits').toBe(4);
        expect(apu.channel1.frequency, 'canal 1 intact').toBe(0);
        expect(apu.channel2.lengthRemaining(0), 'canal 2 sur 6 bits, et bien à lui').toBe(1);
    });

    it('déclencher le canal 3 n\'allume pas les autres', () => {
        const { apu } = buildHarness();
        apu.write(NR12, 0xF0);
        apu.write(NR22, 0xF0);
        apu.write(NR30, DAC_ON);
        apu.write(NR34, TRIGGER);

        expect(apu.channel3.isEnabled).toBe(true);
        expect(apu.channel1.isEnabled, 'canal 1 au repos').toBe(false);
        expect(apu.channel2.isEnabled, 'canal 2 au repos').toBe(false);
    });

    it('le canal 3 n\'a pas de sweep', () => {
        const { apu, chan3 } = buildHarness();
        apu.write(NR30, DAC_ON);
        apu.write(NR33, 0x00);
        apu.write(NR34, TRIGGER | 0x04);
        expect(chan3.frequencyAt(0)).toBe(1024);
        expect(chan3.frequencyAt(100 * CLOCHE), 'rien ne la balaie').toBe(1024);
    });
});
