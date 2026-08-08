import React from 'react';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCaretDown, faCaretUp, faCaretRight, faCaretLeft, faA, faB } from '@fortawesome/free-solid-svg-icons';

import { pressedKeys, diffKeys } from './touchInput';
import './Console.css';

// Une secousse à l'appui — seuil perceptible élevé sur le moteur Android (ERM) :
// 60 ms est le compromis entre « se sent » et « ne traîne pas quand on martèle ».
const PULSE_MS = 60;

const vibrer = () => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(PULSE_MS);
  }
};

// Rayon de la croix = demi-diagonale de sa boîte, pour que les COINS (les
// diagonales) répondent ; un demi-côté les manquerait. Zone morte = fraction du
// rayon, le point mort central du vrai matériel. Réglables au doigt.
const CROSS_DEADZONE_FACTOR = 0.2;

// Rouler d'un bouton à l'autre (A+B simultané, le geste classique) doit
// traverser un point où LES DEUX sont enfoncés — sinon on retombe sur
// BR -> AP, un aller-retour qui se sent au relâché. Zones de A et B élargies
// pour se chevaucher au milieu, comme les secteurs de la croix aux diagonales.
const AB_ROLL_MARGIN_FACTOR = 0.3;

// Select/Start sont de fines pastilles (bien plus larges que hautes) : leur
// hit box grandit en hauteur seulement, le bouton restant au milieu. La
// largeur ne bouge pas — Select et Start sont côte à côte, la faire grandir
// les ferait se chevaucher (« pas de collision entre les appuyés »).
const ACTION_HEIGHT_FACTOR = 3;

// La coque de la console : structure minimale (une dalle dans un boîtier).
// Le contenu de l'écran — le canvas 160×144 — se compose en enfant.
//
// LES ENTRÉES sont géométriques, pas par bouton (voir touchInput.js). Un seul
// traqueur Pointer Events sur le conteneur suit chaque doigt, hit-teste sa
// position contre les zones, et signale les touches via onPress/onRelease. Ça
// donne rouler sur la croix, les diagonales, le multi-doigts — impossibles avec
// un handler par bouton.
class Console extends React.Component {
  buttonsRef = React.createRef();
  debugRef = React.createRef(); // conteneur des rectangles de debug (prop `debug`)
  consoleRef = React.createRef(); // la coque entière — observée pour son AABB

  // État d'entrée tenu HORS de React : le geste ne doit rien re-rendre.
  pointers = new Map();          // pointerId → {x, y}
  currentPressed = new Set();    // les touches enfoncées à l'instant
  elements = new Map();          // touche → l'élément bouton (pour le visuel)
  debugElements = new Map();     // touche → son rectangle de debug (idem, en vert au press)
  layout = null;                 // zones mesurées : { cross, buttons }

