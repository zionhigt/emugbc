import React from 'react';
import { connect } from 'react-redux';

import Console from '../../components/Console';
import Canvas from '../../components/Canvas';
import buildCartridge from '../../emulator/core/cartridge/Cartridge';
import { cartridgeLoaded } from '../../store/slices/emulatorSlice';
import { shellChanged, debugToggled, modelChanged } from '../../store/slices/settingsSlice';
import { SHELLS, SHELL_KEYS } from '../../theme/shells';
import { DMG, CGB, AUTO } from '../../emulator/core/models';

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

// Les trois choix de modèle, dans l'ordre où on les propose. `auto` d'abord :
// c'est le comportement d'une vraie console, et le défaut.
const MODELES = [
  [AUTO, 'Auto', 'suit la cartouche'],
  [DMG, 'DMG', 'noir et blanc'],
  [CGB, 'CGB', 'couleur'],
];

// Période d'une trame Game Boy (59,7275 Hz). Le cadencement vit au FRONT : rAF
// se cale sur l'écran (60/90/120 Hz), et un accumulateur ramène l'émulation à
// CETTE fréquence, quel que soit le taux de rafraîchissement de l'écran.
const FRAME_MS = 1000 / 59.7275;
// Retard rattrapable au plus 2 trames : au-delà, on abandonne le temps perdu
// plutôt que de fast-forwarder une rafale de trames (glitch visible à l'appui).
const MAX_CATCHUP = 2 * FRAME_MS;

