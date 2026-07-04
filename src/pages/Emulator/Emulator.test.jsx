import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect } from 'vitest';

import emulatorReducer from '../../store/slices/emulatorSlice';
import Emulator from './index';

const renderWithStore = () => {
  const store = configureStore({
    reducer: { emulator: emulatorReducer },
  });
  return render(
    <Provider store={store}>
      <Emulator />
    </Provider>
  );
};

describe('Emulator', () => {
  it('affiche le status initial du store', () => {
    renderWithStore();
    expect(screen.getByText('Status: idle')).toBeInTheDocument();
  });
});
