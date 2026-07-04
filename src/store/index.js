import { configureStore } from '@reduxjs/toolkit';

import emulatorReducer from './slices/emulatorSlice';

const store = configureStore({
  reducer: {
    emulator: emulatorReducer,
  },
});

export default store;
