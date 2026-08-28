/**
 * Unit tests for resolveFrameAdvance — the playback frame decision extracted
 * from LineChartController's animation loop.
 *
 * Regression focus: when playback reaches the last date, the frame must emit a
 * date:change for the final index even if the integer index was already there,
 * so the scrubber lands exactly on the right edge instead of stopping short.
 */

import { describe, it, expect } from "vitest";
import { resolveFrameAdvance } from "../../src/playback-frame.ts";

describe("resolveFrameAdvance", () => {
  const MAX = 100; // e.g. dates.length - 1 for 101 dates

  it("advances the integer index mid-playback and emits on change", () => {
    const f = resolveFrameAdvance(42.7, 42, MAX);
    expect(f.index).toBe(42);
    expect(f.reachedEnd).toBe(false);
    // Same integer index as before → no emit.
    expect(f.shouldEmit).toBe(false);
  });

  it("emits when the integer index crosses to a new date", () => {
    const f = resolveFrameAdvance(43.1, 42, MAX);
    expect(f.index).toBe(43);
    expect(f.shouldEmit).toBe(true);
  });

  it("clamps an overshoot to maxIndex and flags reachedEnd", () => {
    const f = resolveFrameAdvance(100.6, 99, MAX);
    expect(f.position).toBe(MAX);
    expect(f.index).toBe(MAX);
    expect(f.reachedEnd).toBe(true);
    expect(f.shouldEmit).toBe(true);
  });

  it("clamps when position lands exactly on maxIndex", () => {
    const f = resolveFrameAdvance(100, 99, MAX);
    expect(f.position).toBe(MAX);
    expect(f.reachedEnd).toBe(true);
    expect(f.index).toBe(MAX);
    expect(f.shouldEmit).toBe(true);
  });

  it("REGRESSION: emits the final index even when prevIndex already equals maxIndex", () => {
    // This is the scrubber-stops-short case: a prior frame set the index to
    // maxIndex via floor(overshoot), but the final clamped frame must STILL
    // emit so the scrubber is told to move to the true last position.
    const f = resolveFrameAdvance(100.9, MAX, MAX);
    expect(f.reachedEnd).toBe(true);
    expect(f.index).toBe(MAX);
    expect(f.shouldEmit).toBe(true);
  });

  it("does not emit for a stationary mid-playback frame", () => {
    const f = resolveFrameAdvance(10.2, 10, MAX);
    expect(f.shouldEmit).toBe(false);
    expect(f.reachedEnd).toBe(false);
  });

  it("never produces a negative index", () => {
    const f = resolveFrameAdvance(-5, 0, MAX);
    expect(f.index).toBe(0);
  });
});
