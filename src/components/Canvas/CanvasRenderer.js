// Le contrôleur de rendu : il possède le contexte 2D et le tampon de pixels,
// et expose draw(screen). LE DESSIN est à toi — le squelette te donne les
// outils (le contexte, une ImageData 160×144 réutilisable), tu remplis le
// mapping teinte → pixel.

export const SCREEN_WIDTH = 160;
export const SCREEN_HEIGHT = 144;

export default class CanvasRenderer {
  constructor(canvas) {
    this.ctx = canvas.getContext('2d');
    // jsdom (tests) peut ne pas fournir de contexte 2D : on reste inoffensif.
    if (!this.ctx) return;
    // un tampon RGBA (4 octets/pixel) de la taille de l'écran, réutilisé
    // à chaque trame — on n'en réalloue jamais.
    this.image = this.ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  get palette() {
    return {
      0b00: [155, 188, 15, 255],
      0b01: [139, 172, 15, 255],
      0b10: [48, 98, 48, 255],
      0b11: [15, 56, 15, 255],
    }
  }

  draw(screen) {
    if (!this.ctx || !screen) return;
    const palette = this.palette;
    for (let i = 0; i < screen.length; i++) {
      const colors = palette[screen[i]];
      for (let j = 0; j < colors.length; j++) {
        this.image.data[i*4+j] = colors[j];
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
    // TODO (à toi) : pour chaque pixel i de `screen` (une teinte 0-3),
    //   écrire 4 octets R,G,B,A dans this.image.data à l'offset i*4,
    // puis publier le tampon :
    //   this.ctx.putImageData(this.image, 0, 0);
    //
    // La palette (teinte 0-3 → RGBA) est ton choix — la même que les
    // variables --gbc-shade-* du CSS, ou une autre.
  }
}
