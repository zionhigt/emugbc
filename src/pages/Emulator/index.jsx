import React from 'react';
import { connect } from 'react-redux';

import Console from '../../components/Console';
import Canvas from '../../components/Canvas';
import buildCartridge from '../../emulator/core/cartridge/Cartridge';
import { cartridgeLoaded } from '../../store/slices/emulatorSlice';
import { shellChanged, debugToggled } from '../../store/slices/settingsSlice';
import { SHELLS, SHELL_KEYS } from '../../theme/shells';

import { MachineBuilder } from '../../emulator/core/index.js';

import DebugOverlay from '../../components/DebugOverlay';
import Profiler from '../../components/DebugOverlay/Profiler';
import CanvasRenderer from '../../components/Canvas/CanvasRenderer';
import AudioOutput from '../../components/Audio/AudioOutput';
import AudioSampler from '../../components/Audio/AudioSampler';

import './Emulator.css';

// Mapping clavier (AZERTY) → boutons Game Boy. Lu via event.key (le caractère
// tapé), donc calé sur le clavier physique français.
const KEYMAP = {
  z: 'up',
  q: 'left',
  s: 'down',
  d: 'right',
  p: 'a',
  l: 'b',
  enter: 'start',
  ' ': 'select',
};

// Période d'une trame Game Boy (59,7275 Hz). Le cadencement vit au FRONT : rAF
// se cale sur l'écran (60/90/120 Hz), et un accumulateur ramène l'émulation à
// CETTE fréquence, quel que soit le taux de rafraîchissement de l'écran.
const FRAME_MS = 1000 / 59.7275;
// Retard rattrapable au plus 2 trames : au-delà, on abandonne le temps perdu
// plutôt que de fast-forwarder une rafale de trames (glitch visible à l'appui).
const MAX_CATCHUP = 2 * FRAME_MS;

// FileReader plutôt que file.arrayBuffer() : même résultat, mais compatible
// avec tous les environnements (jsdom des tests compris)
const readBytes = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader(); // Todo: Info caniuse
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });

class Emulator extends React.Component {
  // `screen` : le tampon de teintes que le Canvas peint. Le rendu se
  // rafraîchit à chaque changement d'identité de cet état.
  // `dockOpen` : le volet console (mobile) — replié au-dessus de l'écran,
  // il descend par le haut, comme la fente de la vraie console.
  // `tab` : l'onglet visible dans le volet. « cartouche » par défaut, c'est le
  // geste qu'on vient faire ici neuf fois sur dix.
  // plus de `screen` dans le state : la trame ne passe plus par React (repaint
  // impératif du canvas via canvasRef), donc rien à stocker ni à re-rendre.
  state = { dockOpen: false, tab: 'cartouche' };

  canvasRef = React.createRef();

