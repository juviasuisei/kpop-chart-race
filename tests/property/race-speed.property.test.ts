import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { RACE_SPEED_MULTIPLIER, computeFrameAdvance } from "../../src/playback-frame.ts";

describe("computeFrameAdvance (property)", () => {
  it("is exactly RACE_SPEED_MULTIPLIER x the original 1x pace", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 24 }), // keeps first-step x empty-day (30 dates/s) under the 1-date cap
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        fc.boolean(),
        fc.boolean(),
        (ms, speed, first, empty) => {
          const original = (ms / 1000) * (first ? 2.0 : speed) * (empty ? 2.5 : 1);
          expect(computeFrameAdvance(ms, speed, first, empty)).toBeCloseTo(original * 6, 8);
        },
      ),
    );
  });

  it("is linear in elapsed time", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.double({ min: 0.1, max: 1, noNaN: true }), (ms, speed) => {
        expect(computeFrameAdvance(ms * 2, speed, false, false)).toBeCloseTo(2 * computeFrameAdvance(ms, speed, false, false), 8);
      }),
    );
  });

  it("every date is processed: floor(position) rises by at most 1 per frame", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 500, noNaN: true }),
        fc.integer({ min: 1, max: 5000 }),
        fc.double({ min: 0.1, max: 4, noNaN: true }),
        fc.boolean(),
        fc.boolean(),
        (pos, ms, speed, first, empty) => {
          const next = pos + computeFrameAdvance(ms, speed, first, empty);
          expect(Math.floor(next) - Math.floor(pos)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});
