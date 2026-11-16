/**
 * M Countdown now publishes its top 2 real scores (older episodes: only #1).
 * The fill for ranks 3+ must anchor on the real #2, not on a de-spiked #1.
 * Sentinel magnitudes (-1,-2,... vs -10,-20,...) only encode rank order.
 */

import { describe, it, expect } from "vitest";
import {
  MCD_DESPIKE_FACTOR,
  SMC_SHAPE_REL2,
  fillMissingScores,
} from "../../src/airtable/score-fill.ts";
import type { ParsedArtist, ParsedRelease } from "../../src/models.ts";
import type { DailyValueEntry } from "../../src/types.ts";

function mkEntry(value: number, source: string, episode: number): DailyValueEntry {
  return { value, source, episode };
}

/** One artist per entry; returns the entries in the order given. */
function fill(entries: DailyValueEntry[]): number[] {
  const releases: ParsedRelease[] = entries.map((e, i) => ({
    id: `r${i}`, title: `r${i}`, artistIds: ["a"], embeds: new Map(),
    dailyValues: new Map([["2026-01-01", e]]),
  }));
  const a: ParsedArtist = {
    id: "a", name: "a", artistType: "girl_group", generation: 4,
    logoUrl: "assets/logos/a.svg", releases, albumReleases: [],
  };
  fillMissingScores(new Map([["a", a]]));
  return entries.map(e => e.value);
}

const mcd = (reals: number[], sentinels: number[]) =>
  [...reals, ...sentinels].map(v => mkEntry(v, "m_countdown", 1200));

describe("M Countdown with two real anchors", () => {
  it("anchors ranks 3+ on the real #2 (real-shaped episode 8770 / 6410)", () => {
    const sentinels = Array.from({ length: 17 }, (_, i) => -(i + 1));
    const out = fill(mcd([8770, 6410], sentinels));
    expect(out.slice(0, 2)).toEqual([8770, 6410]);
    expect(out.slice(2)).toEqual([
      5420, 4603, 3783, 3422, 2858, 2533, 2094, 1638, 1489, 1369, 1218, 1091,
      1041, 954, 855, 811, 762,
    ]);
  });

  it("is independent of the real #1 once #2 is known", () => {
    const s = [-1, -2, -3, -4];
    expect(fill(mcd([20000, 6410], s)).slice(2)).toEqual(fill(mcd([6500, 6410], s)).slice(2));
  });

  it("stays below a low real #2 (no value above the real #2)", () => {
    const out = fill(mcd([8770, 5000], [-1, -2, -3]));
    expect(out.slice(2)).toEqual([4228, 3591, 2951]);
  });

  it("flags only the projected ranks as estimated", () => {
    const es = mcd([8770, 6410], [-1, -2]);
    fill(es);
    expect(es.map(e => e.estimated)).toEqual([undefined, undefined, true, true]);
  });

  it("handles a tie between real #1 and #2 (ranks 3+ strictly below)", () => {
    const out = fill(mcd([7000, 7000], [-1, -2, -3]));
    expect(out.slice(0, 2)).toEqual([7000, 7000]);
    expect(out[2]).toBeLessThan(7000);
    expect(out[3]).toBeLessThan(out[2]);
    expect(out[4]).toBeLessThan(out[3]);
  });

  it("with three real values anchors on the last real", () => {
    const out = fill(mcd([8770, 6410, 5200], [-1, -2, -3]));
    expect(out.slice(3)).toEqual([4416, 3629, 3283]);
  });

  it("sorts the real values itself (arrival order does not matter)", () => {
    const s = [-1, -2, -3];
    expect(fill(mcd([6410, 8770], s))).toEqual(fill(mcd([8770, 6410], s)).map((v, i) => i < 2 ? [6410, 8770][i] : v));
  });

  it("past the 20-rank shape table still strictly descends below the real #2", () => {
    const sentinels = Array.from({ length: 28 }, (_, i) => -(i + 1)); // ranks 3..30
    const out = fill(mcd([8770, 6410], sentinels)).slice(2);
    expect(out[0]).toBeLessThan(6410);
    out.forEach((v, i) => { if (i > 0) expect(v).toBeLessThan(out[i - 1]); });
  });

  it("works when the only sentinel is rank 3", () => {
    expect(fill(mcd([8770, 6410], [-1])).slice(2)).toEqual([5420]);
  });
});

describe("M Countdown with only one real value (older episodes) is unchanged", () => {
  it("keeps the de-spiked #2 anchor", () => {
    const out = fill(mcd([8000], [-1, -2, -3]));
    expect(out[1]).toBe(Math.round(8000 * MCD_DESPIKE_FACTOR));
    expect(out[2]).toBe(Math.round(8000 * MCD_DESPIKE_FACTOR * SMC_SHAPE_REL2[3]));
  });
});

describe("Music Bank keeps the one-anchor behaviour", () => {
  it("still anchors on the last real value regardless of the first two", () => {
    const mk = (r: number[]) => [...r, -1, -2].map(v => mkEntry(v, "music_bank", 1300));
    const a = fill(mk([1500, 1400, 1300]));
    const b = fill(mk([9000, 1450, 1300]));
    expect(a.slice(3)).toEqual(b.slice(3));
  });
});

describe("sentinel magnitude does not matter, only order", () => {
  const reals = [8770, 6410];
  it("-1/-2/-3 and -10/-20/-30 give identical output", () => {
    expect(fill(mcd(reals, [-1, -2, -3]))).toEqual(fill(mcd(reals, [-10, -20, -30])));
  });
  it("is the same for 1-real episodes", () => {
    expect(fill(mcd([8000], [-1, -2, -3]))).toEqual(fill(mcd([8000], [-10, -20, -30])));
  });
  it("is the same for Music Bank", () => {
    const mb = (s: number[]) => [1500, 1400, ...s].map(v => mkEntry(v, "music_bank", 1300));
    expect(fill(mb([-1, -2, -3]))).toEqual(fill(mb([-10, -20, -30])));
  });
  it("order is by value descending even if rows arrive shuffled", () => {
    const shuffled = fill(mcd(reals, [-30, -10, -20]));
    const sorted = fill(mcd(reals, [-10, -20, -30]));
    // -10 is rank 3, -20 rank 4, -30 rank 5 in both.
    expect(shuffled[3]).toBe(sorted[2]);
    expect(shuffled[4]).toBe(sorted[3]);
    expect(shuffled[2]).toBe(sorted[4]);
  });
});
