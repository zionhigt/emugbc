import { describe, it, expect } from 'vitest';

import buildTimer from './index';

const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

const DIV = 0xff04;
const TIMA = 0xff05;
const TMA = 0xff06;
const TAC = 0xff07;

// Modèle PULL : le timer ne reçoit pas les cycles, il LIT l'horloge totale
// de la machine et en DÉRIVE ses compteurs. Pour les tests, la machine est
// donc... un simple objet dont on tourne l'aiguille à la main.
const buildFakeMachine = () => ({ totalCycles: 0 });

const makeTimer = () => {
  const machine = buildFakeMachine();
  const Timer = buildTimer(machine);
  return { machine, timer: new Timer() };
};

describe('Timer : le contrôleur des 4 registres, dérivé de l\'horloge machine', () => {
  it('la factory (machine injectée) rend la classe : new Timer() expose read et write', () => {
    const { timer } = makeTimer();
    for (const m of ['read', 'write']) {
      expect(typeof timer[m], `${m} doit être appelable`).toBe('function');
    }
  });

  describe('les registres ordinaires : TIMA, TMA, TAC en aller-retour', () => {
    it.each([
      { addr: TIMA, nom: 'TIMA' },
      { addr: TMA, nom: 'TMA' },
      { addr: TAC, nom: 'TAC' },
    ])('$nom (écrit puis relu)', ({ addr }) => {
      const { timer } = makeTimer();
      timer.write(addr, 0x42);
      expect(hex(timer.read(addr), 2), 'la valeur doit survivre').toBe('0x42');
    });
  });

  describe('DIV : dérivé de totalCycles — un cran tous les 64 cycles machine', () => {
    it('lit 0 quand l\'horloge est à 0, puis suit l\'horloge', () => {
      const { machine, timer } = makeTimer();
      expect(timer.read(DIV), 'horloge à zéro').toBe(0);
      machine.totalCycles = 64;
      expect(timer.read(DIV), 'un cran pile').toBe(1);
      machine.totalCycles = 64 * 4;
      expect(timer.read(DIV), 'quatre crans').toBe(4);
    });

    it('le reliquat est gratuit dans le modèle pull : 63 cycles = 0, le 64e tombe', () => {
      const { machine, timer } = makeTimer();
      machine.totalCycles = 63;
      expect(timer.read(DIV), 'pas encore').toBe(0);
      machine.totalCycles = 64;
      expect(timer.read(DIV), 'aucun reliquat ne se perd — c\'est une division, pas un compteur').toBe(1);
    });

    it('écrire DIV le gifle à 0 (valeur écrite IGNORÉE), et il repart de là', () => {
      const { machine, timer } = makeTimer();
      machine.totalCycles = 64 * 5;
      expect(timer.read(DIV), 'il a compté').toBe(5);
      timer.write(DIV, 0xab); // la gifle
      expect(timer.read(DIV), 'giflé = zéro, pas 0xAB').toBe(0);
      machine.totalCycles += 64;
      expect(timer.read(DIV), 'et il repart du point de la gifle, pas de l\'horloge brute').toBe(1);
    });

    it('DIV tourne même quand TAC est éteint — il est indépendant', () => {
      const { machine, timer } = makeTimer();
      timer.write(TAC, 0b000);
      machine.totalCycles = 64;
      expect(timer.read(DIV), 'le compteur libre ignore TAC').toBe(1);
    });

    it('DIV est un octet : il wrappe à 256 crans', () => {
      const { machine, timer } = makeTimer();
      machine.totalCycles = 64 * 255;
      expect(timer.read(DIV)).toBe(255);
      machine.totalCycles += 64;
      expect(timer.read(DIV), '255 + 1 = 0, comme tout octet qui se respecte').toBe(0);
    });
  });

  describe('TIMA : le boss — dérivé comme DIV, armé par TAC, il frappe en débordant', () => {
    // La fausse machine s'enrichit : IF espionné (chaque frappe est comptée)
    // — le contrat de la frappe est machine.IF = machine.IF | 0b100.
    const makeArmed = () => {
      const knocks = [];
      const machine = {
        totalCycles: 0,
        _if: 0,
        get IF() { return this._if; },
        set IF(v) { knocks.push(v); this._if = v; },
      };
      const Timer = buildTimer(machine);
      return { machine, knocks, timer: new Timer() };
    };

    it('dérive au rythme de TAC : période 4, 12 cycles = 3 crans', () => {
      const { machine, timer } = makeArmed();
      timer.write(TAC, 0b101); // armé, période 4
      machine.totalCycles += 12;
      expect(timer.read(TIMA), '12 ÷ 4 : la valeur est un calcul, pas un compteur').toBe(3);
    });

    it('TAC éteint : TIMA gèle, le temps passe sans lui', () => {
      const { machine, timer } = makeArmed();
      timer.write(TIMA, 0x10);
      machine.totalCycles += 10000;
      expect(timer.read(TIMA), 'désarmé = figé sur sa base').toBe(0x10);
    });

    it.each([
      { tac: 0b100, periode: 256 },
      { tac: 0b101, periode: 4 },
      { tac: 0b110, periode: 16 },
      { tac: 0b111, periode: 64 },
    ])('les 4 vitesses : TAC=$tac, 5 périodes = 5 crans', ({ tac, periode }) => {
      const { machine, timer } = makeArmed();
      timer.write(TAC, tac);
      machine.totalCycles += periode * 5;
      expect(timer.read(TIMA)).toBe(5);
    });

    it('écrire TIMA ré-ancre : la nouvelle base compte depuis MAINTENANT', () => {
      const { machine, timer } = makeArmed();
      timer.write(TAC, 0b101);
      machine.totalCycles += 100; // 25 crans d'écoulés...
      timer.write(TIMA, 0x10); // ...balayés par l'écriture
      machine.totalCycles += 4;
      expect(timer.read(TIMA), '0x10 + 1 cran depuis l\'écriture, pas depuis l\'armement').toBe(0x11);
    });

    it('écrire TMA ne dérange RIEN : ni la valeur courante, ni le rendez-vous', () => {
      const { machine, timer } = makeArmed();
      timer.write(TAC, 0b101);
      machine.totalCycles += 8; // 2 crans
      timer.write(TMA, 0x99); // ne servira qu\'à la prochaine recharge
      expect(timer.read(TIMA), 'la course en cours continue, imperturbable').toBe(2);
    });

    it('check() sans débordement : aucune frappe, rien ne bouge', () => {
      const { machine, knocks, timer } = makeArmed();
      timer.write(TAC, 0b101);
      machine.totalCycles += 40;
      timer.check();
      expect(knocks, 'pas de rendez-vous dépassé, pas de frappe').toEqual([]);
    });

    it('check() au débordement : frappe IF bit 2 et recharge TIMA avec TMA (pas 0 !)', () => {
      const { machine, knocks, timer } = makeArmed();
      timer.write(TMA, 0xf0);
      timer.write(TIMA, 0xff); // au bord du gouffre
      timer.write(TAC, 0b101);
      machine.totalCycles += 4; // le cran fatal
      timer.check();
      expect(knocks.length, 'UNE frappe').toBe(1);
      expect(machine.IF & 0b100, 'le bit 2 levé').toBe(0b100);
      expect(hex(timer.read(TIMA), 2), 'rechargé avec TMA').toBe('0xF0');
    });

    it('anti-dérive : constaté en retard, le cran suivant part du rendez-vous, pas du constat', () => {
      const { machine, timer } = makeArmed();
      timer.write(TMA, 0xf0);
      timer.write(TIMA, 0xff);
      timer.write(TAC, 0b101); // rendez-vous à +4
      machine.totalCycles += 6; // constaté avec 2 cycles de retard
      timer.check();
      machine.totalCycles += 2; // total : 8 depuis l\'armement = 4 depuis le rendez-vous
      expect(
        timer.read(TIMA),
        '0xF0 + 1 : les 2 cycles de retard appartenaient déjà au cran suivant',
      ).toBe(0xf1);
    });

    it('rattrapage : trois rendez-vous enjambés = trois frappes, une par alarme manquée', () => {
      const { machine, knocks, timer } = makeArmed();
      timer.write(TMA, 0xfe); // recharge à 2 crans du gouffre = alarme tous les 8 cycles
      timer.write(TIMA, 0xff); // la première à +4
      timer.write(TAC, 0b101);
      machine.totalCycles += 20; // rendez-vous à 4, 12 et 20 : tous dépassés
      timer.check();
      expect(knocks.length, 'chaque alarme manquée doit sa frappe — un while, pas un if').toBe(3);
    });

    it('désarmé, check() est inoffensif même après une éternité (la sentinelle ∞)', () => {
      const { machine, knocks, timer } = makeArmed();
      timer.write(TIMA, 0xff);
      machine.totalCycles += 10_000_000;
      timer.check();
      expect(knocks, 'aucun rendez-vous n\'existe sans TAC').toEqual([]);
    });
  });
});
