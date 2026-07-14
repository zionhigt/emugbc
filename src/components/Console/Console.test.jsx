import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import Console from './index';

describe('Console : les boutons de coque pilotent la manette', () => {
  const setup = () => {
    const presses = [];
    const releases = [];
    const { container } = render(
      <Console onPress={(k) => presses.push(k)} onRelease={(k) => releases.push(k)} />,
    );
    const btn = (cls) => container.querySelector(`.gbc-console__buttons--${cls}`);
    return { presses, releases, btn };
  };

  it.each([
    ['cross-up', 'up'],
    ['cross-left', 'left'],
    ['cross-right', 'right'],
    ['cross-down', 'down'],
    ['a', 'a'],
    ['b', 'b'],
    ['action-select', 'select'],
    ['action-start', 'start'],
  ])('%s → presse/relâche "%s" (souris)', (cls, key) => {
    const { presses, releases, btn } = setup();
    fireEvent.mouseDown(btn(cls));
    fireEvent.mouseUp(btn(cls));
    expect(presses).toEqual([key]);
    expect(releases).toEqual([key]);
  });

  it('le tactile presse et relâche aussi (mobile)', () => {
    const { presses, releases, btn } = setup();
    fireEvent.touchStart(btn('a'));
    fireEvent.touchEnd(btn('a'));
    expect(presses).toEqual(['a']);
    expect(releases).toEqual(['a']);
  });

  it('quitter le bouton en maintenant le relâche (onMouseLeave)', () => {
    const { releases, btn } = setup();
    fireEvent.mouseDown(btn('cross-right'));
    fireEvent.mouseLeave(btn('cross-right'));
    expect(releases, 'le doigt glisse hors du bouton : on relâche').toEqual(['right']);
  });

  it('sans onPress, la Console reste décorative — aucun plantage', () => {
    const { container } = render(<Console />);
    const up = container.querySelector('.gbc-console__buttons--cross-up');
    expect(() => fireEvent.mouseDown(up)).not.toThrow();
  });
});
