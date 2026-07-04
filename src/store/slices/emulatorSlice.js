import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  status: 'idle',
  rom: null,
};

const emulatorSlice = createSlice({
  name: 'emulator',
  initialState,
  reducers: {
    setStatus(state, action) {
      state.status = action.payload;
    },
    loadRom(state, action) {
      state.rom = action.payload;
    },
  },
});

export const { setStatus, loadRom } = emulatorSlice.actions;

export default emulatorSlice.reducer;