  componentDidMount() {
    const root = this.buttonsRef.current;
    if (!root) return;

    // Carte touche → élément, pour piloter data-pressed en direct.
    for (const el of root.querySelectorAll('[data-key]')) {
      this.elements.set(el.dataset.key, el);
    }
    this.measureLayout();

    // Pointer Events : un seul chemin pour souris ET tactile. On écoute sur le
    // CONTENEUR (pas par bouton) et on ne capture pas le pointeur — c'est ce qui
    // permet de suivre un doigt qui roule d'une zone à l'autre.
    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('pointermove', this.onPointerMove);
    root.addEventListener('pointerup', this.onPointerUp);
    root.addEventListener('pointercancel', this.onPointerUp);
    // touchstart non passif : preventDefault coupe la reconnaissance de geste du
    // navigateur (sélection, loupe, menu long-press) qui, en s'activant sur un
    // maintien, sature le compositeur et fait chuter les FPS.
    root.addEventListener('touchstart', this.blockNativeGesture, { passive: false });

    // Les zones bougent avec la mise en page : on re-mesure, jamais dans le
    // chemin chaud d'un déplacement. visualViewport.resize en plus de
    // window.resize : sur Android, la barre système recalcule --vvh (voir
    // ViewportSync) sans forcément déclencher de resize classique — sans ce
    // listener, le visuel suit --vvh mais les hit box restent figées sur
    // l'ancienne mesure, décalées de ce qu'on voit.
    window.visualViewport?.addEventListener('resize', this.measureLayout);
    window.addEventListener('resize', this.measureLayout);
    window.addEventListener('orientationchange', this.measureLayout);
    // Filet le plus robuste des trois : en immersion mobile, .gbc-console a
    // `height: 100%` — si --vvh change après coup (voir ViewportSync), sa
    // hauteur RÉELLE bouge en cascade, SANS émettre le moindre resize ni
    // visualViewport-resize (une variable CSS posée en JS ne déclenche aucun
    // événement). ResizeObserver, lui, réagit à la boîte réellement rendue,
    // peu importe ce qui l'a fait bouger.
    if (typeof ResizeObserver !== 'undefined' && this.consoleRef.current) {
      this.resizeObserver = new ResizeObserver(this.measureLayout);
      this.resizeObserver.observe(this.consoleRef.current);
    }
    // Filet anti-blocage : perdre le focus lâche tout (sinon touche coincée).
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  componentDidUpdate(prevProps) {
    // Le layout ne bouge pas quand debug bascule : on repeint avec les zones
    // déjà mesurées, pas la peine de remesurer.
    if (prevProps.debug !== this.props.debug) this.paintDebug();
  }

  componentWillUnmount() {
    const root = this.buttonsRef.current;
    if (root) {
      root.removeEventListener('pointerdown', this.onPointerDown);
      root.removeEventListener('pointermove', this.onPointerMove);
      root.removeEventListener('pointerup', this.onPointerUp);
      root.removeEventListener('pointercancel', this.onPointerUp);
      root.removeEventListener('touchstart', this.blockNativeGesture, { passive: false });
    }
    window.visualViewport?.removeEventListener('resize', this.measureLayout);
    window.removeEventListener('resize', this.measureLayout);
    window.removeEventListener('orientationchange', this.measureLayout);
    this.resizeObserver?.disconnect();
    window.removeEventListener('blur', this.releaseAll);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.releaseAll();
  }

  blockNativeGesture = (e) => { e.preventDefault(); };

  // Mesure les zones UNE fois (montage, resize, rotation). Jamais appelée pendant
  // un déplacement — le hit-test du move ne fait que de l'arithmétique.
  measureLayout = () => {
    const root = this.buttonsRef.current;
    if (!root) return;

    const crossEl = root.querySelector('.gbc-console__buttons--cross');
    let cross = null;
    if (crossEl) {
      const r = crossEl.getBoundingClientRect();
      const radius = Math.hypot(r.width, r.height) / 2;
      cross = {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        radius,
        deadzone: radius * CROSS_DEADZONE_FACTOR,
      };
    }

    // Les 4 boutons d'action (A, B, Select, Start) : des rectangles. Les 4
    // directions n'ont PAS de zone propre — elles sont la croix, gérée en angle.
    const buttons = [];
    for (const key of ['a', 'b', 'select', 'start']) {
      const el = this.elements.get(key);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (key === 'a' || key === 'b') {
        const mx = r.width * AB_ROLL_MARGIN_FACTOR;
        const my = r.height * AB_ROLL_MARGIN_FACTOR;
        buttons.push({ key, x: r.left - mx, y: r.top - my, w: r.width + 2 * mx, h: r.height + 2 * my });
      } else if (key === 'select' || key === 'start') {
        // Centre pris sur getBoundingClientRect (correct même pivoté : une
        // rotation autour du centre ne déplace pas le centre). Taille prise
        // sur offsetWidth/offsetHeight (la boîte de mise en page, JAMAIS
        // affectée par transform) — pas sur r.width/r.height, qui sous la
        // coque DMG donneraient l'AABB gonflée du bouton tourné à -25°.
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const w = el.offsetWidth;
        const h = el.offsetHeight * ACTION_HEIGHT_FACTOR;
        buttons.push({ key, x: cx - w / 2, y: cy - h / 2, w, h });
      } else {
        buttons.push({ key, x: r.left, y: r.top, w: r.width, h: r.height });
      }
    }

    this.layout = { cross, buttons };
    this.paintDebug();
  };

  // Dessine les zones RÉELLEMENT utilisées par le hit-test (hit box élargies
  // comprises, pas la taille visuelle des boutons) — pour vérifier au doigt
  // que A/B se chevauchent bien au milieu et que Select/Start ne se touchent
  // pas. Purement visuel, jamais lu par le hit-test lui-même.
  paintDebug = () => {
    const root = this.debugRef.current;
    this.debugElements.clear(); // les anciens rectangles partent avec innerHTML
    if (!root) return; // prop `debug` à faux : pas de conteneur monté
    root.innerHTML = '';
    if (!this.layout) return;

    const { cross, buttons } = this.layout;
    if (cross) {
      root.appendChild(this.debugCircle(cross.cx, cross.cy, cross.radius, 'rayon'));
      root.appendChild(this.debugCircle(cross.cx, cross.cy, cross.deadzone, 'zone morte'));
    }
    for (const btn of buttons) {
      const el = this.debugRect(btn);
      this.debugElements.set(btn.key, el);
      // remesurer (resize) ou allumer le debug en pleine pression ne doit pas
      // perdre le vert — on retrouve l'état depuis les touches déjà enfoncées.
      if (this.currentPressed.has(btn.key)) el.setAttribute('data-pressed', '');
      root.appendChild(el);
    }
  };

  debugRect({ key, x, y, w, h }) {
    const el = document.createElement('div');
    el.className = 'gbc-console__debug-hitbox';
    el.dataset.key = key;
    Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    el.textContent = key;
    return el;
  }

  debugCircle(cx, cy, radius, label) {
    const el = document.createElement('div');
    el.className = 'gbc-console__debug-circle';
    el.dataset.label = label;
    const size = radius * 2;
    Object.assign(el.style, { left: `${cx - radius}px`, top: `${cy - radius}px`, width: `${size}px`, height: `${size}px` });
    return el;
  }

  // Recalcule l'ensemble pressé depuis TOUS les points, et ne signale QUE le diff.
  recompute() {
    if (!this.layout) return;
    const points = [...this.pointers.values()];
    const next = pressedKeys(points, this.layout);
    const { pressed, released } = diffKeys(this.currentPressed, next);
    this.applyDiff(pressed, released);
    this.currentPressed = next;
  }

  // Signale au monde ET peint le visuel — en direct, sans React.
  applyDiff(pressed, released) {
    const { onPress, onRelease } = this.props;
    for (const key of released) {
      this.setVisual(key, false);
      if (onRelease) onRelease(key);
    }
    for (const key of pressed) {
      this.setVisual(key, true);
      vibrer(); // seulement à l'ENTRÉE d'une touche : rouler ne vibre pas en boucle
      if (onPress) onPress(key);
    }
  }

  setVisual(key, on) {
    const el = this.elements.get(key);
    if (el) {
      if (on) el.setAttribute('data-pressed', '');
      else el.removeAttribute('data-pressed');
    }
    // le rectangle de debug (s'il existe : croix exclue, pas de rect par
    // direction) suit le même état — vert au press, pour voir QUELLE zone
    // a déclenché sans deviner depuis le visuel du bouton réel.
    const dbg = this.debugElements.get(key);
    if (dbg) {
      if (on) dbg.setAttribute('data-pressed', '');
      else dbg.removeAttribute('data-pressed');
    }
  }

  onPointerDown = (e) => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.recompute();
  };

