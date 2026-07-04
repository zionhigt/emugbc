import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import Home from './index';

describe('Home', () => {
  it('affiche Home', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });
});
