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

    // UPDATE — le gel d'un timer QUI TOURNE. Le test ci-dessus n'allume jamais
    // TAC : TIMA n'a jamais compté, sa base est déjà la bonne valeur. Ici les
    // crans écoulés doivent être soldés dans la base AVANT que TAC ne s'éteigne.
    it('TAC éteint en marche : TIMA se fige sur sa valeur courante, pas sur son ancienne base', () => {
      const { machine, timer } = makeArmed();
      timer.write(TAC, 0b101); // armé, période 4
      timer.write(TIMA, 0x10); // base = 0x10, ancre = maintenant
      machine.totalCycles += 12; // 3 crans
      expect(timer.read(TIMA), 'avant extinction').toBe(0x13);

      timer.write(TAC, 0b001); // bit 2 tombe
      expect(timer.read(TIMA), 'le gel solde les crans écoulés').toBe(0x13);
      machine.totalCycles += 10000;
      expect(timer.read(TIMA), 'et plus rien ne bouge ensuite').toBe(0x13);
    });

    // UPDATE — même exigence, cas plus discret : le timer reste allumé, seule la
    // cadence change. Les crans déjà acquis à l'ancienne période doivent survivre
    // au rebranchement, sinon TIMA RECULE.
    it('changer de fréquence solde les crans à l\'ancienne cadence avant de rebrancher', () => {
      const { machine, timer } = makeArmed();
      timer.write(TAC, 0b101); // armé, période 4
      timer.write(TIMA, 0x10);
      machine.totalCycles += 12; // 3 crans à période 4
      expect(timer.read(TIMA), 'avant le changement').toBe(0x13);

      timer.write(TAC, 0b111); // toujours armé, période 64
      expect(timer.read(TIMA), 'les 3 crans sont acquis : TIMA ne recule pas').toBe(0x13);
      machine.totalCycles += 64;
      expect(timer.read(TIMA), 'et il repart à la nouvelle cadence').toBe(0x14);
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

  // Le détecteur de front. Le timer ne surveille pas le temps mais UN SIGNAL :
  // le bit du compteur sélectionné par TAC, ET le bit 2 de TAC. TIMA s'incrémente
  // à chaque fois que ce signal tombe de 1 à 0 — y compris quand c'est une ÉCRITURE
  // qui le fait tomber, sans que le compteur ait avancé d'un seul cycle.
  //
  // Repère d'unités : les tests poussent des cycles machine, le timer compte en
  // T-cycles (×4). Avec TAC=0b101 la prise est le bit 3, donc à 2 cycles machine
  // le compteur vaut 8 (0b1000) et le bit surveillé vaut 1.
  describe('détecteur de front : une écriture peut incrémenter TIMA', () => {
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

    // Poste le timer là où le bit 3 vaut 1, TIMA à 0x10.
    const surUnBitHaut = () => {
      const ctx = makeArmed();
      ctx.timer.write(TAC, 0b101);
      ctx.timer.write(TIMA, 0x10);
      ctx.machine.totalCycles += 2; // compteur = 8 T = 0b1000, bit 3 levé
      expect(ctx.timer.read(TIMA), 'aucun cran écoulé avant le front').toBe(0x10);
      return ctx;
    };

    it('éteindre le timer fait tomber le ET : TIMA gagne son dernier cran', () => {
      const { timer } = surUnBitHaut();
      timer.write(TAC, 0b001); // bit 2 tombe, le bit du compteur n'a pas bougé
      expect(timer.read(TIMA), 'le ET est passé de 1 à 0 : +1').toBe(0x11);
    });

    it('éteindre le timer sur un bit BAS ne produit aucun front', () => {
      const { timer } = makeArmed();
      timer.write(TAC, 0b101);
      timer.write(TIMA, 0x10); // compteur = 0, bit 3 à 0 : le ET vaut déjà 0
      timer.write(TAC, 0b001);
      expect(timer.read(TIMA), '0 vers 0 n\'est pas une chute').toBe(0x10);
    });

    it('changer de fréquence déplace la prise : ancien bit à 1, nouveau à 0 = +1', () => {
      const { timer } = surUnBitHaut();
      timer.write(TAC, 0b111); // bit 3 (levé) vers bit 7 (baissé), timer TOUJOURS allumé
      expect(timer.read(TIMA), 'la prise a bougé sous le signal : +1').toBe(0x11);
    });

    it('remettre DIV à zéro écrase le bit surveillé : +1', () => {
      const { timer } = surUnBitHaut();
      timer.write(DIV, 0x42); // valeur ignorée, le compteur repart de 0
      expect(timer.read(TIMA), 'le bit 3 est passé de 1 à 0 : +1').toBe(0x11);
    });

    // Remettre DIV à zéro déplace la grille, donc le rendez-vous — qu'il y ait eu un
    // front ou non. Ici le bit surveillé vaut déjà 0 : aucun front, mais l'alarme doit
    // quand même repartir du compteur remis à zéro.
    it('remettre DIV à zéro sans front recale quand même le rendez-vous', () => {
      const { machine, knocks, timer } = makeArmed();
      timer.write(TMA, 0x00);
      timer.write(TAC, 0b101); // période 4 cycles machine
      timer.write(TIMA, 0xfd); // 3 crans avant le gouffre
      machine.totalCycles += 5; // compteur = 20 T = 0b10100 : bit 3 BAS, 1 cran écoulé
      expect(timer.read(TIMA), 'un cran passé, pas de front en vue').toBe(0xfe);

      timer.write(DIV, 0x00); // le compteur repart de 0, il reste 2 crans
      machine.totalCycles += 8; // exactement 2 crans depuis le reset
      timer.check();
      expect(knocks.length, 'le rendez-vous doit suivre le compteur, pas rester derrière').toBe(1);
    });

    // Le cran gagné par une écriture rapproche le débordement d'une période. Si l'alarme
    // a été posée AVANT l'incrément, elle vise encore l'ancien rendez-vous.
    it('le cran gagné par une écriture avance le rendez-vous d\'autant', () => {
      const { machine, knocks, timer } = makeArmed();
      timer.write(TMA, 0x00);
      timer.write(TAC, 0b101);
      timer.write(TIMA, 0xfe); // 2 crans avant le gouffre
      machine.totalCycles += 2; // bit 3 levé

      timer.write(DIV, 0x00); // front : TIMA passe à 0xFF, donc 1 SEUL cran restant
      expect(timer.read(TIMA), 'le front a bien poussé TIMA').toBe(0xff);

      machine.totalCycles += 4; // un cran plein après le reset du compteur
      timer.check();
      expect(knocks.length, 'il ne restait qu\'un cran, le rendez-vous doit tomber ici').toBe(1);
    });

    it('le front provoqué par une écriture peut déborder : frappe et recharge TMA', () => {
      const { machine, knocks, timer } = makeArmed();
      timer.write(TMA, 0xf0);
      timer.write(TAC, 0b101);
      timer.write(TIMA, 0xff); // au bord du gouffre
      machine.totalCycles += 2; // bit 3 levé, aucun cran écoulé
      expect(timer.read(TIMA), 'toujours au bord').toBe(0xff);

      timer.write(TAC, 0b001); // le front de l'extinction pousse TIMA par-dessus
      expect(knocks.length, 'le débordement frappe, même sans temps écoulé').toBe(1);
      expect(machine.IF & 0b100, 'bit 2 de IF').toBe(0b100);
      expect(timer.read(TIMA), 'rechargé avec TMA, pas laissé à 0x100').toBe(0xf0);
    });
  });
});
