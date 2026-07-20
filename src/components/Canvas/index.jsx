import React from 'react';

import CanvasRenderer, { SCREEN_WIDTH, SCREEN_HEIGHT } from './CanvasRenderer';

// La dalle : un <canvas> à la résolution native 160×144, agrandi par le CSS
// de la Console sans lissage.
//
// Le redraw des trames NE passe PAS par React : l'Emulator appelle `draw()`
// impérativement via un ref, une fois par tick. Faire transiter le tampon par
// un setState re-rendrait tout l'arbre (boutons, icônes, dock) 60 fois par
// seconde — invisible sur un CPU de bureau, mortel sur mobile.
class Canvas extends React.Component {
  canvasRef = React.createRef();

  componentDidMount() {
    this.renderer = new CanvasRenderer(this.canvasRef.current);
    this.renderer.draw(this.props.screen); // première trame (ou écran éteint)
  }

  // Appelé par l'Emulator à chaque tick, HORS du cycle React : aucun re-render,
  // juste le canvas qui se repeint. `screen` est le Uint8Array de ppu.screen,
  // muté en place — inutile d'en faire un snapshot, on ne compare rien.
  draw(screen) {
    if (this.renderer) this.renderer.draw(screen);
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
