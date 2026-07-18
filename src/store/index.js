import { configureStore } from '@reduxjs/toolkit';

import emulatorReducer from './slices/emulatorSlice';
import settingsReducer from './slices/settingsSlice';

const store = configureStore({
  reducer: {
    emulator: emulatorReducer,
    settings: settingsReducer,
  },
});

export default store;