  componentDidMount() {
    // l'immersion : tant que la console est à l'écran, le Layout s'efface
    // (la nav est masquée par CSS via cette classe, en mobile seulement)
    document.body.classList.add('emu-immersion');
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  componentWillUnmount() {
    document.body.classList.remove('emu-immersion');
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.teardown();
  }

  // Coupe la partie en cours : la boucle main-thread OU le worker.
  teardown = () => {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    if (this.audioOutput) { this.audioOutput.close(); this.audioOutput = null; }
    this.machine = null;
  };

  // CHEMIN OPTIMAL : émulation + rendu dans un worker (OffscreenCanvas). Le
  // thread principal ne fait que transmettre les touches → il ne peut plus
  // retarder l'émulation ni le rendu. Un profiler DISTANT reçoit les métriques.
  startWorker = (canvasEl, bytes) => {
    // Le worker D'ABORD : si sa construction échoue, le canvas n'est pas encore
    // détaché → l'appelant peut retomber proprement sur le main-thread. Le
    // transfert, lui, ne détache le canvas que s'il réussit.
    this.worker = new Worker(new URL('./emulator.worker.js', import.meta.url), { type: 'module' });
    const offscreen = canvasEl.transferControlToOffscreen();
    this.profiler = { _stats: null, stats() { return this._stats; } };
    // Le worker n'a pas d'AudioContext (hors d'un contexte Window) : il calcule
    // les échantillons et nous les envoie, nous les jouons ici.
    this.audioOutput = new AudioOutput();
    this.audioOutput.start(); // le choix du fichier .gb EST le geste utilisateur
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'metrics') this.profiler._stats = data.stats;
      else if (data.type === 'audio') this.audioOutput.push(data.left, data.right);
    };
    this.worker.postMessage({ type: 'canvas', canvas: offscreen }, [offscreen]);
    const buf = bytes.buffer; // transféré (bytes est détaché ensuite, on n'en a plus besoin)
    this.worker.postMessage({ type: 'load', bytes: buf }, [buf]);
  };

  // REPLI : émulation + rendu sur le thread principal (OffscreenCanvas absent).
  startMainThread = (canvasEl, bytes) => {
    const Cartridge = buildCartridge();
    this.cartridge = new Cartridge(bytes);
    const renderer = canvasEl ? new CanvasRenderer(canvasEl) : null;
    this.profiler = new Profiler();
    this.machine = MachineBuilder();
    this.machine.plugCartridge(this.cartridge);
    this.audioOutput = new AudioOutput();
    this.audioOutput.start(); // le choix du fichier .gb EST le geste utilisateur
    const sampler = new AudioSampler();
    // À CHAQUE cycle, pas une fois par trame : apu.sample(cycle) partage son
    // curseur avec les lectures du CPU (NR52 avance le sweep du canal 1) —
    // l'interroger après coup, une fois la trame rejouée, lui redemanderait des
    // dates déjà dépassées (voir channel1.js, frequencyAt).
    this.machine.subscribeCycleUpdate((mach) => sampler.advance(mach.apu, mach.totalCycles));
    this.machine.onTick((mach) => {
      if (renderer) {
        const t = performance.now();
        renderer.draw(mach.ppu.screen);
        this.profiler.recordDraw(performance.now() - t);
      }
      const { left, right } = sampler.drain(); // un seul push par trame
      this.audioOutput.push(left, right);
    });
    this.startLoop();
  };

  // Boucle de trames AU FRONT : rAF cale sur l'écran ; l'accumulateur convertit
  // le temps réel écoulé en trames Game Boy à 59,73 Hz (indépendant du taux écran).
  // Idempotente : on annule toute boucle en cours avant d'en relancer une.
  startLoop = () => {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._acc = 0;
    this._last = performance.now();
    const loop = (now) => {
      const delta = now - this._last;
      this._last = now;
      this._acc += delta;
      // Anti-rattrapage express : après un accroc (compositeur occupé par un appui,
      // GC, onglet revenu), on ne fast-forward PAS une rafale de trames d'un coup —
      // ça se voit comme un bond/glitch. On plafonne le retard rattrapable à 2 trames ;
      // le temps perdu au-delà est abandonné (dérive infime, invisible).
      if (this._acc > MAX_CATCHUP) this._acc = MAX_CATCHUP;
      while (this._acc >= FRAME_MS) {
        this.profiler.tickStart();
        this.machine.handleTick({ detail: 'tick' }); // 1 trame GB (+ dessin via onTick)
        this.profiler.tickEnd();
        this._acc -= FRAME_MS;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  };

  // le point d'entrée unique vers la manette : clavier ET boutons de coque y
  // passent. Inerte tant qu'aucune cartouche n'est insérée (this.machine créé
  // au chargement du .gb).
  // Les touches passent au worker (postMessage) OU à la machine main-thread selon
  // le chemin actif. Inerte tant qu'aucune cartouche n'est chargée.
  pressButton = (gb) => {
    if (this.worker) this.worker.postMessage({ type: 'press', key: gb });
    else if (this.machine) this.machine.joypad.onPress(gb);
  };

  releaseButton = (gb) => {
    if (this.worker) this.worker.postMessage({ type: 'release', key: gb });
    else if (this.machine) this.machine.joypad.onRelease(gb);
  };

  handleKeyDown = (event) => {
    const gb = KEYMAP[event.key.toLowerCase()];
    if (!gb) return;
    event.preventDefault(); // pas de scroll sur Espace, pas de submit sur Entrée
    this.pressButton(gb);
  };

  handleKeyUp = (event) => {
    const gb = KEYMAP[event.key.toLowerCase()];
    if (!gb) return;
    event.preventDefault();
    this.releaseButton(gb);
  };

  toggleDock = () => {
    this.setState((s) => ({ dockOpen: !s.dockOpen }));
  };

  selectTab = (tab) => () => this.setState({ tab });

  // ── les onglets du volet ──

  renderTabs() {
    const onglets = [
      ['cartouche', 'Cartouche'],
      ['options', 'Options'],
    ];
    return (
      <div className="emu-tabs" role="tablist" aria-label="volet console">
        {onglets.map(([cle, libelle]) => (
          <button
            key={cle}
            type="button"
            role="tab"
            id={`emu-tab-${cle}`}
            aria-selected={this.state.tab === cle}
            aria-controls={`emu-panel-${cle}`}
            className={`emu-tabs__tab${this.state.tab === cle ? ' emu-tabs__tab--active' : ''}`}
            onClick={this.selectTab(cle)}
          >
            {libelle}
          </button>
        ))}
      </div>
    );
  }

  renderCartouche() {
    const { cartridge } = this.props;
    return (
      <div
        className="emu-panel"
        role="tabpanel"
        id="emu-panel-cartouche"
        aria-labelledby="emu-tab-cartouche"
      >
        <label className="emu-cart">
          <span className="emu-cart__ridges" aria-hidden="true"></span>
          <span className="emu-cart__label">
            <span className="emu-cart__title">Cartouche (.gb)</span>
            <span className="emu-cart__game">
              {/* l'extension est retirée : le nom complet vit dans le statut */}
              {cartridge ? cartridge.fileName.replace(/\.gb$/i, '') : 'INSÉRER'}
            </span>
          </span>
          <input
            className="emu-cart__input"
            type="file"
            accept=".gb"
            onChange={this.handleFileChange}
          />
        </label>

        {cartridge ? (
          <p className="emu-page__status">
            Cartouche chargée : {cartridge.fileName} ({cartridge.size} octets)
          </p>
        ) : (
          <p className="emu-page__hint">PRESS START</p>
        )}
      </div>
    );
  }

  renderOptions() {
    const { shell, shellChanged, debug, debugToggled } = this.props;
    return (
      <div
        className="emu-panel"
        role="tabpanel"
        id="emu-panel-options"
        aria-labelledby="emu-tab-options"
      >
        <fieldset className="emu-options__group">
          <legend className="emu-options__legend">Couleur de coque</legend>
          <div className="emu-shells">
            {SHELL_KEYS.map((cle) => (
              <button
                key={cle}
                type="button"
                aria-pressed={shell === cle}
                aria-label={SHELLS[cle].nom}
                title={SHELLS[cle].nom}
                className={`emu-shells__swatch${shell === cle ? ' emu-shells__swatch--active' : ''}`}
                style={{ '--swatch': SHELLS[cle].shell }}
                onClick={() => shellChanged(cle)}
              />
            ))}
          </div>
          <p className="emu-options__current">{SHELLS[shell].nom}</p>
        </fieldset>

        <fieldset className="emu-options__group">
          <legend className="emu-options__legend">Débogage</legend>
          <button
            type="button"
            role="switch"
            aria-checked={debug}
            className={`emu-toggle${debug ? ' emu-toggle--on' : ''}`}
            onClick={() => debugToggled()}
          >
            <span className="emu-toggle__track" aria-hidden="true">
              <span className="emu-toggle__thumb" />
            </span>
            Overlay de métriques (FPS)
          </button>
        </fieldset>
      </div>
    );
  }

  // l'enseigne EMUGBC — six lettres, six couleurs (via CSS nth-child)
  renderLogo() {
    return 'EMUGBC'.split('').map((lettre, i) => <span key={i}>{lettre}</span>);
  }

  handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const bytes = await readBytes(file);
    const size = bytes.length; // capturé AVANT un éventuel transfert du buffer

    this.teardown(); // coupe une partie précédente (worker ou boucle)

    // OffscreenCanvas dispo ? → worker (émulation+rendu hors thread principal).
    // Sinon → repli main-thread (Safari < 16.4, jsdom des tests).
    const canvasEl = this.canvasRef.current && this.canvasRef.current.getElement();
    const reason =
      typeof Worker === 'undefined' ? 'no-Worker'
      : !canvasEl ? 'no-canvas'
      : typeof canvasEl.transferControlToOffscreen !== 'function' ? 'no-offscreen'
      : 'ok';
    this._workerReason = reason; // diagnostic affiché dans l'overlay

    if (reason === 'ok') {
      try {
        this.startWorker(canvasEl, bytes);
      } catch (e) {
        // Worker refusé malgré la détection (CSP, module, transfert impossible) :
        // repli. Le canvas n'a pas été détaché → le main-thread peut y dessiner.
        this._workerReason = 'error';
        this.teardown();
        this.startMainThread(canvasEl, bytes);
      }
    } else {
      this.startMainThread(canvasEl, bytes);
    }

    this.props.cartridgeLoaded({ fileName: file.name, size });
    this.setState({ dockOpen: false }); // cartouche insérée, le volet se referme
  };

  render() {
    return (
      <div className="emu-page">
        {this.props.debug && (
          <DebugOverlay
            profiler={this.profiler}
            mode={this.worker ? 'WK' : `MT ${this._workerReason || ''}`}
          />
        )}
        <header className="emu-page__header">
          <h1 className="emu-page__title" aria-label="emugbc">
            {this.renderLogo()}
          </h1>
          <p className="emu-page__tagline">console faite main · certifiée Blargg 11/11</p>
        </header>

        <main className="emu-page__stage">
          <Console onPress={this.pressButton} onRelease={this.releaseButton}>
            <Canvas ref={this.canvasRef} />
          </Console>

          <aside
            className={`emu-page__dock${this.state.dockOpen ? ' emu-page__dock--open' : ''}`}
          >
            <button
              type="button"
              className="emu-page__dock-tab"
              onClick={this.toggleDock}
              aria-expanded={this.state.dockOpen}
            >
              CONSOLE {this.state.dockOpen ? '▲' : '▼'}
            </button>

            <div className="emu-page__title emu-page__dock-logo" aria-hidden="true">
              {this.renderLogo()}
            </div>

            {this.renderTabs()}
            {this.state.tab === 'cartouche' ? this.renderCartouche() : this.renderOptions()}
          </aside>
        </main>
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  cartridge: state.emulator.cartridge,
  shell: state.settings.shell,
  debug: state.settings.debug,
});

const mapDispatchToProps = {
  cartridgeLoaded,
  shellChanged,
  debugToggled,
};

export default connect(mapStateToProps, mapDispatchToProps)(Emulator);
