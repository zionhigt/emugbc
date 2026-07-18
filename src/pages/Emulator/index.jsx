import React from 'react';
import { connect } from 'react-redux';

import Console from '../../components/Console';
import Canvas from '../../components/Canvas';
import buildCartridge from '../../emulator/core/cartridge/Cartridge';
import { cartridgeLoaded } from '../../store/slices/emulatorSlice';
import { shellChanged } from '../../store/slices/settingsSlice';
import { SHELLS, SHELL_KEYS } from '../../theme/shells';

import { MachineBuilder } from '../../emulator/core/index.js';

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

// FileReader plutôt que file.arrayBuffer() : même résultat, mais compatible
// avec tous les environnements (jsdom des tests compris)
const readBytes = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
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
  state = { screen: null, dockOpen: false, tab: 'cartouche' };

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
  }

  // le point d'entrée unique vers la manette : clavier ET boutons de coque y
  // passent. Inerte tant qu'aucune cartouche n'est insérée (this.machine créé
  // au chargement du .gb).
  pressButton = (gb) => {
    if (this.machine) this.machine.joypad.onPress(gb);
  };

  releaseButton = (gb) => {
    if (this.machine) this.machine.joypad.onRelease(gb);
  };

  handleKeyDown = (event) => {
    const gb = KEYMAP[event.key.toLowerCase()];
    if (!gb || !this.machine) return;
    event.preventDefault(); // pas de scroll sur Espace, pas de submit sur Entrée
    this.pressButton(gb);
  };

  handleKeyUp = (event) => {
    const gb = KEYMAP[event.key.toLowerCase()];
    if (!gb || !this.machine) return;
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
    const { shell, shellChanged } = this.props;
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

    // l'instance vit sur le composant, pas dans le store (non sérialisable)
    const Cartridge = buildCartridge();
    this.cartridge = new Cartridge(bytes);
    this.machine = MachineBuilder();
    this.machine.plugCartridge(this.cartridge);
    this.machine.onTick(function(machine) {
      this.setState({ screen: machine.ppu.screen });
    }.bind(this));
    this.machine.start();

    this.props.cartridgeLoaded({ fileName: file.name, size: bytes.length });
    this.setState({ dockOpen: false }); // cartouche insérée, le volet se referme
  };

  render() {
    return (
      <div className="emu-page">
        <header className="emu-page__header">
          <h1 className="emu-page__title" aria-label="emugbc">
            {this.renderLogo()}
          </h1>
          <p className="emu-page__tagline">console faite main · certifiée Blargg 11/11</p>
        </header>

        <main className="emu-page__stage">
          <Console onPress={this.pressButton} onRelease={this.releaseButton}>
            <Canvas screen={this.state.screen} />
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
});

const mapDispatchToProps = {
  cartridgeLoaded,
  shellChanged,
};

export default connect(mapStateToProps, mapDispatchToProps)(Emulator);
