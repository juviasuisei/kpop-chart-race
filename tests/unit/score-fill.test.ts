/**
 * Unit tests for deterministic score fill (src/airtable/score-fill.ts).
 *
 * Covers the fitted curves' exact expected outputs (locked against the values
 * confirmed during curve determination), strict-descending / floor behavior,
 * and the episode-grouping orchestrator (sentinel ordering, reals untouched,
 * multi-artist entry dedup).
 */

import { describe, it, expect } from "vitest";
import {
  SCORE_FLOOR,
  MCD_DESPIKE_FACTOR,
  enforceStrictDescending,
  fillMusicBankTail,
  fillMCountdown,
  fillMissingScores,
} from "../../src/airtable/score-fill.ts";
import type { ParsedArtist, ParsedRelease } from "../../src/models.ts";
import type { DailyValueEntry } from "../../src/types.ts";

const scores = (rows: Array<{ rank: number; score: number }>) => rows.map(r => r.score);
const strictlyDescending = (xs: number[]) => xs.every((v, i) => i === 0 || v < xs[i - 1]);

describe("fillMusicBankTail", () => {
  it("matches the confirmed values for ep 1304 (anchor #20=1272, ranks 21-30)", () => {
    const out = fillMusicBankTail(1272, 21, 30);
    expect(scores(out)).toEqual([1236, 1202, 1171, 1142, 1114, 1089, 1065, 1042, 1020, 1000]);
  });

  it("produces a strictly-decreasing tail below the real anchor", () => {
    const out = fillMusicBankTail(1272, 21, 50);
    expect(out[0].score).toBeLessThan(1272);
    expect(strictlyDescending(scores(out))).toBe(true);
  });

  it("first filled rank is strictly below the real anchor even for a shallow curve", () => {
    // Anchor small enough that the raw curve at rank 21 rounds back up to the anchor.
    const out = fillMusicBankTail(30, 21, 50);
    expect(out[0].score).toBeLessThan(30);
    expect(strictlyDescending(scores(out))).toBe(true);
  });

  it("reserves the floor for the last rank and never ties (stress: anchor 60, ranks 21-50)", () => {
    const out = fillMusicBankTail(60, 21, 50);
    expect(strictlyDescending(scores(out))).toBe(true);
    expect(out[out.length - 1].score).toBeGreaterThanOrEqual(SCORE_FLOOR);
    // No value below the floor.
    expect(Math.min(...scores(out))).toBeGreaterThanOrEqual(SCORE_FLOOR);
  });

  it("is deterministic", () => {
    expect(fillMusicBankTail(1319, 21, 50)).toEqual(fillMusicBankTail(1319, 21, 50));
  });
});

describe("fillMCountdown", () => {
  it("drops #2 by the 25% de-spike factor from the real #1", () => {
    const out = fillMCountdown(10286, 2, 20);
    // #2 anchored to implied #2 = real#1 * 0.75, then SMC ratio(2)=1.0.
    expect(out[0].rank).toBe(2);
    expect(out[0].score).toBe(Math.round(10286 * MCD_DESPIKE_FACTOR));
    expect(1 - out[0].score / 10286).toBeCloseTo(0.25, 2);
  });

  it("is strictly decreasing from #2 down and below the real #1", () => {
    const out = fillMCountdown(10286, 2, 20);
    expect(out[0].score).toBeLessThan(10286);
    expect(strictlyDescending(scores(out))).toBe(true);
  });

  it("is deterministic", () => {
    expect(fillMCountdown(8770, 2, 19)).toEqual(fillMCountdown(8770, 2, 19));
  });
});

describe("enforceStrictDescending", () => {
  it("caps each value strictly below the previous", () => {
    const out = enforceStrictDescending(
      [{ rank: 2, raw: 100 }, { rank: 3, raw: 100 }, { rank: 4, raw: 100 }],
      100, // prev real
      4,
    );
    expect(scores(out)).toEqual([99, 98, 97]);
  });

  it("does not flatten to a wall at the floor: fills with 1-step headroom to the last rank", () => {
    // Raw all far below floor; expect ...,16,15,14,13 near the end rather than 13,13,13,13.
    const slots = [];
    for (let r = 47; r <= 50; r++) slots.push({ rank: r, raw: 1 });
    const out = enforceStrictDescending(slots, 100, 50);
    expect(scores(out)).toEqual([16, 15, 14, 13]);
  });
});

// ── Orchestrator ────────────────────────────────────────────────────────────

function mkEntry(value: number, source: string, episode: number): DailyValueEntry {
  return { value, source, episode };
}

function mkArtist(id: string, releases: ParsedRelease[]): ParsedArtist {
  return {
    id, name: id, artistType: "girl_group", generation: 4,
    logoUrl: `assets/logos/${id}.svg`, releases, albumReleases: [],
  };
}

function mkRelease(id: string, artistIds: string[], entries: Array<[string, DailyValueEntry]>): ParsedRelease {
  return { id, title: id, artistIds, embeds: new Map(), dailyValues: new Map(entries) };
}

