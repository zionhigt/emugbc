import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import emulatorReducer from '../../store/slices/emulatorSlice';
import settingsReducer from '../../store/slices/settingsSlice';
import Emulator from './index';
import { MachineBuilder } from '../../emulator/core/index.js';
import AudioSampler from '../../components/Audio/AudioSampler';
import { CGB, AUTO } from '../../emulator/core/models';

/**
 * LOT F DU JALON DOUBLE VITESSE — LE RÉGIME CÔTÉ FRONT.
 *
 * Deux choses, et la seconde n'était pas au programme.
 *
 * 1. **Le régime s'affiche dans l'overlay.** Il ne se déduit d'aucun autre
 *    chiffre : les fps ne bougent pas quand un jeu double son horloge, et c'est
 *    précisément ce qu'on veut vérifier d'un coup d'œil. Il n'apparaît QUE
 *    doublé — « 1x » affiché en permanence serait du bruit.
 *
 * 2. **Le son se rééchantillonne sur l'heure du MONDE.** Trouvé en câblant le
 *    reste : `AudioSampler` convertit des cycles machine en 44 100 Hz avec une
 *    constante, et on lui passait `totalCycles`, l'horloge du processeur. En
 *    double régime il aurait produit deux fois trop d'échantillons — un la à
 *    880 Hz, et un tampon qui déborde. Ce lot-là n'est pas cosmétique.
 */

let machineFactice;

vi.mock('../../emulator/core/index.js', () => ({
  MachineBuilder: vi.fn(({ model } = {}) => {
    machineFactice = {
      model: model === AUTO ? CGB : model,
      doubleSpeed: false,
      totalCycles: 0,
      systemCycles: 0,
      apu: {},
      ppu: { screen: new Uint16Array(160 * 144) },
      plugCartridge() {},
      onTick(cb) { this._tick = cb; },
      subscribeCycleUpdate(cb) { this._cycle = cb; },
      start() {},
      joypad: { onPress() {}, onRelease() {} },
    };
    return machineFactice;
  }),
}));

// Le rééchantillonneur est construit dans la page, pas injecté : on l'espionne
// au module pour lire la date qu'il reçoit.
const datesRecues = [];
vi.mock('../../components/Audio/AudioSampler', () => ({
  SAMPLE_RATE: 44100,
  default: vi.fn(() => ({
    advance(apu, uptoCycle) { datesRecues.push(uptoCycle); },
    drain() { return { left: new Float32Array(0), right: new Float32Array(0) }; },
  })),
}));

const renderWithStore = (settings = {}) => {
  const store = configureStore({
    reducer: { emulator: emulatorReducer, settings: settingsReducer },
    preloadedState: {
      settings: { shell: 'teal', debug: true, model: AUTO, ...settings },
    },
  });
  return render(
    <Provider store={store}>
      <Emulator />
    </Provider>,
  );
};

const chargerCartouche = async () => {
  const file = new File([new Uint8Array(0x8000)], 'jeu.gbc');
  fireEvent.change(screen.getByLabelText(/cartouche \(/i), { target: { files: [file] } });
  await waitFor(() => expect(MachineBuilder).toHaveBeenCalled());
};

/** Une trame : c'est là que la page relit le régime de la machine. */
const trame = () => machineFactice._tick(machineFactice);

beforeEach(() => {
  MachineBuilder.mockClear();
  AudioSampler.mockClear();
  datesRecues.length = 0;
});

describe('le régime d\'horloge dans l\'overlay', () => {
  it('ne s\'affiche pas tant qu\'on est en vitesse simple', async () => {
    renderWithStore();
    await chargerCartouche();
    trame();

    expect(screen.queryByText('2x'), 'un « 1x » permanent ne dirait rien à personne').toBeNull();
  });

  it('affiche « 2x » dès que la machine a basculé', async () => {
    renderWithStore();
    await chargerCartouche();
    trame();

    machineFactice.doubleSpeed = true;
    trame();

    await waitFor(() => expect(screen.getByText('2x')).toBeInTheDocument());
  });

  it('et il disparaît au retour en vitesse simple', async () => {
    renderWithStore();
    await chargerCartouche();
    machineFactice.doubleSpeed = true;
    trame();
    await waitFor(() => expect(screen.getByText('2x')).toBeInTheDocument());

    machineFactice.doubleSpeed = false;
    trame();

    await waitFor(() => expect(screen.queryByText('2x')).toBeNull());
  });

  it('il vit à côté du modèle, pas à sa place', async () => {
    renderWithStore();
    await chargerCartouche();
    machineFactice.doubleSpeed = true;
    trame();

    await waitFor(() => expect(screen.getByText('2x')).toBeInTheDocument());
    expect(screen.getByText('CGB'), 'le modèle reste affiché').toBeInTheDocument();
  });
});

describe('le son suit l\'heure du monde', () => {
  it('le rééchantillonneur reçoit systemCycles et non totalCycles', async () => {
    renderWithStore();
    await chargerCartouche();

    // Une machine en double régime : le processeur est deux fois plus loin que
    // le monde. Les deux nombres diffèrent, donc le test peut trancher.
    machineFactice.totalCycles = 2000;
    machineFactice.systemCycles = 1000;
    machineFactice._cycle(machineFactice);

    expect(datesRecues.at(-1), 'sinon la hauteur du son double avec l\'horloge').toBe(1000);
  });
});
