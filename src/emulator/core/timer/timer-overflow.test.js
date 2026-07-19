import { describe, it, expect } from 'vitest';

import buildTimer from './index';

const hex = (n, width = 4) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');

const TIMA = 0xff05;
const TMA = 0xff06;
const TAC = 0xff07;

/**
 * §TIMA OVERFLOW BEHAVIOR.
 *
 * « These actions don't occur instantaneously » : entre le débordement de TIMA et ses
 * effets, le matériel laisse passer 4 T-cycles. Pendant cette fenêtre TIMA lit 0x00,
 * IF n'est pas levé, et TMA n'a pas encore été lu.
 *
 * UNITÉS : `machine.totalCycles` est en cycles MACHINE, le timer multiplie par 4 en
 * interne. La fenêtre de 4 T-cycles vaut donc exactement 1 cycle machine ici.
 *
 * Le décor est toujours le même : TAC 0b101 (armé, période 16 T-cycles = 4 cycles
 * machine) et TIMA à 0xFF, donc un seul cran avant le gouffre. Le débordement tombe
 * à totalCycles = 4, la recharge à 5.
 */

const DEBORDEMENT = 4; // cycles machine : le cran fatal
const RECHARGE = 5; // cycles machine : fin de la fenêtre

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

/** TMA chargé, TIMA au bord, timer armé. */
const auBordDuGouffre = (tma = 0xf0) => {
  const ctx = makeArmed();
  ctx.timer.write(TMA, tma);
  ctx.timer.write(TIMA, 0xff);
  ctx.timer.write(TAC, 0b101);
  return ctx;
};

describe('§TIMA Overflow : la fenêtre de 4 T-cycles entre le débordement et ses effets', () => {
  describe('pendant la fenêtre : TIMA est à zéro et rien d\'autre n\'a eu lieu', () => {
    it('TIMA lit 0x00 — pas encore TMA', () => {
      const { machine, timer } = auBordDuGouffre();
      machine.totalCycles += DEBORDEMENT;
      timer.check();
      expect(
        hex(timer.read(TIMA), 2),
        'si tu lis 0xF0, la recharge a eu lieu instantanément et la fenêtre n\'existe pas'
      ).toBe('0x00');
    });

    it('IF n\'est PAS levé : l\'interruption attend la fin de la fenêtre', () => {
      const { machine, knocks, timer } = auBordDuGouffre();
      machine.totalCycles += DEBORDEMENT;
      timer.check();
      expect(knocks, 'aucune frappe tant que la fenêtre court').toEqual([]);
    });
  });

  describe('à la fin de la fenêtre : tout se produit d\'un coup', () => {
    it('TIMA est rechargé avec TMA et IF est frappé', () => {
      const { machine, knocks, timer } = auBordDuGouffre();
      machine.totalCycles += RECHARGE;
      timer.check();
      expect(hex(timer.read(TIMA), 2), 'rechargé avec TMA').toBe('0xF0');
      expect(machine.IF & 0b100, 'le bit 2 levé').toBe(0b100);
      expect(knocks.length, 'une seule frappe').toBe(1);
    });
  });

  describe('les deux écritures que la fenêtre rend observables', () => {
    it('écrire TMA pendant la fenêtre : c\'est la NOUVELLE valeur qui est rechargée', () => {
      // TMA n'étant lu qu'à la recharge, l'écrire pendant la fenêtre change ce qui arrive.
      const { machine, timer } = auBordDuGouffre(0xf0);
      machine.totalCycles += DEBORDEMENT;
      timer.check();

      timer.write(TMA, 0x42); // en pleine fenêtre

      machine.totalCycles += RECHARGE - DEBORDEMENT;
      timer.check();
      expect(
        hex(timer.read(TIMA), 2),
        'si tu lis 0xF0, TMA avait déjà été lu avant l\'écriture'
      ).toBe('0x42');
    });

    it('écrire TIMA pendant la fenêtre : la recharge ET l\'interruption sont annulées', () => {
      const { machine, knocks, timer } = auBordDuGouffre();
      machine.totalCycles += DEBORDEMENT;
      timer.check();

      timer.write(TIMA, 0x23); // en pleine fenêtre : le joueur reprend la main

      machine.totalCycles += RECHARGE - DEBORDEMENT;
      timer.check();
      expect(
        hex(timer.read(TIMA), 2),
        'la valeur écrite survit : TMA ne doit PAS l\'écraser'
      ).toBe('0x23');
      expect(knocks, 'et l\'interruption n\'a jamais lieu').toEqual([]);
    });
  });

  describe('la fenêtre ne perturbe pas le régime permanent', () => {
    it('après recharge, le cran suivant tombe une période plus loin', () => {
      // TMA = 0xFF : un seul cran après la recharge, donc un second débordement proche.
      const { machine, knocks, timer } = auBordDuGouffre(0xff);
      machine.totalCycles += RECHARGE;
      timer.check();
      expect(knocks.length, 'première frappe').toBe(1);

      machine.totalCycles += 4; // une période de plus
      timer.check();
      expect(knocks.length, 'la grille des crans continue normalement').toBe(2);
    });
  });
});
