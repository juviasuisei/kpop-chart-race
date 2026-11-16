import { describe, it, expect } from "vitest";
import { buildPixelPoints } from "../../src/worker/pixel-points.ts";
import type { Viewport } from "../../src/worker/messages.ts";

const vp = (start: number, end: number): Viewport =>
  ({ startDateIndex: start, endDateIndex: end, progressToNext: 0, width: 1210, height: 440 }) as Viewport;

describe("buildPixelPoints gap handling", () => {
  it("steps on the day before a new value after a multi-day gap", () => {
    // value 10 on day 2, value 30 on day 12; 11 days drawn (0..11 span 12)
    const { points, values } = buildPixelPoints([[2, 10], [12, 30]], vp(0, 12), 30, 20);
    const total = 13;
    const x = (d: number) => (d / total) * 1000;
    const y10 = 40 + 360 - (10 / 30) * 360;
    // a point holding 10 exists at day 11 (one day before the rise)
    expect(points.some((p) => Math.abs(p.x - x(11)) < 1e-6 && Math.abs(p.y - y10) < 1e-6)).toBe(true);
    expect(values).toContain(10);
    expect(values[values.length - 1]).toBe(30);
  });

  it("does not add a flat point when values are on consecutive days", () => {
    const { points } = buildPixelPoints([[2, 10], [3, 30]], vp(0, 3), 30, 10);
    // zero-origin(1), 2, 3 only
    expect(points).toHaveLength(3);
  });
});
