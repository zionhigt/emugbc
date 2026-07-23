// Les coques du lancement GBC, moins l'Atomic Purple (transparente) : elle n'a
// pas de couleur de corps, seulement un plastique translucide — rien à décliner
// en thème.
//
// `shell`  : la couleur du boîtier lui-même.
// `accent` : la même famille, éclaircie — c'est elle qui porte les contours, les
//            halos et les liserés dans TOUTE l'application, pas seulement la coque.

export const SHELLS = {
  teal: { nom: 'Teal', shell: '#2583af', accent: '#35aadc' },
  berry: { nom: 'Berry', shell: '#b2317c', accent: '#e4529f' },
  grape: { nom: 'Grape', shell: '#6a3fa0', accent: '#9a6fd4' },
  kiwi: { nom: 'Kiwi', shell: '#4aa84f', accent: '#6fd074' },
  dandelion: { nom: 'Dandelion', shell: '#e8b81c', accent: '#ffd94d' },
  // Le DMG d'origine : hors-famille GBC, boîtier gris. Sa sérigraphie sous
  // l'écran passe de « GAME BOY COLOR » à « GAME BOY » — voir Console.css,
  // sélecteur [data-shell="dmg"]. Accent gris clair : rien d'autre ne se colore.
  dmg: { nom: 'DMG', shell: '#c3c2b4', accent: '#e4e3d6' },
};

// Teal = la coque d'origine du projet. Elle reste le défaut : changer ce réglage
// ne doit jamais changer l'apparence de quelqu'un qui n'a rien choisi.
export const DEFAULT_SHELL = 'teal';

export const SHELL_KEYS = Object.keys(SHELLS);

export const isShell = (key) => Object.prototype.hasOwnProperty.call(SHELLS, key);

// Le grain du plastique : un feTurbulence teinté, posé en `overlay` sur la coque.
// Le `#` doit être écrit `%23` — c'est une data-URI, pas du CSS.
const grain = (hex) =>
  `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'>` +
  `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.05' numOctaves='2' ` +
  `stitchTiles='stitch' result='noise'/><feColorMatrix in='noise' type='matrix' ` +
  `values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.5 0.5 0.5 0 0' result='alphaNoise'/>` +
  `<feFlood flood-color='%23${hex.slice(1)}' result='color'/>` +
  `<feComposite in='color' in2='alphaNoise' operator='in'/></filter>` +
  `<rect width='100%' height='100%' filter='url(%23n)'/></svg>")`;

const rgba = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

// Les variables posées sur :root. Tout le CSS de l'app lit celles-ci — c'est le
// seul point par lequel une couleur de coque se propage.
export function shellVariables(key) {
  const t = SHELLS[isShell(key) ? key : DEFAULT_SHELL];
  return {
    '--theme-shell': t.shell,
    '--theme-shell-grain': grain(t.shell),
    '--theme-accent': t.accent,
    '--theme-accent-soft': rgba(t.accent, 0.35),
    '--theme-glow-strong': rgba(t.shell, 0.3),
    '--theme-glow-wide': rgba(t.shell, 0.28),
  };
}
