import { describe, it, expect } from 'vitest';

import buildAPU from './index';
import buildTimer from '../timer/index';

/**
 * CRAN 8 : LES MASQUES DE LECTURE.
 *
 * Relire un registre de l'APU ne rend pas ce qu'on y a écrit : les bits non lisibles
 * reviennent à 1.
 *
 *   NR21 (0xFF16)  valeur | 0x3F   seul le duty ressort
 *   NR22 (0xFF17)  valeur          tout est lisible
 *   NR23 (0xFF18)  0xFF            write-only
 *   NR24 (0xFF19)  valeur | 0xBF   seul le length enable ressort
 *   0xFF15         0xFF            adresse non câblée
 *
 * Le masque appartient au CHEMIN DU BUS. Les lectures internes du canal (frequency, duty,
 * initialVolume...) doivent continuer de voir la valeur brute — sinon NR23 rendrait 0xFF
 * et la fréquence du canal serait fausse. C'est ce que vérifie le dernier bloc.
 *
 * Les masques des canaux 1, 3 et 4 viendront avec leurs canaux.
 */

const NR21 = 0xFF16;
const NR22 = 0xFF17;
const NR23 = 0xFF18;
const NR24 = 0xFF19;
const TROU = 0xFF15; // entre NR14 et NR21, non câblé

const buildHarness = () => {
    const machine = {
        totalCycles: 0,
        // Vitesse simple : les deux montres portent le même nombre (jalon KEY1, lot 0).
        get systemCycles() { return this.totalCycles; },
        timer: null,
        // Une valeur reconnaissable : si elle ressort d'une lecture, c'est que l'APU a
        // laissé passer l'adresse au bus nu au lieu de répondre lui-même.
        memory: { _read: () => 0x42, _write: () => {} },
    };
    const Timer = buildTimer(machine);
    machine.timer = new Timer();

    const APU = buildAPU(machine);
    const apu = new APU();
    return { machine, apu, chan: apu.channel2 };
};

describe('Masques - NR21 : seul le duty ressort', () => {

    it.each([
        { ecrit: 0x00, relu: 0x3F },
        { ecrit: 0xC0, relu: 0xFF },
        { ecrit: 0x80, relu: 0xBF },
        { ecrit: 0x40, relu: 0x7F },
        { ecrit: 0x3F, relu: 0x3F },
        { ecrit: 0xC5, relu: 0xFF },
    ])('écrit $ecrit, relu $relu', ({ ecrit, relu }) => {
        const { apu } = buildHarness();
        apu.write(NR21, ecrit);
        expect(apu.read(NR21)).toBe(relu);
    });

    it('la longueur écrite est invisible en lecture', () => {
        const { apu } = buildHarness();
        apu.write(NR21, 0x0A);
        expect(apu.read(NR21), 'les 6 bits de queue reviennent tous à 1').toBe(0x3F);
    });
});

describe('Masques - NR22 : rien n\'est masqué', () => {

    it.each([0x00, 0x08, 0xA5, 0xF0, 0xFF])('écrit %i, relu à l\'identique', (valeur) => {
        const { apu } = buildHarness();
        apu.write(NR22, valeur);
        expect(apu.read(NR22)).toBe(valeur);
    });
});

describe('Masques - NR23 : write-only', () => {

    it.each([0x00, 0x34, 0xFF])('écrit %i, relu 0xFF', (valeur) => {
        const { apu } = buildHarness();
        apu.write(NR23, valeur);
        expect(apu.read(NR23)).toBe(0xFF);
    });
});

