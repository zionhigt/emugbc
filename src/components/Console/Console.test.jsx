import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import Console from './index';

// jsdom n'implémente pas PointerEvent avec coordonnées : fireEvent.pointerDown
// crée un événement sans clientX/clientY, le hit-test tombe sur NaN. On dispatche
// donc un MouseEvent (jsdom porte bien clientX/clientY) typé « pointerdown », avec
// pointerId greffé — c'est exactement ce que lisent les handlers natifs.
const fire = (el, type, { pointerId = 1, clientX = 0, clientY = 0 } = {}) => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(ev, 'pointerId', { value: pointerId });
  el.dispatchEvent(ev);
};

// jsdom ne calcule aucune géométrie : getBoundingClientRect y rend du vide.
// On le remplace par des zones FIXES et connues, pour piloter le hit-test comme
// on le ferait avec un vrai écran. La logique testée reste réelle (touchInput) —
// le mock ne fournit que les rectangles que le navigateur donnerait.
//
//   croix : boîte 120×120 en (0,0) → centre (60,60)
//   A : 40×40 en (300,0)      B : 40×40 en (250,0)
//   select : 30×30 en (100,200)   start : 30×30 en (150,200)
const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
});
const ZONES = {
  cross: rect(0, 0, 120, 120),
  a: rect(300, 0, 40, 40),
  b: rect(250, 0, 40, 40),
  select: rect(100, 200, 30, 30),
  start: rect(150, 200, 30, 30),
};

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList?.contains('gbc-console__buttons--cross')) return ZONES.cross;
    const key = this.dataset?.key;
    if (key && ZONES[key]) return ZONES[key];
    return rect(0, 0, 0, 0);
  });
  // offsetWidth/offsetHeight : la boîte de mise en page, jamais affectée par
  // transform (contrairement à getBoundingClientRect) — même taille que les
  // ZONES par défaut, quoi qu'un test fasse dire au rect par ailleurs (sert à
  // vérifier l'immunité à la rotation de la coque DMG, plus bas).
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
    const key = this.dataset?.key;
    return key && ZONES[key] ? ZONES[key].width : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
    const key = this.dataset?.key;
    return key && ZONES[key] ? ZONES[key].height : 0;
  });
});
afterEach(() => vi.restoreAllMocks());

// Un point DANS une zone d'action (son coin haut-gauche + 5px).
const dans = (z) => ({ clientX: z.left + 5, clientY: z.top + 5 });
// Un point sur la croix, à `dist` du centre dans la direction `deg` (0 = droite).
const surCroix = (deg, dist) => {
  const a = (deg * Math.PI) / 180;
  return { clientX: 60 + Math.cos(a) * dist, clientY: 60 + Math.sin(a) * dist };
};

const setup = () => {
  const presses = [];
  const releases = [];
  const { container } = render(
    <Console onPress={(k) => presses.push(k)} onRelease={(k) => releases.push(k)} />,
  );
  const pad = container.querySelector('.gbc-console__buttons');
  const el = (key) => container.querySelector(`[data-key="${key}"]`);
  return { presses, releases, pad, el };
};

describe('Console : le traqueur géométrique pilote la manette', () => {
  it('un appui sur A presse puis relâche « a »', () => {
    const { presses, releases, pad } = setup();
    fire(pad, 'pointerdown', { pointerId: 1, ...dans(ZONES.a) });
    expect(presses).toEqual(['a']);
    fire(pad, 'pointerup', { pointerId: 1, ...dans(ZONES.a) });
    expect(releases).toEqual(['a']);
  });

  it('la croix : un appui à droite du centre presse « right »', () => {
    const { presses, pad } = setup();
    fire(pad, 'pointerdown', { pointerId: 1, ...surCroix(0, 45) });
    expect(presses).toEqual(['right']);
  });

  it('ROULER droite → bas-droite : « down » entre, « right » reste, rien ne se répète', () => {
    const { presses, releases, pad } = setup();
    fire(pad, 'pointerdown', { pointerId: 1, ...surCroix(0, 45) });   // right
    fire(pad, 'pointermove', { pointerId: 1, ...surCroix(40, 45) });  // right + down
    expect(presses, 'right au poser, down au roulé — chacun une fois').toEqual(['right', 'down']);
    expect(releases, 'right ne se relâche pas en roulant').toEqual([]);
  });

  it('DEUX doigts : courir en sautant (croix-droite + A) sans interférence', () => {
    const { presses, pad } = setup();
    fire(pad, 'pointerdown', { pointerId: 1, ...surCroix(0, 45) }); // right
    fire(pad, 'pointerdown', { pointerId: 2, ...dans(ZONES.a) });   // a
    expect(presses).toEqual(['right', 'a']);
  });

  it('lever le doigt en pleine diagonale relâche les DEUX directions', () => {
    const { releases, pad } = setup();
    fire(pad, 'pointerdown', { pointerId: 1, ...surCroix(45, 45) }); // right + down
    fire(pad, 'pointerup', { pointerId: 1, ...surCroix(45, 45) });
    expect(releases.sort()).toEqual(['down', 'right']);
  });

  it('pointercancel (interruption système) relâche tout : pas de touche coincée', () => {
    const { releases, pad } = setup();
    fire(pad, 'pointerdown', { pointerId: 1, ...dans(ZONES.b) });
    fire(pad, 'pointercancel', { pointerId: 1, ...dans(ZONES.b) });
    expect(releases).toEqual(['b']);
  });

  it('le visuel suit : data-pressed apparaît à l\'appui, disparaît au relâche', () => {
    const { pad, el } = setup();
    fire(pad, 'pointerdown', { pointerId: 1, ...dans(ZONES.a) });
    expect(el('a').hasAttribute('data-pressed'), 'enfoncé').toBe(true);
    fire(pad, 'pointerup', { pointerId: 1, ...dans(ZONES.a) });
    expect(el('a').hasAttribute('data-pressed'), 'relâché').toBe(false);
  });

  it('sans onPress, la Console reste décorative — aucun plantage', () => {
    const { container } = render(<Console />);
    const pad = container.querySelector('.gbc-console__buttons');
    expect(() => fire(pad, 'pointerdown', { pointerId: 1, clientX: 320, clientY: 5 })).not.toThrow();
  });
});