// Délai laissé au worker pour dire bonjour. Il ne fait qu'évaluer son module :
// une seconde est déjà large, même sur un téléphone tiède. Au-delà, on considère
// qu'il ne se chargera pas et on part sur le repli — mieux vaut un repli tout de
// suite qu'un écran noir muet.
const WORKER_HELLO_MS = 1000;

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
  // `model` : le modèle RÉSOLU de la partie en cours ('dmg' ou 'cgb'), à ne pas
  // confondre avec la préférence du store, qui peut valoir 'auto'. Il vient de
  // la machine — donc du worker quand elle y tourne.
  state = { dockOpen: false, tab: 'cartouche', model: null };

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

  // Attend le « je suis vivant » du worker. Construire un Worker ne lève RIEN de
  // synchrone quand son script ne se charge pas — 404 sur un morceau au hash
  // périmé (voir src/pwa.js), CSP, module refusé : la promesse ne se résout
  // simplement jamais. D'où l'écoute de `error` ET le délai de garde.
  waitForWorker = (worker) =>
    new Promise((resolve, reject) => {
      const abandon = (raison) => {
        clearTimeout(timer);
        worker.removeEventListener('message', onHello);
        worker.removeEventListener('error', onError);
        reject(new Error(raison));
      };
      const onHello = ({ data }) => {
        if (!data || data.type !== 'ready') return;
        clearTimeout(timer);
        worker.removeEventListener('message', onHello);
        worker.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => abandon('worker-error');
      const timer = setTimeout(() => abandon('worker-timeout'), WORKER_HELLO_MS);
      worker.addEventListener('message', onHello);
      worker.addEventListener('error', onError);
    });

  // CHEMIN OPTIMAL : émulation + rendu dans un worker (OffscreenCanvas). Le
  // thread principal ne fait que transmettre les touches → il ne peut plus
  // retarder l'émulation ni le rendu. Un profiler DISTANT reçoit les métriques.
  //
  // ORDRE CRITIQUE : le canvas n'est détaché qu'APRÈS le bonjour du worker.
  // `transferControlToOffscreen()` est irréversible — un canvas transféré ne
  // rend plus de contexte 2D, donc le repli main-thread ne peut plus rien y
  // dessiner. Tant qu'on n'est pas sûr du worker, on ne touche pas au canvas.
  startWorker = async (canvasEl, bytes) => {
    const worker = new Worker(new URL('./emulator.worker.js', import.meta.url), { type: 'module' });
    try {
      await this.waitForWorker(worker);
    } catch (e) {
      worker.terminate(); // le canvas est intact : l'appelant peut se replier
      throw e;
    }

    this.worker = worker;
    this.profiler = { _stats: null, stats() { return this._stats; } };
    worker.onmessage = ({ data }) => {
      if (data.type === 'metrics') this.profiler._stats = data.stats;
      // Le modèle RÉSOLU : en 'auto', seule la machine sait ce qu'elle est
      // devenue, et elle est de l'autre côté du postMessage.
      else if (data.type === 'model') this.setState({ model: data.model });
      else if (data.type === 'audio' && this.audioOutput) this.audioOutput.push(data.left, data.right);
    };
    // Une panne APRÈS le bonjour ne peut plus rien sauver (le canvas est parti),
    // mais elle doit au moins se voir dans l'overlay au lieu d'un écran noir muet.
    worker.onerror = () => { this._workerReason = 'worker-crash'; };

    const offscreen = canvasEl.transferControlToOffscreen();
    worker.postMessage({ type: 'canvas', canvas: offscreen }, [offscreen]);
    const buf = bytes.buffer; // transféré (bytes est détaché ensuite, on n'en a plus besoin)
    worker.postMessage({ type: 'load', bytes: buf, model: this.props.model }, [buf]);

    // Le son EN DERNIER, et jamais bloquant : le worker n'a pas d'AudioContext
    // (hors d'un contexte Window), c'est nous qui jouons ce qu'il calcule. Placé
    // plus haut, un AudioContext qui refuse de naître emportait avec lui la
    // partie entière, canvas déjà détaché.
    this.audioOutput = new AudioOutput();
    this.audioOutput.start(); // le choix du fichier .gb EST le geste utilisateur
  };

  // REPLI : émulation + rendu sur le thread principal (OffscreenCanvas absent).
  startMainThread = (canvasEl, bytes) => {
    const Cartridge = buildCartridge();
    this.cartridge = new Cartridge(bytes);
    const renderer = canvasEl ? new CanvasRenderer(canvasEl) : null;
    this.profiler = new Profiler();
    this.machine = MachineBuilder({ model: this.props.model });
    this.machine.plugCartridge(this.cartridge);
    this.setState({ model: this.machine.model });
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
            <span className="emu-cart__title">Cartouche (.gb/.gbc)</span>
            <span className="emu-cart__game">
              {/* l'extension est retirée : le nom complet vit dans le statut */}
              {cartridge ? cartridge.fileName.replace(/\.gbc?$/i, '') : 'INSÉRER'}
            </span>
          </span>
          <input
            className="emu-cart__input"
            type="file"
            accept=".gb,.gbc"
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
    const { shell, shellChanged, debug, debugToggled, model, modelChanged } = this.props;
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
          <legend className="emu-options__legend">Modèle de console</legend>
          <div className="emu-models">
            {MODELES.map(([cle, libelle, aide]) => (
              <button
                key={cle}
                type="button"
                aria-pressed={model === cle}
                title={aide}
                className={`emu-models__choice${model === cle ? ' emu-models__choice--active' : ''}`}
                onClick={() => modelChanged(cle)}
              >
                {libelle}
              </button>
            ))}
          </div>
          <p className="emu-options__current">
            {MODELES.find(([cle]) => cle === model)?.[2]} — prend effet à la prochaine cartouche
          </p>
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
        await this.startWorker(canvasEl, bytes);
      } catch (e) {
        // Worker refusé malgré la détection (script introuvable, CSP, module) :
        // repli. Le canvas n'a pas été détaché → le main-thread peut y dessiner.
        this._workerReason = e.message || 'error';
        this.teardown();
        this.startMainThread(canvasEl, bytes);
      }
    } else {
      this.startMainThread(canvasEl, bytes);
    }

    this.props.cartridgeLoaded({ fileName: file.name, size });
    this.setState({ dockOpen: false }); // cartouche insérée, le volet se referme

    // Le sélecteur est remis à zéro : sans ça, re-choisir LE MÊME fichier
    // n'émet aucun `change` (la valeur n'a pas bougé), et la seule façon de
    // relancer une partie qui a mal démarré est de recharger la page.
    event.target.value = '';
  };

  render() {
    return (
      <div className="emu-page">
        {this.props.debug && (
          <DebugOverlay
            profiler={this.profiler}
            mode={this.worker ? 'WK' : `MT ${this._workerReason || ''}`}
            model={this.state.model}
          />
        )}
        <header className="emu-page__header">
          <h1 className="emu-page__title" aria-label="emugbc">
            {this.renderLogo()}
          </h1>
          <p className="emu-page__tagline">console faite main · certifiée Blargg 11/11</p>
        </header>

        <main className="emu-page__stage">
          <Console onPress={this.pressButton} onRelease={this.releaseButton} debug={this.props.debug}>
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
  model: state.settings.model,
});

const mapDispatchToProps = {
  cartridgeLoaded,
  shellChanged,
  debugToggled,
  modelChanged,
};

export default connect(mapStateToProps, mapDispatchToProps)(Emulator);