describe('Masques - NR24 : seul le length enable ressort', () => {

    it.each([
        { ecrit: 0x00, relu: 0xBF },
        { ecrit: 0x40, relu: 0xFF },
        { ecrit: 0x80, relu: 0xBF },
        { ecrit: 0xC0, relu: 0xFF },
        { ecrit: 0x07, relu: 0xBF },
        { ecrit: 0x47, relu: 0xFF },
    ])('écrit $ecrit, relu $relu', ({ ecrit, relu }) => {
        const { apu } = buildHarness();
        apu.write(NR24, ecrit);
        expect(apu.read(NR24)).toBe(relu);
    });

    it('ni le trigger ni la fréquence haute ne ressortent', () => {
        const { apu } = buildHarness();
        apu.write(NR24, 0x85); // trigger + 3 bits hauts, pas de length enable
        expect(apu.read(NR24)).toBe(0xBF);
    });
});

/**
 * LA TABLE DES MASQUES, limitée à ce qui existe.
 *
 * La table complète que blargg `01-registers` exige couvre 0xFF10 à 0xFF26. Les lignes
 * des canaux 1, 3 et 4 sont commentées ci-dessous : on les décommente quand le canal
 * arrive, pas avant — un registre qui n'appartient à personne n'a rien à faire ici.
 *
 * À savoir : `01-registers` abandonne à la PREMIÈRE adresse qui ne correspond pas, en
 * commençant par NR10. Elle restera donc rouge jusqu'au dernier registre écrit, et ne
 * donnera aucun signal intermédiaire.
 *
 * NR52 est absent du tableau : son écriture ne retient que le bit 7, il a ses propres
 * tests dans nr52.test.js.
 */
describe('Masques - la table, pour les registres qui existent', () => {

    const TABLE = [
        { addr: 0xFF10, nom: 'NR10', masque: 0x80 },
        { addr: 0xFF11, nom: 'NR11', masque: 0x3F },
        { addr: 0xFF12, nom: 'NR12', masque: 0x00 },
        { addr: 0xFF13, nom: 'NR13', masque: 0xFF },
        { addr: 0xFF14, nom: 'NR14', masque: 0xBF },
        { addr: 0xFF15, nom: 'non câblé', masque: 0xFF },
        { addr: 0xFF16, nom: 'NR21', masque: 0x3F },
        { addr: 0xFF17, nom: 'NR22', masque: 0x00 },
        { addr: 0xFF18, nom: 'NR23', masque: 0xFF },
        { addr: 0xFF19, nom: 'NR24', masque: 0xBF },
        { addr: 0xFF1A, nom: 'NR30', masque: 0x7F },
        { addr: 0xFF1B, nom: 'NR31', masque: 0xFF },
        { addr: 0xFF1C, nom: 'NR32', masque: 0x9F },
        { addr: 0xFF1D, nom: 'NR33', masque: 0xFF },
        { addr: 0xFF1E, nom: 'NR34', masque: 0xBF },
        { addr: 0xFF1F, nom: 'non câblé', masque: 0xFF },
        { addr: 0xFF20, nom: 'NR41', masque: 0xFF },
        { addr: 0xFF21, nom: 'NR42', masque: 0x00 },
        { addr: 0xFF22, nom: 'NR43', masque: 0x00 },
        { addr: 0xFF23, nom: 'NR44', masque: 0xBF },
        { addr: 0xFF24, nom: 'NR50', masque: 0x00 },
        { addr: 0xFF25, nom: 'NR51', masque: 0x00 },
    ];

    it.each(TABLE)('$nom : écrit 0x00, relu son masque', ({ addr, masque }) => {
        const { apu } = buildHarness();
        apu.write(addr, 0x00);
        expect(apu.read(addr)).toBe(masque);
    });

    it.each(TABLE)('$nom : écrit 0xFF, relu 0xFF', ({ addr }) => {
        const { apu } = buildHarness();
        apu.write(addr, 0xFF);
        expect(apu.read(addr), 'tout est levé, masque ou pas').toBe(0xFF);
    });

    it.each(TABLE.filter((r) => r.masque !== 0xFF))(
        '$nom : les bits hors masque ressortent tels quels',
        ({ addr, masque }) => {
            const { apu } = buildHarness();
            const valeur = 0xA5 & ~masque & 0xFF; // que des bits lisibles
            apu.write(addr, valeur);
            expect(apu.read(addr)).toBe(valeur | masque);
        },
    );

    it.each(
        [0xFF27, 0xFF28, 0xFF29, 0xFF2A, 0xFF2B, 0xFF2C, 0xFF2D, 0xFF2E, 0xFF2F]
            .map((addr) => ({ addr, nom: '0x' + addr.toString(16).toUpperCase() })),
    )(
        '$nom n\'est pas câblée : elle rend 0xFF et ne retient rien',
        ({ addr }) => {
            const { apu } = buildHarness();
            expect(apu.read(addr), 'avant toute écriture').toBe(0xFF);
            apu.write(addr, 0x00);
            expect(apu.read(addr), 'écrire n\'y change rien').toBe(0xFF);
            apu.write(addr, 0xA5);
            expect(apu.read(addr)).toBe(0xFF);
        },
    );

    it('aucune adresse détenue ne descend jusqu\'au bus nu', () => {
        const { apu } = buildHarness();
        for (const { addr } of [...TABLE, { addr: 0xFF26 }]) {
            expect(apu.read(addr), `0x${addr.toString(16)} répond 0x42, le bus a parlé`).not.toBe(0x42);
        }
    });
});

