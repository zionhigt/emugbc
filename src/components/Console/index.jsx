import React from 'react';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCaretDown, faCaretUp, faCaretRight, faCaretLeft, faA, faB } from '@fortawesome/free-solid-svg-icons';

import './Console.css';

// La coque de la console : structure minimale (une dalle dans un boîtier).
// Le contenu de l'écran — le canvas 160×144 — se compose en enfant.
// Les boutons pilotent la manette via les props onPress(key)/onRelease(key).
class Console extends React.Component {
  // les handlers d'un bouton pour une touche GB : souris ET tactile.
  // onMouseLeave/onTouchCancel relâchent si le doigt/curseur quitte en maintenant.
  buttonProps(key) {
    const { onPress, onRelease } = this.props;
    if (!onPress) return {}; // Console purement décorative (ex. tests)
    const press = (e) => { e.preventDefault(); onPress(key); };
    const release = (e) => { e.preventDefault(); onRelease(key); };
    return {
      type: 'button',
      onMouseDown: press,
      onMouseUp: release,
      onMouseLeave: release,
      onTouchStart: press,
      onTouchEnd: release,
      onTouchCancel: release,
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
            <button className="gbc-console__buttons--action-select" {...this.buttonProps('select')}>select</button>
            <button className="gbc-console__buttons--action-start" {...this.buttonProps('start')}>start</button>
          </div>
        </div>
      </div>
    );
  }
}

export default Console;
