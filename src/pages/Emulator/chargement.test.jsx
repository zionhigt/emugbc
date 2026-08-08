import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import emulatorReducer from '../../store/slices/emulatorSlice';
import settingsReducer from '../../store/slices/settingsSlice';
import Emulator from './index';

/**
 * L'INSERTION DE LA CARTOUCHE, QUAND ELLE SE PASSE MAL.
 *
 * Le chemin nominal est déjà couvert par Emulator.test.jsx. Ici on tient les
 * cas qui ont coûté un « il faut charger le fichier deux fois » :
 *
 *   - un worker dont le SCRIPT NE SE CHARGE PAS. `new Worker()` ne lève rien de
 *     synchrone dans ce cas — la panne arrive plus tard, ou jamais. C'est
 *     exactement ce qui se produit après une bascule de service worker, quand
 *     l'URL du morceau porte un hash périmé (voir src/pwa.js).
 *   - le canvas, qu'un transfert vers le worker DÉTRUIT définitivement pour le
 *     thread principal : le détacher avant d'être sûr du worker, c'est se
 *     priver du repli.
 *   - le sélecteur de fichier, qui n'émet pas de `change` si on rechoisit le
 *     même fichier — donc pas de seconde chance sans recharger la page.
 */

// La machine est remplacée : ce fichier teste le CÂBLAGE du chargement, pas
// l'émulation.
vi.mock('../../emulator/core/index.js', () => ({
  MachineBuilder: vi.fn(() => ({
    plugCartridge() {},
    onTick() {},
    subscribeCycleUpdate() {},
    start() {},
    joypad: { onPress() {}, onRelease() {} },
  })),
}));

// jsdom n'a ni Worker ni OffscreenCanvas : on les pose nous-mêmes, pour que le
// composant emprunte le CHEMIN WORKER et non son repli.
class FakeWorker extends EventTarget {
  constructor() {
    super();
    this.posted = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
  }
  postMessage(message) { this.posted.push(message); }
  terminate() { this.terminated = true; }
  /** Le « je suis vivant » que le vrai worker envoie une fois son module évalué. */
  direBonjour() { this.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } })); }
  /** Le script n'a pas pu être chargé (404, CSP…). */
  echouer() { this.dispatchEvent(new Event('error')); }
}
FakeWorker.instances = [];

const monterCanvas = () => {
  const proto = window.HTMLCanvasElement.prototype;
  proto.transferControlToOffscreen = function () {
    if (this._transfere) throw new DOMException('already transferred', 'InvalidStateError');
    this._transfere = true;
    return { fake: 'offscreen' };
  };
  // getContext d'un canvas transféré lève, comme dans un vrai navigateur : c'est
  // ce qui rend le repli impossible si on a détaché trop tôt.
  const getContext = proto.getContext;
  proto.getContext = function (...args) {
    if (this._transfere) throw new DOMException('already transferred', 'InvalidStateError');
    return getContext ? getContext.apply(this, args) : null;
  };
};

const rendre = () => {
  const store = configureStore({
    reducer: { emulator: emulatorReducer, settings: settingsReducer },
  });
  return { store, ...render(<Provider store={store}><Emulator /></Provider>) };
};

const inserer = (nom = 'test.gb') => {
  const file = new File([new Uint8Array(0x8000)], nom);
  const input = screen.getByLabelText(/cartouche \(\.gb\/\.gbc\)/i);
  fireEvent.change(input, { target: { files: [file] } });
  return input;
};

/** Le worker n'est construit qu'après la lecture asynchrone du fichier. */
const attendreWorker = () => waitFor(() => expect(FakeWorker.instances.length).toBeGreaterThan(0));

describe("insertion d'une cartouche", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    monterCanvas();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.HTMLCanvasElement.prototype.transferControlToOffscreen;
  });

  it("ne détache le canvas qu'une fois le worker vivant", async () => {
    rendre();
    inserer();
    await attendreWorker();
    const worker = FakeWorker.instances[0];

    expect(worker.posted, "rien n'est envoyé avant le bonjour du worker").toEqual([]);
    const canvas = document.querySelector('canvas');
    expect(canvas._transfere, 'le canvas est encore intact').toBeFalsy();

    worker.direBonjour();

    await waitFor(() => expect(worker.posted.map((m) => m.type)).toEqual(['canvas', 'load']));
    expect(canvas._transfere, 'détaché seulement maintenant').toBe(true);
  });

  it('un worker dont le script ne se charge pas retombe sur le thread principal', async () => {
    rendre();
    inserer();
    await attendreWorker();
    const worker = FakeWorker.instances[0];

    worker.echouer(); // 404 sur le morceau : la panne n'est PAS synchrone

    await screen.findByText(/cartouche chargée/i);
    expect(worker.terminated, 'le worker mort est arrêté').toBe(true);
    const canvas = document.querySelector('canvas');
    expect(canvas._transfere, 'le canvas est resté dessinable pour le repli').toBeFalsy();
  });

  it('le worker muet finit par rendre la main au thread principal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      rendre();
      inserer();
      await attendreWorker();

      // aucun bonjour, aucune erreur : le cas le plus vicieux, celui qui laissait
      // un écran noir définitif.
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });

      await screen.findByText(/cartouche chargée/i);
      expect(FakeWorker.instances[0].terminated).toBe(true);
      expect(document.querySelector('canvas')._transfere).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('le sélecteur est vidé après coup : rechoisir le même fichier relance', async () => {
    rendre();
    const input = inserer();
    await attendreWorker();
    FakeWorker.instances[0].direBonjour();
    await screen.findByText(/cartouche chargée/i);

    // Sans cette remise à zéro, `change` ne repartirait pas sur le même fichier
    // et la seule issue serait de recharger la page.
    await waitFor(() => expect(input.value).toBe(''));
  });
});
