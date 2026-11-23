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
  ] } });
});

function opacity(id: string, d: number, extra: Record<string, unknown> = {}): number | undefined {
  posted.length = 0;
  handler({ data: { type: 'compute-frame', requestId: d, currentDateIndex: d,
    viewport: { startDateIndex: 0, endDateIndex: d, progressToNext: 0, width: 1000, height: 500, dpr: 1 },
    visibility: { filterCount: 0, artistFilterActive: false, selectedLineIds: [], ...extra } } });
  const r = posted.find(m => m.type === 'frame-result');
  return [...r.background, ...r.foreground, ...r.highlight].find((c: any) => c.lineId === id)?.opacity;
}

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
