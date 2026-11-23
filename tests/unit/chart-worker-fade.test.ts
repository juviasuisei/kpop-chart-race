import { describe, it, expect, beforeAll } from 'vitest';

// Drives the REAL chart-worker module (the code that sets cmd.opacity).
const posted: any[] = [];
let handler: (e: any) => void;
const dates: string[] = [];
for (let i = 0; i < 150; i++) dates.push(new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
const mk = (id: string, cps: [number, number][]) => ({ lineId: id, label: id, color: '#fff', changePoints: cps, artistId: id });

beforeAll(async () => {
  (globalThis as any).self = (globalThis as any).self ?? globalThis;
  (self as any).postMessage = (m: any) => posted.push(m);
  await import('../../src/worker/chart-worker.ts');
  handler = (self as any).onmessage;
  handler({ data: { type: 'init-data', dates, lines: [
    mk('A', [[5, 10], [6, 20], ...Array.from({ length: 21 }, (_, i) => [60 + i, 30 + i] as [number, number])]), // gap 7..59, then active every day 60..80
    mk('B', [[1, 1000], [149, 2000]]),               // always #1
    mk('C', [[5, 10], [6, 20]]),                     // never reactivates
    mk('D', [[130, 5], [140, 9]]),                   // still fading at the last date
  ] } });
});

function opacity(id: string, d: number, extra: Record<string, unknown> = {}, progress = 0): number | undefined {
  posted.length = 0;
  handler({ data: { type: 'compute-frame', requestId: d, currentDateIndex: d,
    viewport: { startDateIndex: 0, endDateIndex: d, progressToNext: progress, width: 1000, height: 500, dpr: 1 },
    visibility: { filterCount: 0, artistFilterActive: false, selectedLineIds: [], ...extra } } });
  const r = posted.find(m => m.type === 'frame-result');
  return [...r.background, ...r.foreground, ...r.highlight].find((c: any) => c.lineId === id)?.opacity;
}

describe('chart worker: fade is smooth across a date span', () => {
  it('blends between this date and the next with progressToNext', () => {
    const a = opacity('A', 40, {}, 0);
    expect(a).toBeUndefined();
    expect(opacity('A', 59, {}, 0.5)).toBeDefined(); // about to fade in: drawn faintly, not popped
    const f = opacity('A', 59, {}, 0.5)!;
    expect(f).toBeGreaterThan(0);
    expect(f).toBeCloseTo(0.5 / 21, 6);
    const mid0 = opacity('A', 65, {}, 0)!, mid1 = opacity('A', 66, {}, 0)!;
    expect(opacity('A', 65, {}, 0.5)!).toBeCloseTo((mid0 + mid1) / 2, 9);
  });
  it('scrubbing is a pure function of (date, progress)', () => {
    const seq = [0, 0.3, 0.9].map(p => opacity('A', 72, {}, p));
    for (const p of [0.9, 0, 0.3]) expect(opacity('A', 72, {}, p)).toBe(seq[[0, 0.3, 0.9].indexOf(p)]);
  });
  it('the last date is not blended', () => {
    const d0 = opacity('D', 149, {}, 0)!;
    expect(d0).toBeLessThan(1);
    expect(d0).toBeGreaterThan(0);
    expect(opacity('D', 149, {}, 0.8)).toBe(d0);
  });
  it('a line stays on its per-date layer for the whole span (no draw-order pop mid-span)', () => {
    const layerOf = (id: string, d: number, p: number): string | undefined => {
      opacity(id, d, {}, p);
      const r = posted.find(m => m.type === 'frame-result');
      return r.foreground.some((c: any) => c.lineId === id) ? 'fg' : r.background.some((c: any) => c.lineId === id) ? 'bg' : undefined;
    };
    // C is at 0.5238 on day 23 (foreground) and 0.4762 on day 24 (background)
    const layers = [0, 0.25, 0.5, 0.75, 0.99].map(p => layerOf('C', 23, p));
    expect(new Set(layers).size).toBe(1);
    expect(layers[0]).toBe('fg');
    expect(layerOf('C', 24, 0)).toBe('bg');
  });
  it('pinned and #1 stay at 1 at any progress', () => {
    expect(opacity('A', 40, { pinnedArtistId: 'A' }, 0.5)).toBe(1);
    expect(opacity('B', 40, {}, 0.5)).toBe(1);
  });
});

describe('chart worker: inactivity fade in both directions', () => {
  it('scrubbing straight to a date gives the same opacity as stepping through the dates', () => {
    const stepped: Array<number | undefined> = [];
    for (let d = 55; d <= 80; d++) stepped.push(opacity('A', d));
    for (const d of [80, 62, 55, 71, 60]) expect(opacity('A', d)).toBe(stepped[d - 55]);
  });
  it('selection dimming and the artist filter still apply on top of the fade', () => {
    expect(opacity('A', 70, { artistFilterActive: true })).toBe(1);
  });
  it('fades A during its gap (not only after its final activity)', () => {
    expect(opacity('A', 20)).toBeLessThan(1);
    expect(opacity('A', 40)).toBeUndefined(); // fully hidden -> no draw command
  });
  it('fades A back in after reactivation on day 60, continuously', () => {
    const a60 = opacity('A', 60)!;
    expect(a60).toBeGreaterThan(0);
    expect(a60).toBeLessThan(0.1);
    expect(opacity('A', 70)!).toBeGreaterThan(a60);
    expect(opacity('A', 80)).toBe(1);
  });
  it('final-inactivity fade of C is unchanged', () => {
    expect(opacity('C', 27)!).toBeCloseTo(1 - (27 - 6 - 7) / 21, 6);
  });
  it('#1 line B stays fully visible; pinned A stays at 1 in its gap', () => {
    expect(opacity('B', 40)).toBe(1);
    expect(opacity('A', 40, { pinnedArtistId: 'A' })).toBe(1);
  });
});

describe('chart worker: dates that skip calendar days', () => {
  it('blends over the real number of calendar days between the two dates', () => {
    // idx 0..2 = Jan 1..3, idx 3 = Jan 13 (10 days later); E is active Jan 1..3, B is #1
    handler({ data: { type: 'init-data', dates: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-13'], lines: [
      mk('B', [[0, 1000], [3, 2000]]),
      mk('E', [[0, 1], [1, 2], [2, 3]]),
    ] } });
    expect(opacity('E', 2, {}, 0)).toBe(1);
    const atNext = 1 - 3 / 21; // 10 days after Jan 3: 3 days into the ramp
    expect(opacity('E', 2, {}, 0.5)!).toBeCloseTo(1 + (atNext - 1) * 0.5, 9);
    expect(opacity('E', 2, {}, 1)!).toBeCloseTo(atNext, 9);
  });
  it('an unparseable next date is not blended (no mixed units)', () => {
    handler({ data: { type: 'init-data', dates: ['2024-01-01', 'not-a-date', '2024-01-03'], lines: [
      mk('B', [[0, 1000], [2, 2000]]),
      mk('E', [[0, 1]]),
    ] } });
    expect(opacity('E', 0, {}, 0.7)).toBe(opacity('E', 0, {}, 0));
  });
});
