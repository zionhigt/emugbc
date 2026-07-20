import { describe, it, expect } from 'vitest';

import { crossKeys, buttonKey, pressedKeys, diffKeys } from './touchInput';

// Une croix centrée en (100, 100), rayon 60, zone morte 12.
const CROSS = { cx: 100, cy: 100, radius: 60, deadzone: 12 };

// Deux boutons d'action, rectangles simples, loin de la croix.
const A = { key: 'a', x: 300, y: 80, w: 40, h: 40 };
const B = { key: 'b', x: 250, y: 100, w: 40, h: 40 };
const LAYOUT = { cross: CROSS, buttons: [A, B] };

// Un point à `dist` du centre de la croix, dans la direction `deg`
// (0 = droite, sens horaire car y descend).
const surCroix = (deg, dist) => {
  const a = (deg * Math.PI) / 180;
  return { x: CROSS.cx + Math.cos(a) * dist, y: CROSS.cy + Math.sin(a) * dist };
};

const set = (...ks) => new Set(ks);

describe('crossKeys : la direction déduite de l\'angle', () => {
  it.each([
    { deg: 0, attendu: ['right'], nom: 'droite' },
    { deg: 90, attendu: ['down'], nom: 'bas (y vers le bas)' },
    { deg: 180, attendu: ['left'], nom: 'gauche' },
    { deg: 270, attendu: ['up'], nom: 'haut' },
  ])('$nom : un seul axe', ({ deg, attendu }) => {
    expect(crossKeys(surCroix(deg, 40), CROSS).sort()).toEqual(attendu.sort());
  });

  it.each([
    { deg: 45, attendu: ['right', 'down'], nom: 'bas-droite' },
    { deg: 135, attendu: ['down', 'left'], nom: 'bas-gauche' },
    { deg: 225, attendu: ['left', 'up'], nom: 'haut-gauche' },
    { deg: 315, attendu: ['up', 'right'], nom: 'haut-droite' },
  ])('$nom : DEUX directions au coin, comme le vrai matériel', ({ deg, attendu }) => {
    expect(crossKeys(surCroix(deg, 40), CROSS).sort()).toEqual(attendu.sort());
  });

  it('la zone morte centrale ne presse rien : pas de direction franche au repos', () => {
    expect(crossKeys(surCroix(45, 5), CROSS)).toEqual([]);
  });

  it('au-delà du rayon, la croix ne répond pas', () => {
    expect(crossKeys(surCroix(0, 200), CROSS)).toEqual([]);
  });

  it('les diagonales sont larges : 30° depuis un axe tombe encore en diagonale', () => {
    // 30° est à mi-chemin entre « droite » (0°) et « bas-droite » (45°) ; comme
    // les secteurs sont centrés, la frontière est à 22,5°, donc 30° = diagonale.
    expect(crossKeys(surCroix(30, 40), CROSS).sort()).toEqual(['down', 'right']);
  });
});

describe('buttonKey : le rectangle', () => {
  it('un point dedans rend la touche', () => {
    expect(buttonKey({ x: 320, y: 100 }, A)).toBe('a');
  });

  it('un point dehors rend null', () => {
    expect(buttonKey({ x: 320, y: 200 }, A)).toBe(null);
  });

  it('les bords sont inclus', () => {
    expect(buttonKey({ x: A.x, y: A.y }, A)).toBe('a');
    expect(buttonKey({ x: A.x + A.w, y: A.y + A.h }, A)).toBe('a');
  });
});

describe('pressedKeys : tous les points de contact réunis', () => {
  it('un tap simple sur A', () => {
    expect(pressedKeys([{ x: 320, y: 100 }], LAYOUT)).toEqual(set('a'));
  });

  it('rien sous le doigt : ensemble vide (le doigt est dans le vide)', () => {
    expect(pressedKeys([{ x: 500, y: 500 }], LAYOUT)).toEqual(set());
  });

  it('DEUX doigts : A et B pressés en même temps', () => {
    const points = [{ x: 320, y: 100 }, { x: 270, y: 120 }];
    expect(pressedKeys(points, LAYOUT)).toEqual(set('a', 'b'));
  });

  it('un doigt sur une diagonale : deux directions d\'un seul contact', () => {
    expect(pressedKeys([surCroix(45, 40)], LAYOUT)).toEqual(set('right', 'down'));
  });

  it('croix + action ensemble : courir en sautant (droite + A)', () => {
    const points = [surCroix(0, 40), { x: 320, y: 100 }];
    expect(pressedKeys(points, LAYOUT)).toEqual(set('right', 'a'));
  });

  it('deux doigts sur la MÊME touche ne la comptent qu\'une fois', () => {
    const points = [{ x: 315, y: 95 }, { x: 325, y: 105 }];
    expect(pressedKeys(points, LAYOUT)).toEqual(set('a'));
  });

  it('aucun point : tout est relâché (le filet anti-blocage)', () => {
    expect(pressedKeys([], LAYOUT)).toEqual(set());
  });
});

describe('diffKeys : ce qu\'il faut signaler, jamais la simple présence', () => {
  it('rouler droite → bas-droite : « down » entre, « right » reste (pas re-signalé)', () => {
    const avant = pressedKeys([surCroix(0, 40)], LAYOUT);     // right
    const apres = pressedKeys([surCroix(45, 40)], LAYOUT);    // right + down
    const { pressed, released } = diffKeys(avant, apres);
    expect(pressed, 'seul down est nouveau').toEqual(['down']);
    expect(released, 'right ne bouge pas, donc rien à relâcher').toEqual([]);
  });

  it('rouler bas-droite → bas : « right » sort', () => {
    const avant = pressedKeys([surCroix(45, 40)], LAYOUT);
    const apres = pressedKeys([surCroix(90, 40)], LAYOUT);
    const { pressed, released } = diffKeys(avant, apres);
    expect(pressed).toEqual([]);
    expect(released).toEqual(['right']);
  });

  it('lever le doigt : tout ce qui était pressé passe en relâche', () => {
    const avant = pressedKeys([surCroix(45, 40)], LAYOUT); // right + down
    const apres = pressedKeys([], LAYOUT);                 // plus rien
    const { pressed, released } = diffKeys(avant, apres);
    expect(pressed).toEqual([]);
    expect(released.sort()).toEqual(['down', 'right']);
  });

  it('rien ne change : aucun signal (le cas du maintien immobile)', () => {
    const s = pressedKeys([{ x: 320, y: 100 }], LAYOUT);
    expect(diffKeys(s, s)).toEqual({ pressed: [], released: [] });
  });
});
