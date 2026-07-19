import React from 'react';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCaretDown, faCaretUp, faCaretRight, faCaretLeft, faA, faB } from '@fortawesome/free-solid-svg-icons';

import './Console.css';

// Une secousse courte et sèche à l'appui : le retour tactile d'un vrai bouton.
// `navigator.vibrate` n'existe pas partout (iOS Safari ne l'implémente pas) et
// exige un geste utilisateur — d'où la garde, et le silence en cas d'absence.
const vibrer = () => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(12);
  }
};

// La coque de la console : structure minimale (une dalle dans un boîtier).
// Le contenu de l'écran — le canvas 160×144 — se compose en enfant.
// Les boutons pilotent la manette via les props onPress(key)/onRelease(key).
class Console extends React.Component {
  // l'animation d'appui est pilotée en JS via l'attribut data-pressed, PAS via
  // :active : le repaint 60 fps (setState de l'écran à chaque tick) re-rend la
  // Console en continu et empêche :active de « tenir ». Les events, eux, se
  // déclenchent bien — on s'appuie dessus.
  state = { pressed: {} };

  // les handlers d'un bouton pour une touche GB : souris ET tactile.
  // onMouseLeave/onTouchCancel relâchent si le doigt/curseur quitte en maintenant.
  buttonProps(key) {
    const { onPress, onRelease } = this.props;
    if (!onPress) return {}; // Console purement décorative (ex. tests)
    const setPressed = (value) =>
      this.setState((s) => ({ pressed: { ...s.pressed, [key]: value } }));
    // Tactile : touchstart est passif (preventDefault interdit → on presse
    // sans) ; on le garde sur touchend (non passif) pour tuer le clic fantôme.
    const press = () => { setPressed(true); vibrer(); onPress(key); };
    const release = () => { setPressed(false); onRelease(key); };
    const releaseTouch = (e) => { e.preventDefault(); release(); };
    return {
      type: 'button',
      'data-pressed': this.state.pressed[key] ? '' : undefined,
      onMouseDown: press,
      onMouseUp: release,
      onMouseLeave: release,
      onTouchStart: press,
      onTouchEnd: releaseTouch,
      onTouchCancel: release,
      // le maintien du doigt ouvre sinon le menu contextuel du système, avec
      // sa secousse haptique — on veut NOTRE vibration, pas celle d'Android
      onContextMenu: (e) => e.preventDefault(),
    };
  }

  render() {
    const { children } = this.props;
    return (
      <div className="gbc-console">
        <div className="gbc-console__screen">
          <div className="gbc-console__screen--frame">{children}</div>
        </div>
        <div className="gbc-console__buttons">
          <div className="gbc-console__buttons--container">
            <div className="gbc-console__buttons--cross">
              <button className="gbc-console__buttons--cross-up" {...this.buttonProps('up')}><FontAwesomeIcon icon={faCaretUp} /></button>
              <div className="gbc-console__buttons--horizontal">
                <button className="gbc-console__buttons--cross-left" {...this.buttonProps('left')}><FontAwesomeIcon icon={faCaretLeft} /></button>
                <div className="gbc-console__buttons--cross-center"></div>
                <button className="gbc-console__buttons--cross-right" {...this.buttonProps('right')}><FontAwesomeIcon icon={faCaretRight} /></button>
              </div>
              <button className="gbc-console__buttons--cross-down" {...this.buttonProps('down')}><FontAwesomeIcon icon={faCaretDown} /></button>
            </div>
            <div className="gbc-console__buttons--ab">
                <button className="gbc-console__buttons--b" {...this.buttonProps('b')}><FontAwesomeIcon icon={faB} /></button>
                <button className="gbc-console__buttons--a" {...this.buttonProps('a')}><FontAwesomeIcon icon={faA} /></button>
            </div>
          </div>
          <div className="gbc-console__buttons--actions">
            <span className="gbc-console__buttons--action">
              <button className="gbc-console__buttons--action-select" aria-label="select" {...this.buttonProps('select')}></button>
              <span className="gbc-console__buttons--action-label" aria-hidden="true">SELECT</span>
            </span>
            <span className="gbc-console__buttons--action">
              <button className="gbc-console__buttons--action-start" aria-label="start" {...this.buttonProps('start')}></button>
              <span className="gbc-console__buttons--action-label" aria-hidden="true">START</span>
            </span>
          </div>
        </div>
      </div>
    );
  }
}

export default Console;
