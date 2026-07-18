import { createSlice } from '@reduxjs/toolkit';

import { DEFAULT_SHELL, isShell } from '../../theme/shells';

const STORAGE_KEY = 'emugbc.shell';

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

const initialState = {
  shell: chargerCoque(),
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
  },
});

export const { shellChanged } = settingsSlice.actions;

export default settingsSlice.reducer;
