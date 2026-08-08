import { describe, it, expect } from 'vitest';

import buildPPU, { Fetcher } from './index';

/**
 * AXE 1 — le PPU passe de « prédire » à « décompter ».
 *
 * Avant : un ordonnanceur à rattrapage (anchor / next / phase) qui PRÉVOIT
 * l'horodatage de la prochaine frontière et y saute. Ça n'a plus de sens depuis
 * que le PPU est consulté à chaque M-cycle.
 *
 * Après : une machine à états cadencée au dot. On tient `remain` = le nombre de
 * dots restants dans le mode courant ; on le décrémente ; la frontière ÉMERGE
 * quand il tombe à zéro. Plus d'anchor, plus de next : une frontière qui émerge
 * d'un décompte pourra, aux axes suivants, dépendre de ce qu'on rencontre en
 * chemin (SCX & 7, un sprite) — impossible avec une prédiction.
 *
 * L'unité est le DOT (1 M-cycle = 4 dots). Le pas reste le M-cycle : chaque
 * `check()` consomme donc 4 dots par cycle machine écoulé.
 *
 * Contrat figé avec le user :
 *   - this.line   : source de vérité verticale (0-153) ; LY la LIT.
 *   - this.mode   : 0/1/2/3, inchangé.
 *   - this.remain : le décompte, en dots.
 *   - duration(mode) : la longueur d'un mode, en dots (constante pour l'instant).
 *   - transition()   : avance d'UNE frontière (état + effets d'entrée), hors du temps.
 *   - check()        : consomme le temps écoulé et reporte le trop-plein.
 *
 * Ce fichier est la CIBLE : rouge tant que le décompte n'est pas implémenté,
 * vert une fois le refactor fait. Les 71 tests de ppu.test.js, eux, restent le
 * filet « comportement identique » et ne doivent jamais virer au rouge.
 */

const DOT = 4;                 // 1 M-cycle = 4 dots
const MODE2 = 80;              // OAM scan
const MODE3 = 172;             // dessin (minimum, avant pénalités)
const MODE0 = 204;             // HBlank
const LIGNE_DOTS = MODE2 + MODE3 + MODE0; // 456 dots = une ligne
const LIGNE = LIGNE_DOTS / DOT;           // 114 M-cycles
const TRAME = LIGNE * 154;                // 17 556 M-cycles
const VBLANK_AT = LIGNE * 144;            // 16 416 M-cycles : entrée en VBlank

const LY = 0xff44;

// Le même faux banc que ppu.test.js : totalCycles pilotable, un IF qui note ses
// coups, un bus muet (check() peint des lignes en passant, il lui faut une VRAM).
const makePPU = () => {
  const knocks = [];
  const machine = {
    totalCycles: 0,
    // Vitesse simple : les deux montres portent le même nombre (jalon KEY1, lot 0).
    get systemCycles() { return this.totalCycles; },
    _if: 0,
    get IF() { return this._if; },
    set IF(v) { knocks.push(v); this._if = v; },
    memory: { read: () => 0, write: () => {}, _read: () => 0, _write: () => {} },
  };
  const PPU = buildPPU(machine);
  return { machine, knocks, ppu: new PPU(Fetcher) };
};

