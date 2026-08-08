import React from 'react';

// Le pont entre le viewport RÉEL et le CSS : pose --vvh (en pixels) sur <html>.
// `100dvh` suffit la plupart du temps, mais Android ne relance pas toujours le
// même calcul de barre système selon le contexte du reload (PWA relancée
// depuis l'écran d'accueil, pull-to-refresh...) — au premier chargement la
// barre du bas est prise en compte, pas forcément ensuite. `visualViewport`,
// lui, mesure la zone visible à chaque fois, sans dépendre de ce recalcul.
class ViewportSync extends React.Component {
  componentDidMount() {
    this.mesurer();
    window.visualViewport?.addEventListener('resize', this.mesurer);
    window.addEventListener('resize', this.mesurer);
    window.addEventListener('orientationchange', this.mesurer);
  }

  componentWillUnmount() {
    window.visualViewport?.removeEventListener('resize', this.mesurer);
    window.removeEventListener('resize', this.mesurer);
    window.removeEventListener('orientationchange', this.mesurer);
  }

  // fléché : passé tel quel aux listeners, doit garder son `this`
  mesurer = () => {
    const hauteur = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--vvh', `${hauteur}px`);
  };

  render() {
    return null;
  }
}

export default ViewportSync;
