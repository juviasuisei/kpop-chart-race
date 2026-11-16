// Regression: a line must stay flat across days with no value, then step on
// the day the next value arrives (never a diagonal from the last known point).

import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { buildPixelPoints } from "../../src/worker/pixel-points.ts";
import type { PixelPoint, Viewport } from "../../src/worker/messages.ts";

const WIDTH = 1210; // chartW = 1000 (padding.right 210)
const HEIGHT = 440; // chartH = 360 (padding top/bottom 40)

function yForValue(v: number, max: number): number {
  return 40 + 360 - (v / max) * 360;
}

/** Y of the polyline at pixel x (clamped to the polyline's x extent). */
function polylineY(pts: PixelPoint[], x: number): number {
  if (x <= pts[0].x) return pts[0].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x >= a.x && x <= b.x) {
      if (b.x === a.x) return a.y;
      return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    }
  }
  return pts[pts.length - 1].y;
}

function view(start: number, end: number): Viewport {
  return { startDateIndex: start, endDateIndex: end, progressToNext: 0, width: WIDTH, height: HEIGHT } as Viewport;
}

/** Sorted unique date indices with strictly increasing cumulative values. */
const seriesArb = fc
  .uniqueArray(fc.integer({ min: 1, max: 60 }), { minLength: 2, maxLength: 8 })
  .chain((idxs) =>
    fc
      .array(fc.integer({ min: 1, max: 500 }), { minLength: idxs.length, maxLength: idxs.length })
      .map((deltas) => {
        const sorted = [...idxs].sort((a, b) => a - b);
        let cum = 0;
        return sorted.map((d, i): [number, number] => {
          cum += deltas[i];
          return [d, cum];
        });
      }),
  );

describe("flat lines across days with no value", () => {
  it("holds the previous value on every no-data day (full range)", () => {
    fc.assert(
      fc.property(seriesArb, (cps) => {
        const end = cps[cps.length - 1][0] + 1;
        const max = cps[cps.length - 1][1];
        const total = end + 1;
        const { points } = buildPixelPoints(cps, view(0, end), max, total + 5);
        const dateToX = (d: number) => (d / total) * 1000;
        for (let i = 0; i < cps.length - 1; i++) {
          const [p, vp] = cps[i];
          const [q] = cps[i + 1];
          // Every day from p up to the day before q holds value vp.
          for (let d = p; d <= q - 1; d++) {
            expect(polylineY(points, dateToX(d))).toBeCloseTo(yForValue(vp, max), 6);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("holds the value on no-data days when the line starts before the viewport", () => {
    fc.assert(
      fc.property(seriesArb, (cps) => {
        const first = cps[0][0];
        const start = first + 1;
        const end = cps[cps.length - 1][0] + 1;
        fc.pre(end - start >= 2);
        const max = cps[cps.length - 1][1];
        const span = end + 1 - start;
        const { points } = buildPixelPoints(cps, view(start, end), max, end + 6);
        const dateToX = (d: number) => ((d - start) / span) * 1000;
        for (let i = 0; i < cps.length - 1; i++) {
          const [p, vp] = cps[i];
          const [q] = cps[i + 1];
          for (let d = Math.max(p, start); d <= q - 1; d++) {
            expect(polylineY(points, dateToX(d))).toBeCloseTo(yForValue(vp, max), 6);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
