import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Layout from '../components/Layout';
import Emulator from '../pages/Emulator';

// Une seule page. La racine EST l'émulateur, et toute autre URL y retombe
// (avec le 404.html de GitHub Pages pour les accès directs).
class AppRouter extends React.Component {
  render() {
    return (
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Emulator />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    );
  }
}

export default AppRouter;
