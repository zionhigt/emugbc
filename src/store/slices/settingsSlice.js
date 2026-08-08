import { createSlice } from '@reduxjs/toolkit';

import { DEFAULT_SHELL, isShell } from '../../theme/shells';
import { AUTO, isPreference } from '../../emulator/core/models';

const STORAGE_KEY = 'emugbc.shell';
const DEBUG_KEY = 'emugbc.debug';
const MODEL_KEY = 'emugbc.model';

// Le réglage survit au rechargement. On garde une valeur inconnue (ancienne clé,
// stockage bricolé à la main) hors du store : on retombe sur le défaut.
const chargerCoque = () => {
  try {
    const stocke = window.localStorage.getItem(STORAGE_KEY);
    return isShell(stocke) ? stocke : DEFAULT_SHELL;
  } catch {
    return DEFAULT_SHELL; // mode privé, stockage refusé — sans conséquence
  }
};

const chargerDebug = () => {
  try {
    return window.localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Le modèle de console. Le défaut est AUTO — le comportement d'une vraie
 * console : c'est la cartouche qui dit ce qu'elle sait faire, et le boîtier
 * suit. DMG et CGB restent là pour forcer la main, ce qui est le seul moyen de
 * comparer les deux rendus d'un même jeu.
 */
const chargerModele = () => {
  try {
    const stocke = window.localStorage.getItem(MODEL_KEY);
    return isPreference(stocke) ? stocke : AUTO;
  } catch {
    return AUTO;
  }
};

const initialState = {
  shell: chargerCoque(),
  debug: chargerDebug(), // overlay de métriques : masqué par défaut
  model: chargerModele(),
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    shellChanged(state, action) {
      if (!isShell(action.payload)) return;
      state.shell = action.payload;
      try {
        window.localStorage.setItem(STORAGE_KEY, action.payload);
      } catch {
        // pas de persistance possible : le choix vaut pour la session
      }
    },
    debugToggled(state) {
      state.debug = !state.debug;
      try {
        window.localStorage.setItem(DEBUG_KEY, state.debug ? '1' : '0');
      } catch {
        // pas de persistance : le choix vaut pour la session
      }
    },
    modelChanged(state, action) {
      // Le réglage ne s'applique qu'à la PROCHAINE cartouche : une machine
      // change de PPU à l'insertion, pas en cours de partie.
      if (!isPreference(action.payload)) return;
      state.model = action.payload;
      try {
        window.localStorage.setItem(MODEL_KEY, action.payload);
      } catch {
        // pas de persistance possible : le choix vaut pour la session
      }
    },
  },
});

export const { shellChanged, debugToggled, modelChanged } = settingsSlice.actions;

export default settingsSlice.reducer;
