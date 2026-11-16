/**
 * Pins the race playback pace. The whole race is scaled by ONE constant,
 * RACE_SPEED_MULTIPLIER (default 4), applied in computeFrameAdvance.
 * Original (1x) pace: 0.8 dates/s base, 2.0 dates/s first step, 2.5x empty days.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RACE_SPEED_MULTIPLIER,
  computeFrameAdvance,
} from "../../src/playback-frame.ts";

describe("race playback speed", () => {
  it("defaults to 4x", () => {
    expect(RACE_SPEED_MULTIPLIER).toBe(4);
  });

  it("base speed 0.8 dates/s advances 0.16 dates in a 50 ms frame", () => {
    expect(computeFrameAdvance(50, 0.8, false, false)).toBeCloseTo(0.16, 10);
  });

  it("first step runs at 2.0 dates/s x4 = 8 dates/s (0.4 dates in a 50 ms frame)", () => {
    expect(computeFrameAdvance(50, 0.8, true, false)).toBeCloseTo(0.4, 10);
  });

  it("empty days keep their 2.5x boost on top of the global multiplier", () => {
    expect(computeFrameAdvance(50, 0.8, false, true)).toBeCloseTo(0.8 * 2.5 * 4 * 0.05, 10);
  });

  it("speed presets 1-5 stay proportional (0.5 .. 2.0 dates/s, scaled)", () => {
    const presets = [0.5, 0.8, 1.0, 1.5, 2.0];
    for (const p of presets) {
      expect(computeFrameAdvance(50, p, false, false)).toBeCloseTo(0.05 * p * 4, 10);
    }
  });
});

describe("per-frame advance cap (no skipped dates at 4x)", () => {
  it("never advances more than one date in a frame, even after a long stall", () => {
    expect(computeFrameAdvance(5000, 2.0, true, true)).toBe(1);
    expect(computeFrameAdvance(500, 0.8, false, false)).toBe(1);
  });

  it("key 5 on an empty day with a 60 ms (~16 fps) frame stays at the cap", () => {
    // 2.0 * 2.5 * 4 = 20 dates/s -> 1.2 uncapped
    expect(computeFrameAdvance(60, 2.0, false, true)).toBe(1);
  });

  it("does not change advances already below the cap", () => {
    expect(computeFrameAdvance(16, 0.8, false, false)).toBeCloseTo(0.016 * 0.8 * 4, 10);
  });
});

describe("race loop wiring", () => {
  // The rAF loop needs canvas + workers, so guard the wiring at source level:
  // the controller must advance its position through computeFrameAdvance (the
  // only place RACE_SPEED_MULTIPLIER is applied), not an inline speed formula.
  const src = readFileSync(
    resolve(__dirname, "../../src/views/line-chart-controller.ts"),
    "utf8",
  );

  it("advances animationPosition via computeFrameAdvance", () => {
    expect(src).toMatch(/animationPosition \+= computeFrameAdvance\(/);
  });

  it("has no inline deltaMs/1000 * speed pace formula left", () => {
    expect(src).not.toMatch(/deltaMs\s*\/\s*1000\s*\)\s*\*\s*speed/);
  });
});