describe('AXE 1 — la machine à décompte : prédire devient décompter', () => {

  describe('duration(mode) : la table des longueurs, en dots', () => {
    it.each([
      { mode: 2, dots: MODE2, nom: 'OAM scan' },
      { mode: 3, dots: MODE3, nom: 'dessin' },
      { mode: 0, dots: MODE0, nom: 'HBlank' },
      { mode: 1, dots: LIGNE_DOTS, nom: 'une ligne de VBlank' },
    ])('mode $mode ($nom) dure $dots dots', ({ mode, dots }) => {
      const { ppu } = makePPU();
      expect(ppu.duration(mode)).toBe(dots);
    });

    it('2 + 3 + 0 = une ligne visible entière (456 dots)', () => {
      const { ppu } = makePPU();
      expect(ppu.duration(2) + ppu.duration(3) + ppu.duration(0)).toBe(LIGNE_DOTS);
    });
  });

  describe('à la naissance : le décompte est déjà armé', () => {
    it('écran allumé (0x91) : mode 2, ligne 0, remain = duration(2)', () => {
      const { ppu } = makePPU();
      expect(ppu.mode, 'la trame commence par l\'OAM scan').toBe(2);
      expect(ppu.line, 'en haut de l\'écran').toBe(0);
      expect(ppu.remain, 'armé sur toute la durée du mode 2').toBe(MODE2);
    });
  });

  describe('check() : le décompte, en dots (1 M-cycle = 4 dots)', () => {
    it('un pas de 5 M-cycles retire 20 dots : remain passe de 80 à 60', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = 5;
      ppu.check();
      expect(ppu.remain).toBe(MODE2 - 5 * DOT);
      expect(ppu.mode, 'toujours dans l\'OAM scan').toBe(2);
      expect(ppu.line).toBe(0);
    });

    it('frontière 2->3 pile sur 80 dots (20 M-cycles) : mode 3, remain rechargé à 172', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = 20;
      ppu.check();
      expect(ppu.mode).toBe(3);
      expect(ppu.remain).toBe(MODE3);
      expect(ppu.line).toBe(0);
    });

    it('le TROP-PLEIN est reporté : 84 dots (21 M-cycles) = 4 dots au-delà, remain = 172 - 4', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = 21;
      ppu.check();
      expect(ppu.mode).toBe(3);
      expect(ppu.remain, 'les 4 dots en trop mordent sur le mode 3').toBe(MODE3 - 4);
    });

    it('frontière 3->0 à 63 M-cycles (252 dots) : mode 0, remain = 204', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = 63;
      ppu.check();
      expect(ppu.mode).toBe(0);
      expect(ppu.remain).toBe(MODE0);
    });

    it('fin de ligne à 114 M-cycles (456 dots) : ligne 1, retour au mode 2, remain = 80', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = LIGNE;
      ppu.check();
      expect(ppu.line).toBe(1);
      expect(ppu.mode).toBe(2);
      expect(ppu.remain).toBe(MODE2);
    });
  });

  describe('transition() : le graphe d\'états, hors du temps', () => {
    it('la ronde d\'une ligne visible : 2 -> 3 -> 0 -> (ligne+1) 2', () => {
      const { ppu } = makePPU(); // mode 2, ligne 0
      ppu.transition();
      expect(ppu.mode, 'OAM -> dessin').toBe(3);
      expect(ppu.line).toBe(0);
      ppu.transition();
      expect(ppu.mode, 'dessin -> HBlank').toBe(0);
      expect(ppu.line).toBe(0);
      ppu.transition();
      expect(ppu.mode, 'HBlank -> OAM de la ligne suivante').toBe(2);
      expect(ppu.line, 'on a changé de ligne').toBe(1);
    });

    it('entrée en VBlank : depuis la ligne 143 en HBlank, transition -> mode 1, ligne 144, ET IF bit 0', () => {
      const { ppu, knocks } = makePPU();
      ppu.line = 143;
      ppu.mode = 0;
      ppu.transition();
      expect(ppu.mode).toBe(1);
      expect(ppu.line).toBe(144);
      expect(knocks.length, 'l\'entrée en VBlank frappe une fois').toBe(1);
      expect(knocks.at(-1) & 0b00001, 'IF bit 0').toBe(0b00001);
    });

    it('à l\'intérieur du VBlank : la ligne avance, le mode reste 1, aucune frappe', () => {
      const { ppu, knocks } = makePPU();
      ppu.line = 144;
      ppu.mode = 1;
      ppu.transition();
      expect(ppu.mode).toBe(1);
      expect(ppu.line).toBe(145);
      expect(knocks.length, 'le VBlank ne re-sonne pas').toBe(0);
    });

    it('bouclage de trame : depuis la ligne 153, transition -> ligne 0, mode 2', () => {
      const { ppu } = makePPU();
      ppu.line = 153;
      ppu.mode = 1;
      ppu.transition();
      expect(ppu.line).toBe(0);
      expect(ppu.mode).toBe(2);
      expect(ppu.remain).toBe(MODE2);
    });
  });

  describe('LY : source de vérité — AXE 1 lisait this.line, Option A dérive de l\'horloge', () => {
    // AXE 1 avait posé « LY lit this.line ». Option A supersède ce contrat : LY
    // redevient une dérivée de l'horloge, mais en fonction PURE (via computeState,
    // échantillonnée au cycle de l'accès). this.line n'a plus d'emprise sur la lecture.
    it('LY dérive de l\'horloge : this.line muté n\'est plus lu', () => {
      const { machine, ppu } = makePPU();
      ppu.line = 42; // l'ancien état muté est ignoré par la lecture
      machine.totalCycles = LIGNE * 5; // le faisceau est à la ligne 5
      expect(ppu.read(LY), 'LY se calcule depuis totalCycles, pas depuis this.line').toBe(5);
    });

    it('après un balayage, read(LY) et line sont accordés', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = LIGNE * 5 + 30;
      ppu.check();
      expect(ppu.line).toBe(5);
      expect(ppu.read(LY)).toBe(ppu.line);
    });
  });

  describe('un gros delta : le rattrapage n\'est plus qu\'une consommation', () => {
    it('sauter à la trame suivante + 5 lignes + 30 M-cycles atterrit au bon dot', () => {
      const { machine, ppu } = makePPU();
      machine.totalCycles = TRAME + LIGNE * 5 + 30; // milieu du mode 3 de la ligne 5
      ppu.check();
      expect(ppu.line).toBe(5);
      expect(ppu.mode).toBe(3);
      // ligne 5 : mode 3 démarre au dot 80 ; on est à 30 M-cycles = 120 dots
      expect(ppu.remain).toBe(MODE3 - (30 * DOT - MODE2));
    });
  });
});
