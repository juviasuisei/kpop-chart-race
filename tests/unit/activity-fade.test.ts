import { describe, it, expect } from 'vitest';
import {
  computeActivityOpacity,
  computeInactivityOpacity,
  resolveLineOpacity,
  FADE_START_DAYS,
  BASE_FADE_END_DAYS,
} from '../../src/worker/visibility.ts';

const L = BASE_FADE_END_DAYS - FADE_START_DAYS; // 21-day ramp at filterCount 0
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe('computeActivityOpacity: fade-out is unchanged for a line with no later activity', () => {
  it('matches computeInactivityOpacity for every day after the last activity', () => {
    for (let k = 0; k <= 40; k++) {
      close(computeActivityOpacity([10], 10 + k, 0), computeInactivityOpacity(k, 0));
    }
  });
  it('is 1 before the first activity (upcoming lines)', () => {
    expect(computeActivityOpacity([10, 12], 5, 0)).toBe(1);
  });
  it('honours the widened ceiling for active filters', () => {
    close(computeActivityOpacity([0], 30, 1), computeInactivityOpacity(30, 1));
  });
});

describe('computeActivityOpacity: fade-out happens inside gaps (causal, as of the current date)', () => {
  it('fades during a gap even though the line is active again later', () => {
    const days = [0, 1, 60, 61];
    expect(computeActivityOpacity(days, 1 + 14, 0)).toBeLessThan(1);
    expect(computeActivityOpacity(days, 1 + 40, 0)).toBe(0);
  });
});

describe('computeActivityOpacity: fade-in mirrors fade-out', () => {
  const days = [0, 1, 60];
  it('starts rising from 0 on the reactivation date and reaches 1 after L days', () => {
    expect(computeActivityOpacity(days, 59, 0)).toBe(0);
    close(computeActivityOpacity(days, 60, 0), 1 / L);
    close(computeActivityOpacity(days, 60 + 10, 0), 11 / L);
    expect(computeActivityOpacity(days, 60 + L - 1, 0)).toBe(1);
  });
  it('a single day of activity on a hidden line still fades fully in, over the same L days', () => {
    for (let k = 0; k < L; k++) close(computeActivityOpacity(days, 60 + k, 0), (k + 1) / L);
    expect(computeActivityOpacity(days, 60 + L - 1, 0)).toBe(1);
  });
  it('fades out again right after it is full (the fade-out only waits for the fade-in to finish)', () => {
    expect(computeActivityOpacity(days, 60 + L - 1, 0)).toBe(1);
    close(computeActivityOpacity(days, 60 + L, 0), 1 - 1 / L);
  });
  it('a mid-fade line reverses from its current opacity with no jump', () => {
    const d = [0, 20]; // last activity day 0, fade-out underway at day 19
    const before = computeActivityOpacity(d, 19, 0);
    const at = computeActivityOpacity(d, 20, 0);
    close(at - before, 1 / L); // rises one step instead of falling one: no snap to 1
    expect(at).toBeLessThan(1);
    expect(computeActivityOpacity(d, 21, 0) - at).toBeCloseTo(1 / L, 9); // keeps rising
  });
  it('a line that charts every 20 days never starves to hidden (regression guard)', () => {
    const periodic = Array.from({ length: 30 }, (_, i) => i * 20);
    for (let t = 200; t <= 580; t++) expect(computeActivityOpacity(periodic, t, 0)).toBeGreaterThan(0.04);
  });
  it('duplicate or out-of-order activity days are no-ops, not extra rises', () => {
    const clean = computeActivityOpacity([0, 60], 60, 0);
    close(computeActivityOpacity([0, 60, 60, 60], 60, 0), clean);
  });
  it('NaN or absurd input stays within [0,1] and never yields NaN', () => {
    for (const fc of [NaN, -5, 1e9, 2.7]) {
      const v = computeActivityOpacity([0, 50, 400], 420, fc);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('resolveLineOpacity keeps its override order with the activity opacity', () => {
  const base = { isSelected: false, isFirstPlace: false, isPinnedArtist: false, artistFilterActive: false, daysSinceActivity: 99, filterCount: 0 };
  it('uses the supplied activity opacity when no override applies', () => {
    expect(resolveLineOpacity({ ...base, activityOpacity: 0.4 })).toBe(0.4);
  });
  it('#1, pinned, selected and filter-active lines stay at 1', () => {
    for (const o of [{ isFirstPlace: true }, { isPinnedArtist: true }, { isSelected: true }, { artistFilterActive: true }]) {
      expect(resolveLineOpacity({ ...base, ...o, activityOpacity: 0 })).toBe(1);
    }
  });
});
