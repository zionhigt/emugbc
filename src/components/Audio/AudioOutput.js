// Le contrôleur de sortie son : possède l'AudioContext et le nœud worklet,
// expose push(left, right). Miroir de CanvasRenderer côté son — le squelette
// pose le tuyau, AudioSampler fait le calcul, ce fichier ne fait que le brancher.

import { SAMPLE_RATE } from './AudioSampler';

const WORKLET_NAME = 'pcm-player';

export default class AudioOutput {
  constructor() {
    this.ctx = null;
    this.node = null;
    this._ready = null;
  }

  // Doit être appelé depuis un geste utilisateur (le choix du fichier .gb en
  // est un) : la plupart des navigateurs refusent sinon de démarrer le son.
  start() {
    if (this._ready) return this._ready;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    // jsdom (tests) ou navigateur trop vieux : pas d'AudioContext, on reste
    // inoffensif — même repli que l'OffscreenCanvas du rendu.
    if (!AudioContextClass) {
      return Promise.resolve();
    }

    this.ctx = new AudioContextClass({ sampleRate: SAMPLE_RATE });
    const url = new URL('./pcm-player.worklet.js', import.meta.url);
    this._ready = this.ctx.audioWorklet
      .addModule(url)
      .then(() => {
        this.node = new AudioWorkletNode(this.ctx, WORKLET_NAME, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.node.connect(this.ctx.destination);
      })
      .catch(() => {}); // CSP, module refusé... le jeu reste jouable sans son
    return this._ready;
  }

  push(left, right) {
    if (!this.node || left.length === 0) return;
    this.node.port.postMessage({ left, right }, [left.buffer, right.buffer]);
  }

  close() {
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.node = null;
    this._ready = null;
  }
}