describe('Masques - l\'adresse non câblée', () => {

    it('0xFF15 rend 0xFF, et ne descend pas jusqu\'au bus nu', () => {
        const { apu } = buildHarness();
        expect(apu.read(TROU)).toBe(0xFF);
    });

    it('y écrire ne casse rien', () => {
        const { apu, chan } = buildHarness();
        expect(() => apu.write(TROU, 0xC0)).not.toThrow();
        expect(chan.duty, 'et n\'atteint aucun registre du canal').toBe(0);
    });
});

describe('Masques - l\'APU éteint masque aussi', () => {

    it('les registres remis à zéro se relisent à travers leur masque', () => {
        const { apu } = buildHarness();
        apu.write(NR21, 0xC0);
        apu.write(NR24, 0x40);

        apu.write(0xFF26, 0x00); // extinction

        expect(apu.read(NR21), 'valeur nulle, masque appliqué').toBe(0x3F);
        expect(apu.read(NR24)).toBe(0xBF);
        expect(apu.read(NR23)).toBe(0xFF);
    });
});

describe('Masques - le canal continue de voir la valeur brute', () => {

    it('la fréquence reste juste alors que NR23 se relit 0xFF', () => {
        const { apu, chan } = buildHarness();
        apu.write(NR23, 0x34);
        apu.write(NR24, 0x05);

        expect(apu.read(NR23), 'le bus ne voit rien').toBe(0xFF);
        expect(chan.frequency, 'le canal, lui, voit tout').toBe(0x534);
        expect(chan.period).toBe(2048 - 0x534);
    });

    it('le duty et la longueur restent justes alors que NR21 se relit masqué', () => {
        const { apu, chan } = buildHarness();
        apu.write(NR21, 0xC0 | 0x3C); // pochoir 3, retrait 60

        expect(apu.read(NR21), 'la queue est masquée').toBe(0xFF);
        expect(chan.duty, 'le pochoir est intact').toBe(3);
        expect(chan.lengthRemaining(0), 'le minuteur aussi').toBe(4);
    });

    it('le length enable reste juste alors que NR24 se relit masqué', () => {
        const { apu, chan } = buildHarness();
        apu.write(NR22, 0xF0);
        apu.write(NR24, 0x80 | 0x40); // trigger + length enable

        expect(apu.read(NR24)).toBe(0xFF);
        expect(chan.isLengthEnabled, 'le canal voit le bit 6').toBe(true);
        expect(chan.isEnabled, 'et le trigger a bien eu lieu').toBe(true);
    });
});
