import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeActivityOpacity,
  computeInactivityOpacity,
  FADE_START_DAYS,
  BASE_FADE_END_DAYS,
} from '../../src/worker/visibility.ts';

const L = BASE_FADE_END_DAYS - FADE_START_DAYS;
const daysArb = fc.uniqueArray(fc.integer({ min: 0, max: 400 }), { minLength: 1, maxLength: 25 }).map(a => a.sort((x, y) => x - y));

describe('activity fade properties', () => {
  it('fade-in k days after reactivation from fully hidden equals fade-out k days before full fade', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: L }), fc.integer({ min: 0, max: 3 }), (k, fc_) => {
      const ceil = BASE_FADE_END_DAYS * 2 ** fc_;
      const span = ceil - FADE_START_DAYS;
      const kk = Math.min(k, span);
      // line active at day 0, silent past the ceiling, reactivates at r
      const r = ceil + 10;
      // sustained activity from r (a streak), so the line stays in its rise window
      const streak = Array.from({ length: Math.max(kk, 1) }, (_, i) => r + i);
      const fadeIn = computeActivityOpacity([0, ...streak], r + kk - 1, fc_);
      const fadeOut = computeInactivityOpacity(ceil - kk, fc_);
      expect(fadeIn).toBeCloseTo(fadeOut, 9);
    }));
  });
  it('opacity stays within [0,1] and moves at most one ramp step per day (continuous across reactivation)', () => {
    fc.assert(fc.property(daysArb, fc.integer({ min: 0, max: 2 }), (days, f) => {
      const step = 1 / (BASE_FADE_END_DAYS * 2 ** f - FADE_START_DAYS);
      let prev = computeActivityOpacity(days, 0, f);
      for (let t = 1; t <= 500; t++) {
        const cur = computeActivityOpacity(days, t, f);
        expect(cur).toBeGreaterThanOrEqual(0);
        expect(cur).toBeLessThanOrEqual(1);
        expect(Math.abs(cur - prev)).toBeLessThanOrEqual(step + 1e-9);
        prev = cur;
      }
    }));
  });
  it('matches an independent day-by-day simulation (scrubbing == stepping)', () => {
    fc.assert(fc.property(daysArb, fc.integer({ min: 0, max: 2 }), (days, f) => {
      const step = 1 / (BASE_FADE_END_DAYS * 2 ** f - FADE_START_DAYS);
      const active = new Set(days);
      let v = 1, rising = false, last = days[0];
      for (let t = days[0]; t <= 450; t++) {
        if (t > days[0]) {
          if (active.has(t)) { v = Math.min(1, v + step); last = t; rising = v < 1 - 1e-9; }
          else if (rising) { v = Math.min(1, v + step); if (v >= 1 - 1e-9) { v = 1; rising = false; } }
          else if (t - last > FADE_START_DAYS) v = Math.max(0, v - step);
        }
        expect(computeActivityOpacity(days, t, f)).toBeCloseTo(v, 6);
      }
    }));
  });
  it('a fully hidden line that is active again is visible within the ramp and never starves while it keeps charting', () => {
    fc.assert(fc.property(fc.integer({ min: 5, max: 21 }), fc.integer({ min: 0, max: 2 }), (period, f) => {
      const periodic = Array.from({ length: 60 }, (_, i) => i * period);
      for (let t = period * 30; t <= period * 59; t++) expect(computeActivityOpacity(periodic, t, f)).toBeGreaterThan(0);
    }));
  });
  it('is causal: activity after the current date never changes the opacity', () => {
    fc.assert(fc.property(daysArb, fc.integer({ min: 0, max: 400 }), (days, t) => {
      const past = days.filter(d => d <= t);
      if (past.length === 0) return;
      expect(computeActivityOpacity(days, t, 0)).toBe(computeActivityOpacity(past, t, 0));
    }));
  });
  it('with no later activity it equals the legacy inactivity fade', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 200 }), (a, k) => {
      expect(computeActivityOpacity([a], a + k, 0)).toBeCloseTo(computeInactivityOpacity(k, 0), 9);
    }));
  });
});
