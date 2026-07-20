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