describe("fillMissingScores orchestrator", () => {
  it("fills music_bank sentinels and leaves real scores untouched", () => {
    // One MB episode: reals 1500,1400,1300 at ranks 1-3, sentinels -1,-2 for ranks 4-5.
    const eReal1 = mkEntry(1500, "music_bank", 1300);
    const eReal2 = mkEntry(1400, "music_bank", 1300);
    const eReal3 = mkEntry(1300, "music_bank", 1300);
    const eS1 = mkEntry(-1, "music_bank", 1300);
    const eS2 = mkEntry(-2, "music_bank", 1300);
    const artists = new Map<string, ParsedArtist>([
      ["a", mkArtist("a", [
        mkRelease("r1", ["a"], [["2026-01-01", eReal1]]),
        mkRelease("r2", ["a"], [["2026-01-01", eReal2]]),
        mkRelease("r3", ["a"], [["2026-01-01", eReal3]]),
        mkRelease("r4", ["a"], [["2026-01-01", eS1]]),
        mkRelease("r5", ["a"], [["2026-01-01", eS2]]),
      ])],
    ]);

    fillMissingScores(artists);

    // Reals unchanged and NOT flagged estimated.
    expect(eReal1.value).toBe(1500);
    expect(eReal2.value).toBe(1400);
    expect(eReal3.value).toBe(1300);
    expect(eReal1.estimated).toBeUndefined();
    // Sentinels replaced with strictly-descending positive scores below the last real (1300),
    // and flagged as estimated.
    expect(eS1.value).toBeGreaterThan(0);
    expect(eS1.value).toBeLessThan(1300);
    expect(eS2.value).toBeLessThan(eS1.value);
    expect(eS1.estimated).toBe(true);
    expect(eS2.estimated).toBe(true);
  });

  it("orders sentinels by value descending (-1 is the higher rank/score)", () => {
    const real = mkEntry(1000, "music_bank", 5);
    const s1 = mkEntry(-1, "music_bank", 5);
    const s2 = mkEntry(-2, "music_bank", 5);
    const s3 = mkEntry(-3, "music_bank", 5);
    const artists = new Map<string, ParsedArtist>([
      ["a", mkArtist("a", [
        mkRelease("r0", ["a"], [["d", real]]),
        // Deliberately out of order in the release list to prove ordering is by value.
        mkRelease("r3", ["a"], [["d", s3]]),
        mkRelease("r1", ["a"], [["d", s1]]),
        mkRelease("r2", ["a"], [["d", s2]]),
      ])],
    ]);

    fillMissingScores(artists);

    expect(s1.value).toBeGreaterThan(s2.value);
    expect(s2.value).toBeGreaterThan(s3.value);
    expect(s1.value).toBeLessThan(1000);
  });

  it("fills m_countdown with the de-spiked #2 anchor", () => {
    const real1 = mkEntry(8000, "m_countdown", 900);
    const s1 = mkEntry(-1, "m_countdown", 900); // rank 2
    const s2 = mkEntry(-2, "m_countdown", 900); // rank 3
    const artists = new Map<string, ParsedArtist>([
      ["a", mkArtist("a", [
        mkRelease("r0", ["a"], [["d", real1]]),
        mkRelease("r1", ["a"], [["d", s1]]),
        mkRelease("r2", ["a"], [["d", s2]]),
      ])],
    ]);

    fillMissingScores(artists);

    expect(real1.value).toBe(8000);
    expect(s1.value).toBe(Math.round(8000 * MCD_DESPIKE_FACTOR)); // #2 = 6000
    expect(s2.value).toBeLessThan(s1.value);
  });

  it("leaves other shows' sentinels alone (only MB/MCD are filled)", () => {
    // Inkigayo shouldn't be touched (it publishes full scores; no sentinels expected,
    // but if any negative slips through we must not fill it).
    const s = mkEntry(-1, "inkigayo", 100);
    const artists = new Map<string, ParsedArtist>([
      ["a", mkArtist("a", [mkRelease("r", ["a"], [["d", s]])])],
    ]);
    fillMissingScores(artists);
    expect(s.value).toBe(-1);
  });

  it("processes a multi-artist shared entry only once (no double fill)", () => {
    // A collab release shared by two artists: the SAME entry object appears in
    // both artists' release lists. Dedup by identity must fill it once.
    const real = mkEntry(2000, "music_bank", 7);
    const shared = mkEntry(-1, "music_bank", 7);
    const collabA = mkRelease("collab", ["a", "b"], [["d", shared]]);
    const collabB = mkRelease("collab", ["a", "b"], [["d", shared]]); // same entry object
    const artists = new Map<string, ParsedArtist>([
      ["a", mkArtist("a", [mkRelease("ra", ["a"], [["d", real]]), collabA])],
      ["b", mkArtist("b", [collabB])],
    ]);

    fillMissingScores(artists);

    expect(shared.value).toBeGreaterThan(0);
    expect(shared.value).toBeLessThan(2000);
  });

  it("is a no-op for an episode with no sentinels", () => {
    const r1 = mkEntry(500, "music_bank", 9);
    const r2 = mkEntry(400, "music_bank", 9);
    const artists = new Map<string, ParsedArtist>([
      ["a", mkArtist("a", [
        mkRelease("r1", ["a"], [["d", r1]]),
        mkRelease("r2", ["a"], [["d", r2]]),
      ])],
    ]);
    fillMissingScores(artists);
    expect(r1.value).toBe(500);
    expect(r2.value).toBe(400);
  });
});
