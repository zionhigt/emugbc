import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import Layout from '../components/Layout';
import Home from '../pages/Home';
import Emulator from '../pages/Emulator';

class AppRouter extends React.Component {
  render() {
    return (
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/emulator" element={<Emulator />} />
          </Route>
        </Routes>
      </BrowserRouter>
    );
  }
}

export default AppRouter;
