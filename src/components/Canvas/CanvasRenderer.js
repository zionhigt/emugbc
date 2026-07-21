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
    this.buf32 = new Uint32Array(this.image.data.buffer);
  }

  get palette() {
    return {
      0b00: [155, 188, 15, 255],
      0b01: [139, 172, 15, 255],
      0b10: [48, 98, 48, 255],
      0b11: [15, 56, 15, 255],
    }
  }

  get palette32() {
    return Object.values(this.palette).map(([r, g, b, a]) =>
      (a << 24) | (b << 16) | (g << 8) | r
    );
  }

  draw(screen) {
    if (!this.ctx || !screen) return;
    for (let i = 0; i < screen.length; i++) {
      this.buf32[i] = this.palette32[screen[i]];
    }
    this.ctx.putImageData(this.image, 0, 0);
  }
}
