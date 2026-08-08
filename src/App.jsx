import React from 'react';

import AppRouter from './router';
import ThemeSync from './components/ThemeSync';
import ViewportSync from './components/ViewportSync';

class App extends React.Component {
  render() {
    return (
      <>
        {/* pose --vvh (hauteur réelle du viewport) sur <html> — n'affiche rien */}
        <ViewportSync />
        {/* pose les variables de coque sur <html> — n'affiche rien */}
        <ThemeSync />
        <AppRouter />
      </>
    );
  }
}

export default App;
