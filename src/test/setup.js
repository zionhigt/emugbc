import '@testing-library/jest-dom/vitest';

// jsdom n'implémente pas le rendu canvas : son `getContext` rend null ET journalise
// « Not implemented: HTMLCanvasElement.prototype.getContext » dans sa console virtuelle.
// D'où le bruit dans les rapports de test.
//
// On pose un contexte 2D minimal — exactement ce que `CanvasRenderer` consomme. Deux
// bénéfices : le bruit disparaît, et surtout le chemin de dessin est réellement exercé.
// Sans ce talon, le garde `if (!this.ctx) return` court-circuite `draw()` en silence :
// la palette et la boucle de pixels ne sont jamais exécutées par la suite de tests.
//
// (Alternative écartée : le paquet npm `canvas`, une dépendance native lourde pour un
// besoin qui tient en dix lignes.)
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext(type) {
    if (type !== '2d') return null;
    return {
      createImageData: (width, height) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: () => {},
    };
  };
}
