import React from 'react';

import { SCREEN_WIDTH, SCREEN_HEIGHT } from './CanvasRenderer';

// La dalle : un <canvas> à la résolution native 160×144, agrandi par le CSS
// de la Console sans lissage.
//
// Le rendu est piloté par l'Emulator : soit un CanvasRenderer sur le thread
// principal (repli), soit — quand OffscreenCanvas est dispo — le canvas est
// TRANSFÉRÉ à un worker qui dessine dedans. On ne crée donc AUCUN contexte 2D
// ici : `getContext` avant `transferControlToOffscreen` ferait échouer le
// transfert. Ce composant n'expose plus que l'élément.
class Canvas extends React.Component {
  canvasRef = React.createRef();

  getElement() {
    return this.canvasRef.current;
  }

  render() {
    return (
      <canvas
        ref={this.canvasRef}
        width={SCREEN_WIDTH}
        height={SCREEN_HEIGHT}
      />
    );
  }
}

export default Canvas;
