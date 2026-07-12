import { describe, it, expect, vi, afterEach } from 'vitest';

import buildClock from './index';

const Clock = buildClock();

afterEach(() => {
  vi.useRealTimers();
});

describe('Clock : le maître du temps, événementiel', () => {
  it('la factory rend la classe : new Clock(delta) expose onTick, start, stop, tick', () => {
    const clock = new Clock(16);
    for (const m of ['onTick', 'start', 'stop', 'tick']) {
      expect(typeof clock[m], `${m} doit être appelable`).toBe('function');
    }
  });

  describe('la manivelle : tick() à la main, gardé par active (protection by design)', () => {
    it('tick() ne notifie PERSONNE tant que start() n\'a pas été appelé', () => {
      const clock = new Clock(16);
      let n = 0;
      clock.onTick(() => n++);
      clock.tick(); // horloge inactive : silence radio
      expect(n, 'une horloge arrêtée ne bat pas, même secouée à la main').toBe(0);
    });

    it('après start(), tick() manuel notifie tous les abonnés', () => {
      vi.useFakeTimers(); // neutralise le setInterval de start — on ne garde que la manivelle
      const clock = new Clock(16);
      let a = 0;
      let b = 0;
      clock.onTick(() => a++);
      clock.onTick(() => b++);
      clock.start();
      clock.tick();
      clock.tick();
      expect(a, 'premier abonné : un appel par tick').toBe(2);
      expect(b, 'second abonné : servi aussi').toBe(2);
      clock.stop();
    });

    it('après stop(), la manivelle redevient silencieuse — la protection est symétrique', () => {
      vi.useFakeTimers();
      const clock = new Clock(16);
      let n = 0;
      clock.onTick(() => n++);
      clock.start();
      clock.tick();
      clock.stop();
      clock.tick(); // arrêtée à nouveau : plus un bruit
      expect(n, 'stop() doit désactiver, pas seulement tuer l\'intervalle').toBe(1);
    });

    it('un tick actif sans aucun abonné ne casse rien', () => {
      vi.useFakeTimers();
      const clock = new Clock(16);
      clock.start();
      expect(() => clock.tick(), 'silence, pas d\'explosion').not.toThrow();
      clock.stop();
    });
  });

  describe('le battement automatique : start() / stop()', () => {
    it('start() déclenche un tick à chaque intervalle de timeDelta ms', () => {
      vi.useFakeTimers();
      const clock = new Clock(16);
      let n = 0;
      clock.onTick(() => n++);
      clock.start();
      vi.advanceTimersByTime(16 * 3);
      expect(n, '3 intervalles écoulés = 3 battements').toBe(3);
      clock.stop();
    });

    it('stop() arrête les battements', () => {
      vi.useFakeTimers();
      const clock = new Clock(16);
      let n = 0;
      clock.onTick(() => n++);
      clock.start();
      vi.advanceTimersByTime(16 * 2);
      clock.stop();
      vi.advanceTimersByTime(16 * 5);
      expect(n, 'plus un seul battement après stop').toBe(2);
    });

    it('start() après stop() repart, avec les mêmes abonnés', () => {
      vi.useFakeTimers();
      const clock = new Clock(16);
      let n = 0;
      clock.onTick(() => n++);
      clock.start();
      vi.advanceTimersByTime(16);
      clock.stop();
      clock.start();
      vi.advanceTimersByTime(16);
      expect(n, '1 avant + 1 après : l\'abonnement survit au cycle stop/start').toBe(2);
      clock.stop();
    });

    it('deux start() de suite ne créent pas un double battement', () => {
      vi.useFakeTimers();
      const clock = new Clock(16);
      let n = 0;
      clock.onTick(() => n++);
      clock.start();
      clock.start(); // le second doit remplacer le premier, pas s'y ajouter
      vi.advanceTimersByTime(16 * 3);
      expect(n, '3 intervalles = 3 ticks, pas 6').toBe(3);
      clock.stop();
    });
  });
});
