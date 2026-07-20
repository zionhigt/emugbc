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

  // État d'entrée tenu HORS de React : le geste ne doit rien re-rendre.
  pointers = new Map();          // pointerId → {x, y}
  currentPressed = new Set();    // les touches enfoncées à l'instant
  elements = new Map();          // touche → l'élément bouton (pour le visuel)
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
    // chemin chaud d'un déplacement.
    window.addEventListener('resize', this.measureLayout);
    window.addEventListener('orientationchange', this.measureLayout);
    // Filet anti-blocage : perdre le focus lâche tout (sinon touche coincée).
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.onVisibility);
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
    window.removeEventListener('resize', this.measureLayout);
    window.removeEventListener('orientationchange', this.measureLayout);
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
      buttons.push({ key, x: r.left, y: r.top, w: r.width, h: r.height });
    }

    this.layout = { cross, buttons };
  };

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
    if (!el) return;
    if (on) el.setAttribute('data-pressed', '');
    else el.removeAttribute('data-pressed');
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
    const { children } = this.props;
    // Les boutons ne portent plus de handler : ils sont des ZONES (data-key) que
    // le traqueur mesure et pilote. Purement structurels et visuels.
    return (
      <div className="gbc-console">
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
      </div>
    );
  }
}

export default Console;
