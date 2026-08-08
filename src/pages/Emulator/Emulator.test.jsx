import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect, vi } from 'vitest';

import emulatorReducer from '../../store/slices/emulatorSlice';
import settingsReducer from '../../store/slices/settingsSlice';
import Emulator from './index';
import { MachineBuilder } from '../../emulator/core/index.js';

// On remplace la vraie machine (qui lancerait un setInterval) par une machine
// factice dont le joypad espionne les appuis — pour tester le câblage clavier.
vi.mock('../../emulator/core/index.js', () => ({
  MachineBuilder: vi.fn(() => ({
    plugCartridge() {},
    onTick() {},
    subscribeCycleUpdate() {},
    start() {},
    joypad: {
      presses: [],
      releases: [],
      onPress(k) { this.presses.push(k); },
      onRelease(k) { this.releases.push(k); },
    },
  })),
}));

const renderWithStore = () => {
  const store = configureStore({
    reducer: { emulator: emulatorReducer, settings: settingsReducer },
  });
  const utils = render(
    <Provider store={store}>
      <Emulator />
    </Provider>
  );
  return { store, ...utils };
};

describe('Emulator', () => {
  // Porté au lot F : le filtre s'ouvre aux .gbc, sans quoi un jeu couleur ne
  // peut même pas être choisi dans le sélecteur de fichiers.
  it('propose un sélecteur de cartouche filtré sur .gb et .gbc', () => {
    renderWithStore();
    const input = screen.getByLabelText(/cartouche \(\.gb\/\.gbc\)/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', '.gb,.gbc');
  });

  it("n'affiche aucune cartouche chargée au départ", () => {
    renderWithStore();
    expect(screen.queryByText(/cartouche chargée/i)).not.toBeInTheDocument();
  });

  it('choisir un fichier .gb instancie la cartouche et publie ses métadonnées', async () => {
    const { store } = renderWithStore();
    const bytes = new Uint8Array(0x8000); // une ROM 32 Ko (vide, peu importe ici)
    const file = new File([bytes], 'test.gb');

    const input = screen.getByLabelText(/cartouche \(\.gb\/\.gbc\)/i);
    fireEvent.change(input, { target: { files: [file] } });

    // le handler est async (arrayBuffer) : on attend l'affichage
    expect(await screen.findByText(/test\.gb/)).toBeInTheDocument();
    expect(store.getState().emulator.cartridge).toEqual({
      fileName: 'test.gb',
      size: 0x8000,
    });
  });

  it('le clavier (AZERTY) pilote la manette une fois la cartouche chargée', async () => {
    renderWithStore();
    const file = new File([new Uint8Array(0x8000)], 'test.gb');
    fireEvent.change(screen.getByLabelText(/cartouche \(\.gb\/\.gbc\)/i), { target: { files: [file] } });
    await screen.findByText(/test\.gb/); // attend la création de la machine

    const { joypad } = MachineBuilder.mock.results.at(-1).value;
    fireEvent.keyDown(window, { key: 'z' });     // ZQSD → directions
    fireEvent.keyDown(window, { key: 'd' });
    fireEvent.keyDown(window, { key: 'Enter' });  // Start
    fireEvent.keyDown(window, { key: ' ' });      // Select
    fireEvent.keyUp(window, { key: 'z' });

    expect(joypad.presses, 'Z=haut, D=droite, Entrée=start, Espace=select').toEqual(
      ['up', 'right', 'start', 'select'],
    );
    expect(joypad.releases, 'relâcher Z = up').toEqual(['up']);
  });

  describe('le volet Console et ses onglets', () => {
    it('ouvre sur Cartouche : le sélecteur est là, pas les options', () => {
      renderWithStore();
      expect(screen.getByRole('tab', { name: /cartouche/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByLabelText(/cartouche \(\.gb\/\.gbc\)/i)).toBeInTheDocument();
      expect(screen.queryByText(/couleur de coque/i)).not.toBeInTheDocument();
    });

    it('Options remplace le panneau et propose les coques GBC', () => {
      renderWithStore();
      fireEvent.click(screen.getByRole('tab', { name: /options/i }));

      expect(screen.getByText(/couleur de coque/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/cartouche \(\.gb\/\.gbc\)/i)).not.toBeInTheDocument();

      // les 5 coques du lancement — l'Atomic Purple transparente est exclue
      expect(screen.getByRole('button', { name: /teal/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /berry/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /grape/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /kiwi/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /dandelion/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /atomic|transparent/i })).not.toBeInTheDocument();
    });

    it('Teal est la coque par défaut', () => {
      const { store } = renderWithStore();
      expect(store.getState().settings.shell, 'la couleur d\'origine ne bouge pas').toBe('teal');

      fireEvent.click(screen.getByRole('tab', { name: /options/i }));
      expect(screen.getByRole('button', { name: /teal/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('choisir une coque publie le réglage dans le store', () => {
      const { store } = renderWithStore();
      fireEvent.click(screen.getByRole('tab', { name: /options/i }));
      fireEvent.click(screen.getByRole('button', { name: /kiwi/i }));

      expect(store.getState().settings.shell).toBe('kiwi');
      expect(screen.getByRole('button', { name: /kiwi/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: /teal/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('revenir sur Cartouche ne perd pas la cartouche chargée', async () => {
      renderWithStore();
      const file = new File([new Uint8Array(0x8000)], 'test.gb');
      fireEvent.change(screen.getByLabelText(/cartouche \(\.gb\/\.gbc\)/i), { target: { files: [file] } });
      await screen.findByText(/test\.gb/);

      fireEvent.click(screen.getByRole('tab', { name: /options/i }));
      fireEvent.click(screen.getByRole('tab', { name: /cartouche/i }));

      expect(screen.getByText(/cartouche chargée/i)).toBeInTheDocument();
    });
  });

  it('une touche non mappée est ignorée, et le clavier est inerte sans cartouche', () => {
    renderWithStore();
    // aucune cartouche : pas de machine, le handler ne doit pas planter
    expect(() => fireEvent.keyDown(window, { key: 'z' })).not.toThrow();
    // touche hors mapping : ignorée
    expect(() => fireEvent.keyDown(window, { key: 'x' })).not.toThrow();
  });
});
