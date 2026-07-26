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

const FRAME_MS = 1000 / 59.7275;
const Cartridge = buildCartridge();
// Un worker n'a PAS toujours requestAnimationFrame : Chrome/Android oui (avec
// OffscreenCanvas), sinon on retombe sur setTimeout — l'OffscreenCanvas lisse
// la présentation dans les deux cas.
const hasRaf = typeof requestAnimationFrame === 'function';

let machine = null;
let renderer = null;
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
  let delta = now - last;
  last = now;
  if (delta > 250) delta = 250; // garde-fou : pas de rattrapage lunaire
  acc += delta;
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
      machine.onTick((mach) => {
        if (!renderer) return;
        const t = performance.now();
        renderer.draw(mach.ppu.screen);
        profiler.recordDraw(performance.now() - t);
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

// Métriques renvoyées ~5×/s : le main les stocke, l'overlay les lit.
setInterval(() => {
  const stats = profiler.stats();
  if (stats) self.postMessage({ type: 'metrics', stats });
}, 200);
