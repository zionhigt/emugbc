import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Layout from '../components/Layout';
import Home from '../pages/Home';
import Emulator from '../pages/Emulator';

class AppRouter extends React.Component {
  render() {
    return (
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route element={<Layout />}>
            {/* la racine du site GitHub Pages ouvre directement l'émulateur */}
            <Route path="/" element={<Navigate to="/emulator" replace />} />
            <Route path="/home" element={<Home />} />
            <Route path="/emulator" element={<Emulator />} />
            {/* toute URL inconnue retombe sur l'émulateur (avec le 404.html de Pages) */}
            <Route path="*" element={<Navigate to="/emulator" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    );
  }
}

export default AppRouter;
