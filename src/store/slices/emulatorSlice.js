import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  // métadonnées de la cartouche chargée — l'instance elle-même vit HORS du store
  // (un Uint8Array de 32 Ko et une classe à méthodes ne sont pas sérialisables)
  cartridge: null,
};

const emulatorSlice = createSlice({
  name: 'emulator',
  initialState,
  reducers: {
    cartridgeLoaded(state, action) {
      state.cartridge = action.payload; // { fileName, size }
    },
  },
});

export const { cartridgeLoaded } = emulatorSlice.actions;

export default emulatorSlice.reducer;
