/**
 * Regression from real published M Countdown data (episodes #925, #941, #942:
 * two real values + 18 placeholders). With the old #1-anchored fill, projected
 * #3 landed ABOVE the real #2 on exactly these episodes. Ranks 3+ must sit
 * below the real #2, strictly descend, and be anchored on the real #2.
 * (The episode number is only the grouping key; results do not depend on it.)
 */

import { describe, it, expect } from "vitest";
import { SMC_SHAPE_REL2, fillMissingScores } from "../../src/airtable/score-fill.ts";
import type { ParsedArtist, ParsedRelease } from "../../src/models.ts";
import type { DailyValueEntry } from "../../src/types.ts";

function fillEntries(values: number[], episode: number): DailyValueEntry[] {
  const entries: DailyValueEntry[] = values.map(value => ({ value, source: "m_countdown", episode }));
  const releases: ParsedRelease[] = entries.map((e, i) => ({
    id: `r${i}`, title: `r${i}`, artistIds: ["a"], embeds: new Map(),
    dailyValues: new Map([["2026-01-01", e]]),
  }));
  const a: ParsedArtist = {
    id: "a", name: "a", artistType: "girl_group", generation: 4,
    logoUrl: "assets/logos/a.svg", releases, albumReleases: [],
  };
  fillMissingScores(new Map([["a", a]]));
  return entries;
}

const placeholders = (): number[] => Array.from({ length: 18 }, (_, i) => -(i + 1));

describe("SMC shape table pins (guards silent edits of the curve)", () => {
  it("has the expected anchor and endpoints", () => {
    expect(SMC_SHAPE_REL2[2]).toBe(1.0);
    expect(SMC_SHAPE_REL2[3]).toBe(0.8456);
    expect(SMC_SHAPE_REL2[20]).toBe(0.1108);
  });
});

// [episode, real #1, real #2, literal projected #3, literal projected #20]
describe.each([
  [925, 10700, 4108, 3474, 455],
  [941, 8770, 5406, 4571, 599],
  [942, 10286, 6055, 5120, 671],
])("real M Countdown episode #%i (%i / %i)", (episode, r1, r2, lit3, lit20) => {
  it("keeps real values untouched and flags only the placeholders as estimated", () => {
    const entries = fillEntries([r1, r2, ...placeholders()], episode);
    expect(entries.slice(0, 2).map(e => e.value)).toEqual([r1, r2]);
    expect(entries.slice(0, 2).every(e => e.estimated !== true)).toBe(true);
    expect(entries.slice(2).every(e => e.estimated === true)).toBe(true);
  });

  it("puts every projected rank below the real #2, strictly descending, integers", () => {
    const projected = fillEntries([r1, r2, ...placeholders()], episode).slice(2).map(e => e.value);
    expect(projected).toHaveLength(18);
    expect(projected[0]).toBeLessThan(r2);
    for (let i = 1; i < projected.length; i++) expect(projected[i]).toBeLessThan(projected[i - 1]);
    expect(projected.every(Number.isInteger)).toBe(true);
    expect(projected[17]).toBeGreaterThanOrEqual(Math.round(r2 * SMC_SHAPE_REL2[20]));
  });

  it("anchors ALL projected ranks on the real #2 via the SMC shape", () => {
    const out = fillEntries([r1, r2, ...placeholders()], episode).map(e => e.value);
    for (let rank = 3; rank <= 20; rank++) {
      expect(out[rank - 1]).toBe(Math.round(r2 * SMC_SHAPE_REL2[rank] / SMC_SHAPE_REL2[2]));
    }
  });

  it("matches literal values from the real run (independent of the shape table)", () => {
    const out = fillEntries([r1, r2, ...placeholders()], episode).map(e => e.value);
    expect(out[2]).toBe(lit3);
    expect(out[19]).toBe(lit20);
  });

  it("is independent of input order and placeholder magnitude", () => {
    const sentinels = placeholders().map(v => v * 10); // -10 ... -180
    const shuffled = [sentinels[5], r2, sentinels[0], ...sentinels.slice(6), r1, ...sentinels.slice(1, 5)];
    const entries = fillEntries(shuffled, episode);
    const expected = fillEntries([r1, r2, ...placeholders()], episode + 1).map(e => e.value);
    const byOriginal = new Map(shuffled.map((orig, i) => [orig, entries[i].value]));
    expect(byOriginal.get(r1)).toBe(r1);
    expect(byOriginal.get(r2)).toBe(r2);
    // sentinel -10 is the highest missing rank (#3), -180 the lowest (#20)
    sentinels.forEach((s, i) => expect(byOriginal.get(s)).toBe(expected[i + 2]));
  });
});
