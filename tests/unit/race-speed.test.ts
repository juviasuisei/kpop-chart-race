/**
 * Pins the race playback pace. The whole race is scaled by ONE constant,
 * RACE_SPEED_MULTIPLIER (default 3), applied in computeFrameAdvance.
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
  it("defaults to 3x", () => {
    expect(RACE_SPEED_MULTIPLIER).toBe(3);
  });

  it("base speed 0.8 dates/s advances 2.4 dates in one second", () => {
    expect(computeFrameAdvance(1000, 0.8, false, false)).toBeCloseTo(2.4, 10);
  });

  it("first step runs at 2.0 dates/s x3 = 6 dates/s", () => {
    expect(computeFrameAdvance(1000, 0.8, true, false)).toBeCloseTo(6, 10);
  });

  it("empty days keep their 2.5x boost on top of the global multiplier", () => {
    expect(computeFrameAdvance(1000, 0.8, false, true)).toBeCloseTo(0.8 * 2.5 * 3, 10);
  });

  it("speed presets 1-5 stay proportional (0.5 .. 2.0 dates/s, scaled)", () => {
    const presets = [0.5, 0.8, 1.0, 1.5, 2.0];
    for (const p of presets) {
      expect(computeFrameAdvance(1000, p, false, false)).toBeCloseTo(p * RACE_SPEED_MULTIPLIER, 10);
    }
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
