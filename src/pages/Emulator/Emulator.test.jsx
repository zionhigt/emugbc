import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect } from 'vitest';

import emulatorReducer from '../../store/slices/emulatorSlice';
import Emulator from './index';

const renderWithStore = () => {
  const store = configureStore({
    reducer: { emulator: emulatorReducer },
  });
  const utils = render(
    <Provider store={store}>
      <Emulator />
    </Provider>
  );
  return { store, ...utils };
};

describe('Emulator', () => {
  it('propose un sélecteur de cartouche filtré sur .gb', () => {
    renderWithStore();
    const input = screen.getByLabelText(/cartouche/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', '.gb');
  });

  it("n'affiche aucune cartouche chargée au départ", () => {
    renderWithStore();
    expect(screen.queryByText(/cartouche chargée/i)).not.toBeInTheDocument();
  });

  it('choisir un fichier .gb instancie la cartouche et publie ses métadonnées', async () => {
    const { store } = renderWithStore();
    const bytes = new Uint8Array(0x8000); // une ROM 32 Ko (vide, peu importe ici)
    const file = new File([bytes], 'test.gb');

    const input = screen.getByLabelText(/cartouche/i);
    fireEvent.change(input, { target: { files: [file] } });

    // le handler est async (arrayBuffer) : on attend l'affichage
    expect(await screen.findByText(/test\.gb/)).toBeInTheDocument();
    expect(store.getState().emulator.cartridge).toEqual({
      fileName: 'test.gb',
      size: 0x8000,
    });
  });
});
