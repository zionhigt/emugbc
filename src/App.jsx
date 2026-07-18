import React from 'react';

import AppRouter from './router';
import ThemeSync from './components/ThemeSync';

class App extends React.Component {
  render() {
    return (
      <>
        {/* pose les variables de coque sur <html> — n'affiche rien */}
        <ThemeSync />
        <AppRouter />
      </>
    );
  }
}

export default App;
