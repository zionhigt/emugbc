import { createSlice } from '@reduxjs/toolkit';
import CPU from '../../emulator/core/cpu/CPU';

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
      // if (state.status === "running") {
      //   const cpu = new CPU();
      //   cpu.registers.AF.setValue(0xAA00)
      //   cpu.registers.F.z = 1;
      // }
    },
    loadRom(state, action) {
      state.rom = action.payload;
    },
  },
});

export const { setStatus, loadRom } = emulatorSlice.actions;

export default emulatorSlice.reducer;
