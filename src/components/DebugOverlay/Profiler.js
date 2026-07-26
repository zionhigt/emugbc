// Profiler : mesure, par trame, le temps d'ÉMULATION vs le temps de DESSIN,
// et le FPS RÉEL (trames produites par seconde de temps mur).
//
// Branchement (aucun fichier cœur modifié) :
//   - tickStart()/tickEnd() entourent chaque trame émulée (handleTick) → `total`
//   - recordDraw(ms) est appelé autour de canvas.draw → `draw`
//   - `emu = total − draw` (pas de 3e sonde au milieu du tick)
//
// FPS : SURTOUT PAS `1000/écart-entre-trames` — avec l'accumulateur (rAF), les
// trames arrivent en salves (0, 1 ou 2 par rAF), donc l'écart instantané est
// trompeur (pics à 130+). On compte les trames sur la FENÊTRE / le temps mur.

export default class Profiler {
  constructor(windowSize = 90) {
    this.windowSize = windowSize; // ~1,5 s à 60 fps
    this._t0 = 0;
    this._draw = 0;
    this.samples = []; // { t, emu, draw, total }
  }

  tickStart() {
    this._t0 = performance.now();
  }

  recordDraw(ms) {
    this._draw = ms;
  }

  tickEnd() {
    const total = performance.now() - this._t0;
    const emu = Math.max(0, total - this._draw);
    this.samples.push({ t: this._t0, emu, draw: this._draw, total });
    if (this.samples.length > this.windowSize) this.samples.shift();
    this._draw = 0;
  }

  stats() {
    const s = this.samples;
    if (s.length < 2) return null;
    const avg = (k) => s.reduce((a, x) => a + x[k], 0) / s.length;
    // VRAI fps : nb de trames sur la durée mur de la fenêtre.
    const span = s[s.length - 1].t - s[0].t;
    const fps = span > 0 ? ((s.length - 1) / span) * 1000 : 0;
    return {
      fps: Math.round(fps),
      emu: +avg('emu').toFixed(1),
      draw: +avg('draw').toFixed(1),
      total: +avg('total').toFixed(1),
      totalMax: +Math.max(...s.map((x) => x.total)).toFixed(1), // la pire trame
    };
  }
}
