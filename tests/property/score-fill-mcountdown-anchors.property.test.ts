// Property tests: M Countdown fill with 1..3 real anchors.
//  - reals untouched; projected ranks strictly below the last real, strictly descending;
//  - ranks 3+ depend only on the real #2 when two reals are published;
//  - sentinel magnitudes are irrelevant: only their order matters.

import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { SCORE_FLOOR, fillMissingScores } from "../../src/airtable/score-fill.ts";
import type { ParsedArtist, ParsedRelease } from "../../src/models.ts";
import type { DailyValueEntry } from "../../src/types.ts";

function run(source: string, values: number[]): DailyValueEntry[] {
  const entries = values.map(v => ({ value: v, source, episode: 1 }) as DailyValueEntry);
  const releases: ParsedRelease[] = entries.map((e, i) => ({
    id: `r${i}`, title: `r${i}`, artistIds: ["a"], embeds: new Map(),
    dailyValues: new Map([["d", e]]),
  }));
  const a: ParsedArtist = {
    id: "a", name: "a", artistType: "solo", generation: 4,
    logoUrl: "x.svg", releases, albumReleases: [],
  };
  fillMissingScores(new Map([["a", a]]));
  return entries;
}

/** Strictly-descending positive reals, big enough to fit the descent above the floor. */
const realsArb = (n: number) =>
  fc.uniqueArray(fc.integer({ min: SCORE_FLOOR + 200, max: 30000 }), { minLength: n, maxLength: n })
    .map(xs => xs.sort((a, b) => b - a));

/** Distinct negative magnitudes, returned in rank order (closest to zero first). */
const sentinelsArb = (count: number) =>
  fc.uniqueArray(fc.integer({ min: 1, max: 100000 }), { minLength: count, maxLength: count })
    .map(xs => xs.sort((a, b) => a - b).map(x => -x));

const caseArb = fc.integer({ min: 1, max: 3 }).chain(nReal =>
  fc.integer({ min: 1, max: 18 - nReal + 1 }).chain(nSent =>
    fc.tuple(realsArb(nReal), sentinelsArb(nSent), sentinelsArb(nSent))));

describe("M Countdown multi-anchor fill properties", () => {
  it("keeps reals, projects strictly descending below the last real", () => {
    fc.assert(fc.property(caseArb, ([reals, sents]) => {
      const out = run("m_countdown", [...reals, ...sents]).map(e => e.value);
      expect(out.slice(0, reals.length)).toEqual(reals);
      const tail = out.slice(reals.length);
      expect(tail[0]).toBeLessThan(reals[reals.length - 1]);
      tail.forEach((v, i) => { if (i > 0) expect(v).toBeLessThan(tail[i - 1]); });
      expect(Math.min(...tail)).toBeGreaterThanOrEqual(SCORE_FLOOR);
    }));
  });

  it("only the order of the negative placeholders matters", () => {
    fc.assert(fc.property(caseArb, ([reals, a, b]) => {
      for (const source of ["m_countdown", "music_bank"]) {
        const x = run(source, [...reals, ...a]).map(e => e.value);
        const y = run(source, [...reals, ...b]).map(e => e.value);
        expect(x).toEqual(y);
      }
    }));
  });

  it("with two reals, ranks 3+ do not depend on the real #1", () => {
    fc.assert(fc.property(
      realsArb(2), fc.integer({ min: 1, max: 100000 }), sentinelsArb(5),
      ([r1, r2], bump, sents) => {
        const a = run("m_countdown", [r1, r2, ...sents]).map(e => e.value).slice(2);
        const b = run("m_countdown", [r1 + bump, r2, ...sents]).map(e => e.value).slice(2);
        expect(a).toEqual(b);
      },
    ));
  });

  it("one real value (older episodes) still projects below the real #1", () => {
    fc.assert(fc.property(realsArb(1), sentinelsArb(10), ([r1], sents) => {
      const out = run("m_countdown", [r1, ...sents]).map(e => e.value);
      expect(out.slice(1).every((v, i, xs) => v < (i === 0 ? r1 : xs[i - 1]))).toBe(true);
      expect(out[1]).toBeLessThan(r1);
    }));
  });
});
