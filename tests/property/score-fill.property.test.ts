// Property-based tests for deterministic score fill.
//
// Invariants (must hold for all inputs):
//  - strictly descending: no ties, no inversions among filled scores;
//  - first filled score is strictly below the real anchor;
//  - deterministic: same inputs → identical outputs;
//  - floor honored when there is room (anchor large enough for the descent).

import fc from "fast-check";
import { describe, it, expect } from "vitest";
import {
  SCORE_FLOOR,
  fillMusicBankTail,
  fillMCountdown,
} from "../../src/airtable/score-fill.ts";

const strictlyDescending = (xs: number[]) =>
  xs.every((v, i) => i === 0 || v < xs[i - 1]);

describe("score-fill properties", () => {
  it("Music Bank fill is strictly descending and below the anchor", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: SCORE_FLOOR + 40, max: 20000 }), // realistic anchor above floor+slots
        fc.integer({ min: 1, max: 30 }), // number of missing ranks
        (anchor, count) => {
          const first = 21;
          const last = 20 + count;
          const out = fillMusicBankTail(anchor, first, last);
          const s = out.map(o => o.score);
          expect(out.length).toBe(count);
          expect(s[0]).toBeLessThan(anchor);
          expect(strictlyDescending(s)).toBe(true);
          expect(Math.min(...s)).toBeGreaterThanOrEqual(SCORE_FLOOR);
        },
      ),
    );
  });

  it("M Countdown fill is strictly descending and below the real #1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: SCORE_FLOOR + 30, max: 20000 }),
        fc.integer({ min: 1, max: 19 }),
        (anchor, count) => {
          const first = 2;
          const last = 1 + count;
          const out = fillMCountdown(anchor, first, last);
          const s = out.map(o => o.score);
          expect(out.length).toBe(count);
          expect(s[0]).toBeLessThan(anchor);
          expect(strictlyDescending(s)).toBe(true);
          expect(Math.min(...s)).toBeGreaterThanOrEqual(SCORE_FLOOR);
        },
      ),
    );
  });

  it("is deterministic (same inputs → identical outputs)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: SCORE_FLOOR + 40, max: 20000 }),
        fc.integer({ min: 1, max: 30 }),
        (anchor, count) => {
          const a = fillMusicBankTail(anchor, 21, 20 + count);
          const b = fillMusicBankTail(anchor, 21, 20 + count);
          expect(a).toEqual(b);
        },
      ),
    );
  });

  it("even a degenerate small anchor never inverts ranks (strict descent wins over floor)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 40 }), // anchor too small to fit the descent + floor
        fc.integer({ min: 1, max: 30 }),
        (anchor, count) => {
          const out = fillMusicBankTail(anchor, 21, 20 + count);
          const s = out.map(o => o.score);
          // The hard invariant holds even when the floor cannot: strictly below
          // the anchor and strictly descending.
          expect(s[0]).toBeLessThan(anchor);
          expect(strictlyDescending(s)).toBe(true);
        },
      ),
    );
  });
});
