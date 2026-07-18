import React from 'react';
import { connect } from 'react-redux';

import { shellVariables, SHELLS, DEFAULT_SHELL, isShell } from '../../theme/shells';

// Le pont entre le store et le CSS : il pose les variables de thème sur <html>.
// Rien ne s'affiche ici — c'est ce qui permet à une couleur choisie dans l'onglet
// Options de teindre la page entière, y compris ce qui ne connaît pas Redux.
class ThemeSync extends React.Component {
  componentDidMount() {
    this.appliquer();
  }

  componentDidUpdate(prev) {
    if (prev.shell !== this.props.shell) this.appliquer();
  }

  appliquer() {
    const { shell } = this.props;
    const racine = document.documentElement;

    Object.entries(shellVariables(shell)).forEach(([nom, valeur]) => {
      racine.style.setProperty(nom, valeur);
    });

    // utile au diagnostic, et permet un sélecteur CSS si le besoin vient
    racine.dataset.shell = isShell(shell) ? shell : DEFAULT_SHELL;

    // la barre système de la PWA suit la coque
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', SHELLS[racine.dataset.shell].shell);
  }

  render() {
    return null;
  }
}

const mapStateToProps = (state) => ({
  shell: state.settings.shell,
});

export default connect(mapStateToProps)(ThemeSync);
