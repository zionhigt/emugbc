import React from 'react';

import CanvasRenderer, { SCREEN_WIDTH, SCREEN_HEIGHT } from './CanvasRenderer';

// La dalle : un <canvas> à la résolution native 160×144, agrandi par le CSS
// de la Console sans lissage. Le composant ne fait QUE brancher le rendu : il
// crée le contrôleur au montage, et le laisse redessiner quand `screen` change.
class Canvas extends React.Component {
  canvasRef = React.createRef();

  componentDidMount() {
    this.renderer = new CanvasRenderer(this.canvasRef.current);
    this.renderer.draw(this.props.screen);
  }

  componentDidUpdate() {
    // NB : si `screen` est le MÊME Uint8Array muté en place (ppu.screen), React
    // ne verra aucun changement de référence — ton state devra livrer une
    // nouvelle identité (snapshot) à chaque trame pour déclencher ce redraw.
    if (this.renderer) this.renderer.draw(this.props.screen);
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
