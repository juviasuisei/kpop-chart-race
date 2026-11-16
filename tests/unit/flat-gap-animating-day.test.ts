// Regression: while the arrival day is animating (progressToNext in (0,1)),
// the line must stay flat across the gap days and rise only over the arrival
// day, exactly like the settled frame. Previously the tip was drawn as one
// slope from the last real point across the whole gap.
import { describe, it, expect } from "vitest";
import { buildPixelPoints } from "../../src/worker/pixel-points.ts";
import type { PixelPoint, Viewport } from "../../src/worker/messages.ts";

const vp = (start: number, end: number, progress: number, scrollOffset = 0): Viewport =>
  ({ startDateIndex: start, endDateIndex: end, progressToNext: progress, scrollOffset, width: 1210, height: 440 }) as Viewport;
const y = (v: number, max = 30) => 40 + 360 - (v / max) * 360;
const polyY = (pts: PixelPoint[], x: number): number => {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (x >= a.x - 1e-9 && x <= b.x + 1e-9) return b.x === a.x ? a.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
  }
  return pts[pts.length - 1].y;
};

describe("buildPixelPoints while the arrival day animates", () => {
  // value 10 on day 2, value 30 on day 12 (arrival). Playhead on day 11, partway to 12.
  const cp: [number, number][] = [[2, 10], [12, 30]];

  it("holds the last value flat up to the day before arrival", () => {
    const { points } = buildPixelPoints(cp, vp(0, 11, 0.5), 30, 20);
    const x = (d: number) => (d / 12) * 1000; // span = end+1-start = 12
    for (const d of [2, 5, 8, 11]) expect(polyY(points, x(d))).toBeCloseTo(y(10), 6);
  });

  it("rises only over the arrival day: tip value is interpolated, tip x is partway", () => {
    const { points, values } = buildPixelPoints(cp, vp(0, 11, 0.5), 30, 20);
    const tip = points[points.length - 1];
    expect(tip.y).toBeCloseTo(y(20), 6);
    expect(values[values.length - 1]).toBe(20);
  });

  it("stays flat with a scroll offset applied", () => {
    const { points } = buildPixelPoints(cp, vp(0, 11, 0.25, 0.25), 30, 20);
    const x = (d: number) => ((d - 0.25) / 12) * 1000;
    expect(polyY(points, x(11))).toBeCloseTo(y(10), 6);
  });

  it("does not add an extra point when the arrival is the very next day", () => {
    const { points } = buildPixelPoints([[2, 10], [4, 30]], vp(0, 3, 0.5), 30, 20);
    // zero-origin(1), 2, tip  (day 3 holds the value; flat point coincides with it)
    expect(points).toHaveLength(4);
    expect(points[points.length - 1].y).toBeCloseTo(y(20), 6);
  });

  it("stays flat when the line started before the viewport", () => {
    // viewport starts at day 5, after the day-2 value; playhead on day 11
    const { points } = buildPixelPoints(cp, vp(5, 11, 0.5), 30, 20);
    const x = (d: number) => ((d - 5) / 7) * 1000; // span = 11+1-5
    expect(polyY(points, x(8))).toBeCloseTo(y(10), 6);
    expect(polyY(points, x(11))).toBeCloseTo(y(10), 6);
    expect(points[points.length - 1].y).toBeCloseTo(y(20), 6);
  });

  it("is unchanged when progress is 0 (no tip)", () => {
    const { points } = buildPixelPoints(cp, vp(0, 11, 0), 30, 20);
    expect(polyY(points, (11 / 12) * 1000)).toBeCloseTo(y(10), 6);
  });
});
