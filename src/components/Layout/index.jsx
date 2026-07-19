import React from 'react';
import { Outlet } from 'react-router-dom';

// Coquille minimale : l'application n'a qu'une seule page, l'émulateur.
// Pas de navigation — il n'y a nulle part où aller.
class Layout extends React.Component {
  render() {
    return (
      <main>
        <Outlet />
      </main>
    );
  }
}

export default Layout;