  onPointerMove = (e) => {
    if (!this.pointers.has(e.pointerId)) return; // un survol sans appui : on ignore
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.recompute();
  };

  onPointerUp = (e) => {
    this.pointers.delete(e.pointerId);
    this.recompute();
  };

  onVisibility = () => {
    if (document.visibilityState === 'hidden') this.releaseAll();
  };

  // Tout lâcher : vide les pointeurs, relâche chaque touche encore enfoncée.
  releaseAll = () => {
    this.pointers.clear();
    this.recompute(); // next = vide → tout ce qui restait part en relâche
  };

  render() {
    const { children, debug } = this.props;
    // Les boutons ne portent plus de handler : ils sont des ZONES (data-key) que
    // le traqueur mesure et pilote. Purement structurels et visuels.
    return (
      <div className="gbc-console" ref={this.consoleRef}>
        <div className="gbc-console__screen">
          <div className="gbc-console__screen--frame">{children}</div>
        </div>
        <div className="gbc-console__buttons" ref={this.buttonsRef}>
          <div className="gbc-console__buttons--container">
            <div className="gbc-console__buttons--cross">
              <button type="button" className="gbc-console__buttons--cross-up" data-key="up"><FontAwesomeIcon icon={faCaretUp} /></button>
              <div className="gbc-console__buttons--horizontal">
                <button type="button" className="gbc-console__buttons--cross-left" data-key="left"><FontAwesomeIcon icon={faCaretLeft} /></button>
                <div className="gbc-console__buttons--cross-center"></div>
                <button type="button" className="gbc-console__buttons--cross-right" data-key="right"><FontAwesomeIcon icon={faCaretRight} /></button>
              </div>
              <button type="button" className="gbc-console__buttons--cross-down" data-key="down"><FontAwesomeIcon icon={faCaretDown} /></button>
            </div>
            <div className="gbc-console__buttons--ab">
                <button type="button" className="gbc-console__buttons--b" data-key="b" aria-label="b"><FontAwesomeIcon icon={faB} /></button>
                <button type="button" className="gbc-console__buttons--a" data-key="a" aria-label="a"><FontAwesomeIcon icon={faA} /></button>
            </div>
          </div>
          <div className="gbc-console__buttons--actions">
            <span className="gbc-console__buttons--action">
              <button type="button" className="gbc-console__buttons--action-select" data-key="select" aria-label="select"></button>
              <span className="gbc-console__buttons--action-label" aria-hidden="true">SELECT</span>
            </span>
            <span className="gbc-console__buttons--action">
              <button type="button" className="gbc-console__buttons--action-start" data-key="start" aria-label="start"></button>
              <span className="gbc-console__buttons--action-label" aria-hidden="true">START</span>
            </span>
          </div>
        </div>
        {/* pointer-events: none — ne doit JAMAIS intercepter un appui réel */}
        {debug && <div className="gbc-console__debug-overlay" ref={this.debugRef} />}
      </div>
    );
  }
}

export default Console;