describe('Console : A/B roulés — zone transparente au milieu', () => {
  // b : 250-290×0-40 élargi de 30% (12px) → 238-302 ; a : 300-340×0-40 élargi
  // pareil → 288-352. Recouvrement 288-302 : un point là-dedans presse les DEUX.
  it('rouler B → A traverse un point où LES DEUX sont pressés, sans relâche intermédiaire', () => {
    const { presses, releases, pad } = setup();
    fire(pad, 'pointerdown', { pointerId: 1, ...dans(ZONES.b) });
    expect(presses).toEqual(['b']);

    fire(pad, 'pointermove', { pointerId: 1, clientX: 295, clientY: 20 }); // zone de recouvrement
    expect(presses, 'a s\'ajoute, b ne se relâche pas au passage').toEqual(['b', 'a']);
    expect(releases, 'aucun relâché pendant le roulé').toEqual([]);

    fire(pad, 'pointermove', { pointerId: 1, ...dans(ZONES.a) }); // hors de la zone élargie de b
    expect(releases, 'b se relâche seulement en quittant sa propre zone élargie').toEqual(['b']);
  });
});

describe('Console : Select/Start — hit box plus haute, sans collision', () => {
  // select : 100-130×200-230 → hauteur ×3, centrée : 100-130×170-260.
  // start  : 150-180×200-230 → 150-180×170-260. Largeur inchangée : un
  // écart de 20px (130 à 150) reste entre les deux zones élargies.
  it('un appui au-dessus de la pastille visuelle presse quand même select', () => {
    const { presses, pad } = setup();
    fire(pad, 'pointerdown', { pointerId: 1, clientX: 115, clientY: 175 }); // hors 200-230, dans 170-260
    expect(presses).toEqual(['select']);
  });

  it('un appui entre les deux ne presse ni select ni start — pas de collision', () => {
    const { presses, pad } = setup();
    fire(pad, 'pointerdown', { pointerId: 1, clientX: 140, clientY: 215 }); // entre 130 et 150
    expect(presses).toEqual([]);
  });

  it('coque DMG (bouton pivoté -25°) : la taille vient d\'offsetHeight, pas de l\'AABB gonflée du rect', () => {
    const { presses, pad } = setup();
    // même centre (115,215) que ZONES.select, mais un rect deux fois plus
    // grand — ce que rendrait getBoundingClientRect d'un bouton pivoté.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.dataset?.key === 'select') return rect(85, 185, 60, 60);
      if (this.classList?.contains('gbc-console__buttons--cross')) return ZONES.cross;
      const key = this.dataset?.key;
      if (key && ZONES[key]) return ZONES[key];
      return rect(0, 0, 0, 0);
    });

    // dans l'AABB gonflée (85-145) mais hors de la vraie zone élargie (100-130)
    fire(pad, 'pointerdown', { pointerId: 1, clientX: 90, clientY: 215 });
    expect(presses, 'la marge doit venir d\'offsetWidth (30), pas de la largeur gonflée (60)').toEqual([]);
  });
});

describe('Console : overlay de debug — vert au press', () => {
  it('le rectangle de debug passe data-pressed en même temps que le bouton réel', () => {
    const { container } = render(<Console debug />);
    const pad = container.querySelector('.gbc-console__buttons');
    const dbg = () => container.querySelector('.gbc-console__debug-hitbox[data-key="a"]');

    expect(dbg().hasAttribute('data-pressed'), 'pas encore pressé').toBe(false);
    fire(pad, 'pointerdown', { pointerId: 1, ...dans(ZONES.a) });
    expect(dbg().hasAttribute('data-pressed'), 'vert au press').toBe(true);
    fire(pad, 'pointerup', { pointerId: 1, ...dans(ZONES.a) });
    expect(dbg().hasAttribute('data-pressed'), 'revient normal au relâche').toBe(false);
  });

  it('un resize en pleine pression repeint le debug sans perdre le vert', () => {
    const { container } = render(<Console debug />);
    const pad = container.querySelector('.gbc-console__buttons');

    fire(pad, 'pointerdown', { pointerId: 1, ...dans(ZONES.b) });
    window.dispatchEvent(new Event('resize')); // remesure -> repeint tous les rects

    const dbg = container.querySelector('.gbc-console__debug-hitbox[data-key="b"]');
    expect(dbg.hasAttribute('data-pressed'), 'l\'état pressé survit au repaint').toBe(true);
  });
});
