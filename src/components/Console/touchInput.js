// Logique d'entrée manette — PURE, sans aucun DOM.
//
// Le modèle par bouton (un handler chacun) ne sait pas rouler sur la croix ni
// gérer un doigt à cheval sur deux zones. On remplace ça par de la géométrie :
// on connaît la position de chaque point de contact et la zone de chaque touche,
// on en déduit l'ensemble des touches enfoncées. Rouler, glisser, diagonales,
// multi-doigts en découlent tout seuls.
//
// Toutes les coordonnées sont dans le MÊME repère (celui de l'écran, y vers le
// bas). Le mesurage des zones — getBoundingClientRect — vit dans la couche qui
// pose les listeners ; ici on ne fait que du calcul.

// Les 8 secteurs de la croix, dans l'ordre des angles (0 = droite, sens horaire
// car y descend). Chaque secteur rend les directions SIMULTANÉES qu'il presse :
// un coin presse deux directions, comme la vraie croix physique.
const SECTORS = [
  ['right'],          // 0   — droite
  ['right', 'down'],  // 45  — bas-droite
  ['down'],           // 90  — bas
  ['down', 'left'],   // 135 — bas-gauche
  ['left'],           // 180 — gauche
  ['left', 'up'],     // 225 — haut-gauche
  ['up'],             // 270 — haut
  ['up', 'right'],    // 315 — haut-droite
];

const TAU = Math.PI * 2;

/**
 * Les directions enfoncées par un point sur la croix.
 * @param {{x,y}} point
 * @param {{cx,cy,radius,deadzone}} cross  centre, rayon utile, zone morte centrale
 * @returns {string[]} 0, 1 ou 2 directions
 */
export function crossKeys(point, cross) {
  const dx = point.x - cross.cx;
  const dy = point.y - cross.cy;
  const dist = Math.hypot(dx, dy);
  if (dist > cross.radius) return [];   // trop loin : pas sur la croix
  if (dist < cross.deadzone) return []; // pile au centre : aucune direction franche

  // angle ramené dans [0, 2π), 0 = droite, croissant vers le bas
  let a = Math.atan2(dy, dx);
  if (a < 0) a += TAU;

  // 8 secteurs de 45°, CENTRÉS sur les axes et les diagonales : le round place
  // la frontière à ±22,5° de chaque direction, donc les diagonales sont aussi
  // larges que les cardinales — généreux, ce qu'on veut pour un plateformer.
  const sector = Math.round(a / (Math.PI / 4)) % 8;
  return SECTORS[sector];
}

/**
 * La touche d'un bouton rectangulaire si le point tombe dedans, sinon null.
 * @param {{x,y}} point
 * @param {{key,x,y,w,h}} btn  coin haut-gauche + dimensions
 */
export function buttonKey(point, btn) {
  if (point.x < btn.x || point.x > btn.x + btn.w) return null;
  if (point.y < btn.y || point.y > btn.y + btn.h) return null;
  return btn.key;
}

/**
 * L'ensemble des touches enfoncées par TOUS les points de contact réunis.
 * Un Set : deux doigts sur la même touche ne la comptent qu'une fois, et un
 * doigt à cheval croix+bouton ajoute les deux.
 * @param {Array<{x,y}>} points
 * @param {{cross?, buttons: Array}} layout
 * @returns {Set<string>}
 */
export function pressedKeys(points, layout) {
  const keys = new Set();
  for (const p of points) {
    if (layout.cross) {
      for (const k of crossKeys(p, layout.cross)) keys.add(k);
    }
    for (const btn of layout.buttons) {
      const k = buttonKey(p, btn);
      if (k) keys.add(k);
    }
  }
  return keys;
}

/**
 * Ce qui a changé entre deux états : les touches à SIGNALER en appui et en
 * relâche. C'est ce diff qui décide des onPress/onRelease (et de la vibration),
 * jamais la simple présence — sinon rouler ferait vibrer à chaque déplacement.
 * @param {Set<string>} before
 * @param {Set<string>} after
 * @returns {{pressed: string[], released: string[]}}
 */
export function diffKeys(before, after) {
  const pressed = [];
  const released = [];
  for (const k of after) if (!before.has(k)) pressed.push(k);
  for (const k of before) if (!after.has(k)) released.push(k);
  return { pressed, released };
}
