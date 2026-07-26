import React from 'react';

import './DebugOverlay.css';

// Budget d'une trame DMG : ~16,74 ms (59,7275 fps).
const BUDGET_MS = 1000 / 59.7275;

// Overlay de métriques À L'ÉCRAN (pas de devtools). Il lit le Profiler dans sa
// PROPRE boucle requestAnimationFrame, throttlée à ~5 fois/s, pour ne jamais
// janker lui-même : seul cet overlay se re-rend, jamais l'émulateur.
// Un tap dessus le replie en pastille.
export default class DebugOverlay extends React.Component {
  state = { open: true, stats: null };

  _raf = null;
  _last = 0;

  componentDidMount() {
    this._raf = requestAnimationFrame(this.loop);
  }

  componentWillUnmount() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  loop = (now) => {
    // ~5 rafraîchissements/s : assez pour voir bouger, trop peu pour coûter.
    if (this.props.profiler && now - this._last > 200) {
      this._last = now;
      const stats = this.props.profiler.stats();
      if (stats) this.setState({ stats });
    }
    this._raf = requestAnimationFrame(this.loop);
  };

  toggle = () => this.setState((s) => ({ open: !s.open }));

  // Le verdict : quand ça drope, dire POURQUOI d'un coup d'œil.
  verdict(s) {
    if (!s || s.fps >= 55) return null;
    if (s.totalMax > BUDGET_MS) {
      return s.emu >= s.draw ? 'lourd → ÉMULATION' : 'lourd → DESSIN';
    }
    return 'léger mais lent → ORDONNANCEMENT';
  }

  render() {
    const { open, stats } = this.state;

    if (!open) {
      return (
        <button className="dbg dbg--pill" onClick={this.toggle} aria-label="afficher les métriques">
          ⚙ fps
        </button>
      );
    }

    const val = (k, suffix = '') => (stats ? `${stats[k]}${suffix}` : '—');
    const dropping = stats && stats.fps < 55;
    const heavy = stats && stats.total > BUDGET_MS;
    const verdict = this.verdict(stats);

    return (
      <div className="dbg" onClick={this.toggle} role="status" aria-live="off" title="tap = replier">
        <div className={`dbg__row dbg__fps${dropping ? ' dbg__bad' : ''}`}>
          <b>{val('fps')}</b> fps <span className="dbg__budget">/ 60</span>
          {this.props.mode && <span className="dbg__min">{this.props.mode}</span>}
        </div>
        <div className="dbg__row">
          trame <span className={heavy ? 'dbg__bad' : ''}>{val('total', ' ms')}</span>
          <span className="dbg__budget"> / {BUDGET_MS.toFixed(1)}</span>
        </div>
        <div className="dbg__row">
          pire <span className={stats && stats.totalMax > BUDGET_MS ? 'dbg__bad' : ''}>{val('totalMax', ' ms')}</span>
        </div>
        <div className="dbg__row dbg__split">
          ému <b>{val('emu')}</b> · draw <b>{val('draw')}</b>
        </div>
        {verdict && <div className="dbg__verdict">{verdict}</div>}
      </div>
    );
  }
}
