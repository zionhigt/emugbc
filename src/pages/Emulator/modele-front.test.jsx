import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import emulatorReducer from '../../store/slices/emulatorSlice';
import settingsReducer, { modelChanged } from '../../store/slices/settingsSlice';
import Emulator from './index';
import { MachineBuilder } from '../../emulator/core/index.js';
import { DMG, CGB, AUTO } from '../../emulator/core/models';

/**
 * LOT F — LA BASCULE DMG/CGB CÔTÉ FRONT.
 *
 * Tout le cœur CGB était atteignable par les tests, et par eux seuls : le worker
 * construisait sa machine sans préférence, donc TOUJOURS en DMG. Un jeu couleur
 * inséré dans la page tournait en noir et blanc, sans que rien ne le dise.
 *
 * Le défaut retenu est `auto` — le comportement d'une vraie console : c'est la
 * CARTOUCHE qui dit ce qu'elle sait faire, et le boîtier suit. Les deux autres
 * valeurs restent là pour forcer la main, ce qui est exactement ce dont on a
 * besoin pour comparer un rendu DMG et un rendu CGB du même jeu.
 */

// Une machine factice : on ne teste ici que le CÂBLAGE du modèle, pas l'émulation.
vi.mock('../../emulator/core/index.js', () => ({
  MachineBuilder: vi.fn(({ model } = {}) => ({
    // `model` (ce qu'on EST) vs la préférence (ce qu'on a DEMANDÉ) : 'auto' se
    // résout à l'insertion de la cartouche. La factice tranche en CGB, de quoi
    // vérifier que l'overlay affiche le modèle RÉSOLU et non le réglage.
    model: model === AUTO ? CGB : model,
    plugCartridge() {},
    onTick() {},
    subscribeCycleUpdate() {},
    start() {},
    joypad: { onPress() {}, onRelease() {} },
  })),
}));

const renderWithStore = (settings = {}) => {
  const store = configureStore({
    reducer: { emulator: emulatorReducer, settings: settingsReducer },
    preloadedState: {
      settings: { shell: 'teal', debug: false, model: AUTO, ...settings },
    },
  });
  const utils = render(
    <Provider store={store}>
      <Emulator />
    </Provider>,
  );
  return { store, ...utils };
};

const ouvrirOptions = () => {
  fireEvent.click(screen.getByRole('tab', { name: /options/i }));
  // Les trois choix sont cherchés DANS leur groupe : une des coques s'appelle
  // « DMG » elle aussi, et une recherche à plat trouverait les deux.
  return within(screen.getByRole('group', { name: /modèle de console/i }));
};

const chargerCartouche = async (nom = 'jeu.gbc') => {
  const file = new File([new Uint8Array(0x8000)], nom);
  const input = screen.getByLabelText(/cartouche \(/i);
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(MachineBuilder).toHaveBeenCalled());
};

beforeEach(() => {
  MachineBuilder.mockClear();
});

describe('le réglage de modèle', () => {
  it('propose Auto, DMG et CGB, et démarre sur Auto', () => {
    renderWithStore();
    const options = ouvrirOptions();

    expect(options.getByRole('button', { name: /auto/i })).toHaveAttribute('aria-pressed', 'true');
    expect(options.getByRole('button', { name: /dmg/i })).toHaveAttribute('aria-pressed', 'false');
    expect(options.getByRole('button', { name: /cgb/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('choisir un modèle le publie dans le store', () => {
    const { store } = renderWithStore();
    const options = ouvrirOptions();
    fireEvent.click(options.getByRole('button', { name: /cgb/i }));

    expect(store.getState().settings.model).toBe(CGB);
  });

  it('le réducteur refuse une valeur inconnue', () => {
    const store = configureStore({ reducer: { settings: settingsReducer } });
    const avant = store.getState().settings.model;
    store.dispatch(modelChanged('super-game-boy'));

    expect(store.getState().settings.model).toBe(avant);
  });

  it('le réglage est persisté, comme la coque et le débogage', () => {
    const { store } = renderWithStore();
    store.dispatch(modelChanged(DMG));

    expect(window.localStorage.getItem('emugbc.model')).toBe(DMG);
  });
});

describe('le modèle choisi arrive jusqu\'à la machine', () => {
  it('la préférence est passée à MachineBuilder', async () => {
    renderWithStore({ model: DMG });
    await chargerCartouche();

    expect(MachineBuilder, 'sans ça, tout tourne en DMG quoi qu\'on choisisse')
      .toHaveBeenCalledWith({ model: DMG });
  });

  it('« auto » est transmis tel quel : c\'est la machine qui tranche', async () => {
    renderWithStore({ model: AUTO });
    await chargerCartouche();

    expect(MachineBuilder).toHaveBeenCalledWith({ model: AUTO });
  });
});

describe('le sélecteur de cartouche', () => {
  it('accepte aussi les .gbc — sans quoi un jeu couleur ne peut pas être choisi', () => {
    renderWithStore();
    expect(screen.getByLabelText(/cartouche \(/i)).toHaveAttribute('accept', '.gb,.gbc');
  });

  it('l\'extension .gbc est retirée du nom affiché, comme .gb', async () => {
    renderWithStore();
    await chargerCartouche('zelda.gbc');

    expect(screen.getByText('zelda')).toBeInTheDocument();
  });
});

describe('l\'overlay de débogage', () => {
  it('affiche le modèle RÉSOLU à côté du mode d\'exécution', async () => {
    renderWithStore({ debug: true, model: AUTO });
    await chargerCartouche();

    // La machine factice résout 'auto' en CGB : c'est bien le modèle actif qui
    // s'affiche, pas le réglage.
    await waitFor(() => expect(screen.getByText('CGB')).toBeInTheDocument());
  });
});
