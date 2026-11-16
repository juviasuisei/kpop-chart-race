import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { RACE_SPEED_MULTIPLIER, computeFrameAdvance } from "../../src/playback-frame.ts";

describe("computeFrameAdvance (property)", () => {
  it("is exactly RACE_SPEED_MULTIPLIER x the original 1x pace", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.double({ min: 0.1, max: 4, noNaN: true }),
        fc.boolean(),
        fc.boolean(),
        (ms, speed, first, empty) => {
          const original = (ms / 1000) * (first ? 2.0 : speed) * (empty ? 2.5 : 1);
          expect(computeFrameAdvance(ms, speed, first, empty)).toBeCloseTo(original * RACE_SPEED_MULTIPLIER, 8);
        },
      ),
    );
  });

  it("is linear in elapsed time", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), fc.double({ min: 0.1, max: 4, noNaN: true }), (ms, speed) => {
        expect(computeFrameAdvance(ms * 2, speed, false, false)).toBeCloseTo(2 * computeFrameAdvance(ms, speed, false, false), 8);
      }),
    );
  });
});
