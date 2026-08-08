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
    // La conversion RGB555 -> RGBA, tabulée une fois pour toutes : 32 768
    // entrées, soit 128 Ko, contre trois décalages et trois multiplications par
    // pixel et par trame. Le PPU sort du RGB555 pour les DEUX modèles (décision
    // D1 du cahier CGB), donc ce chemin est le seul, sans « si CGB ».
    this.rgba = new Uint32Array(0x8000);
    for (let color = 0; color < 0x8000; color++) {
      // Cinq bits vers huit : on recopie les bits de poids fort dans les trois
      // bits bas, pour que 31 donne 255 et non 248 — sinon le blanc est gris.
      const r5 = color & 0x1f;
      const g5 = (color >> 5) & 0x1f;
      const b5 = (color >> 10) & 0x1f;
      const r = (r5 << 3) | (r5 >> 2);
      const g = (g5 << 3) | (g5 >> 2);
      const b = (b5 << 3) | (b5 >> 2);
      this.rgba[color] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
  }

  draw(screen) {
    if (!this.ctx || !screen) return;
    for (let i = 0; i < screen.length; i++) {
      this.buf32[i] = this.rgba[screen[i] & 0x7fff];
    }
    this.ctx.putImageData(this.image, 0, 0);
  }
}
