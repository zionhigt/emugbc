// Worker d'émulation : la Machine ET le rendu tournent ICI, hors du thread
// principal. Le main ne fait plus que transmettre les touches (postMessage) et
// afficher l'OffscreenCanvas que le browser composite tout seul. Résultat : les
// événements tactiles du main ne peuvent plus retarder ni l'émulation ni le
// rendu, et le GC du worker ne stutter plus l'écran.
//
// Messages reçus : { canvas } (OffscreenCanvas), { load, bytes }, { press/release, key }.
// Message émis   : { type: 'metrics', stats } (~5×/s, pour l'overlay).

import { MachineBuilder } from '../../emulator/core/index.js';
import buildCartridge from '../../emulator/core/cartridge/Cartridge.js';
import CanvasRenderer from '../../components/Canvas/CanvasRenderer.js';
import Profiler from '../../components/DebugOverlay/Profiler.js';
import AudioSampler from '../../components/Audio/AudioSampler.js';

const FRAME_MS = 1000 / 59.7275;
// Retard rattrapable au plus 2 trames : au-delà, on abandonne le temps perdu
// plutôt que de fast-forwarder une rafale de trames (glitch visible à l'appui).
const MAX_CATCHUP = 2 * FRAME_MS;
const Cartridge = buildCartridge();
// Un worker n'a PAS toujours requestAnimationFrame : Chrome/Android oui (avec
// OffscreenCanvas), sinon on retombe sur setTimeout — l'OffscreenCanvas lisse
// la présentation dans les deux cas.
const hasRaf = typeof requestAnimationFrame === 'function';

let machine = null;
let renderer = null;
let sampler = null;
const profiler = new Profiler();
let acc = 0;
let last = 0;

function schedule() {
  if (hasRaf) requestAnimationFrame(loop);
  else setTimeout(loop, FRAME_MS);
}

function loop() {
  if (!machine) return;
  const now = performance.now();
  const delta = now - last;
  last = now;
  acc += delta;
  // Anti-rattrapage express : après un accroc (compositeur occupé par un appui,
  // GC, onglet masqué), on ne fast-forward PAS une rafale de trames d'un coup —
  // ça se voit comme un bond/glitch. On plafonne le retard rattrapable à 2 trames.
  if (acc > MAX_CATCHUP) acc = MAX_CATCHUP;
  while (acc >= FRAME_MS) {
    profiler.tickStart();
    machine.handleTick({ detail: 'tick' }); // 1 trame GB (+ dessin via onTick)
    profiler.tickEnd();
    acc -= FRAME_MS;
  }
  schedule();
}

self.onmessage = ({ data }) => {
  switch (data.type) {
    case 'canvas':
      renderer = new CanvasRenderer(data.canvas);
      break;
    case 'load':
      machine = MachineBuilder();
      machine.plugCartridge(new Cartridge(new Uint8Array(data.bytes)));
      sampler = new AudioSampler(); // état propre (filtre + phase) pour chaque cartouche
      // À CHAQUE cycle, pas une fois par trame : apu.sample(cycle) partage son
      // curseur avec les lectures du CPU (NR52 avance le sweep du canal 1) —
      // l'interroger après coup, une fois la trame rejouée, lui redemanderait
      // des dates déjà dépassées (voir channel1.js, frequencyAt).
      machine.subscribeCycleUpdate((mach) => sampler.advance(mach.apu, mach.totalCycles));
      machine.onTick((mach) => {
        if (renderer) {
          const t = performance.now();
          renderer.draw(mach.ppu.screen);
          profiler.recordDraw(performance.now() - t);
        }
        // Le worker n'a pas d'AudioContext (hors d'un contexte Window) : on ne
        // fait ici que le calcul, les échantillons partent au main-thread —
        // un seul envoi par trame, pas un par cycle.
        const { left, right } = sampler.drain();
        if (left.length) self.postMessage({ type: 'audio', left, right }, [left.buffer, right.buffer]);
      });
      last = performance.now();
      acc = 0;
      schedule();
      break;
    case 'press':
      if (machine) machine.joypad.onPress(data.key);
      break;
    case 'release':
      if (machine) machine.joypad.onRelease(data.key);
      break;
  }
};

// « Je suis vivant ». Le main attend ce message AVANT de détacher son canvas :
// un `new Worker()` dont le script ne se charge pas (404 après une bascule de
// service worker, CSP, module refusé) ne lève rien de synchrone, et un canvas
// transféré ne revient jamais. Tant qu'on n'a pas dit bonjour, le repli
// main-thread doit rester possible.
self.postMessage({ type: 'ready' });

// Métriques renvoyées ~5×/s : le main les stocke, l'overlay les lit.
setInterval(() => {
  const stats = profiler.stats();
  if (stats) self.postMessage({ type: 'metrics', stats });
}, 200);
