import React from 'react';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCaretDown, faCaretUp, faCaretRight, faCaretLeft, faA, faB } from '@fortawesome/free-solid-svg-icons';

import './Console.css';

// La coque de la console : structure minimale (une dalle dans un boîtier).
// Le contenu de l'écran — ton canvas 160×144, à venir — se compose en enfant.
class Console extends React.Component {
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
              <button className="gbc-console__buttons--cross-up"><FontAwesomeIcon icon={faCaretUp} /></button>
              <div className="gbc-console__buttons--horizontal">
                <button className="gbc-console__buttons--cross-left"><FontAwesomeIcon icon={faCaretLeft} /></button>
                <div className="gbc-console__buttons--cross-center"></div>
                <button className="gbc-console__buttons--cross-right"><FontAwesomeIcon icon={faCaretRight} /></button>
              </div>
              <button className="gbc-console__buttons--cross-down"><FontAwesomeIcon icon={faCaretDown} /></button>
            </div>
            <div className="gbc-console__buttons--ab">
                <button className="gbc-console__buttons--b"><FontAwesomeIcon icon={faB} /></button>
                <button className="gbc-console__buttons--a"><FontAwesomeIcon icon={faA} /></button>
            </div>
          </div>
          <div className="gbc-console__buttons--actions">
            <button className="gbc-console__buttons--action-select">select</button>
            <button className="gbc-console__buttons--action-start">start</button>
          </div>
        </div>
      </div>
    );
  }
}

export default Console;
