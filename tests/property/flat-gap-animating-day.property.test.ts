import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { buildPixelPoints } from "../../src/worker/pixel-points.ts";
import type { PixelPoint, Viewport } from "../../src/worker/messages.ts";

const y = (v: number, max: number) => 40 + 360 - (v / max) * 360;
const polyY = (pts: PixelPoint[], x: number): number => {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (x >= a.x - 1e-9 && x <= b.x + 1e-9) return b.x === a.x ? a.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
  }
  return pts[pts.length - 1].y;
};

describe("animating arrival day keeps the gap flat (property)", () => {
  it("for every fractional position inside an arrival day, drawn points over the gap days stay at the last real value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }), // first change day
        fc.integer({ min: 2, max: 30 }), // gap length (arrival = first + gap)
        fc.integer({ min: 1, max: 100 }), // first value
        fc.integer({ min: 1, max: 100 }), // rise
        fc.double({ min: 0.01, max: 0.99, noNaN: true }), // progress
        fc.double({ min: 0, max: 0.99, noNaN: true }), // scroll offset
        fc.integer({ min: 0, max: 3 }), // viewport start offset (>first means line starts before viewport)
        (first, gap, v1, rise, p, scroll, startOff) => {
                    const arrival = first + gap;
          // keep span >= 2 days: a 1-day span is the first-frame special case (rise from zero)
          const start = startOff === 0 || first + 1 > arrival - 3 ? 0 : Math.min(first + startOff, arrival - 3);
          const v2 = v1 + rise;
          const end = arrival - 1; // playhead on the day before arrival, moving into it
          const view = { startDateIndex: start, endDateIndex: end, progressToNext: p, scrollOffset: scroll, width: 1210, height: 440 } as Viewport;
          const max = v2;
          const { points } = buildPixelPoints([[first, v1], [arrival, v2]], view, max, arrival + 5);
          const span = end + 1 - start;
          const x = (d: number) => ((d - start - scroll) / span) * 1000;
          for (let d = Math.max(first, start); d <= end; d++) {
            if (x(d) < 0) continue;
            expect(polyY(points, x(d))).toBeCloseTo(y(v1, max), 4);
          }
          const tip = points[points.length - 1];
          expect(tip.y).toBeCloseTo(y(v1 + rise * p, max), 4);
        },
      ),
      { numRuns: 200 },
    );
  });
});
