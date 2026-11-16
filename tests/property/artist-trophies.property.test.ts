import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { deriveTrophies } from "../../src/views/artist-trophies.ts";
import type { DataStore, ParsedArtist } from "../../src/models.ts";

const SOURCES = ["inkigayo", "the_show", "show_champion", "music_bank", "m_countdown", "show_music_core"];

const winsArb = fc.uniqueArray(
  fc.record({
    day: fc.integer({ min: 0, max: 2000 }),
    source: fc.constantFrom(...SOURCES),
  }),
  { selector: (w) => `${w.day}|${w.source}`, maxLength: 120 },
);

function isoDay(n: number): string {
  return new Date(Date.UTC(2015, 0, 1) + n * 86400000).toISOString().slice(0, 10);
}

function build(wins: Array<{ day: number; source: string }>) {
  const chartWins: DataStore["chartWins"] = new Map();
  for (const w of wins) {
    const d = isoDay(w.day);
    if (!chartWins.has(d)) chartWins.set(d, new Map());
    chartWins.get(d)!.set(w.source, { artistIds: ["a"], crownLevels: new Map([["a", 1]]) });
  }
  const artist = { id: "a", name: "A", releases: [], albumReleases: [] } as unknown as ParsedArtist;
  const store = {
    artists: new Map([["a", artist]]), dates: [], startDate: "", endDate: "",
    firstAppearance: new Map(), chartWins, releaseWinDates: new Map(),
  } as DataStore;
  return { artist, store };
}

describe("deriveTrophies ordering (property)", () => {
  it("is chronologically non-decreasing and loses no win", () => {
    fc.assert(
      fc.property(winsArb, (wins) => {
        const { artist, store } = build(wins);
        const t = deriveTrophies(artist, store);
        expect(t).toHaveLength(wins.length);
        for (let i = 1; i < t.length; i++) {
          expect(t[i - 1].date <= t[i].date).toBe(true);
          if (t[i - 1].date === t[i].date) expect(t[i - 1].source < t[i].source).toBe(true);
        }
      }),
    );
  });

  it("does not depend on the insertion order of the wins", () => {
    fc.assert(
      fc.property(winsArb, fc.integer(), (wins, seed) => {
        const shuffled = [...wins].sort((a, b) => ((a.day * 31 + seed) % 7) - ((b.day * 31 + seed) % 7));
        const a = build(wins);
        const b = build(shuffled);
        const key = (t: ReturnType<typeof deriveTrophies>) => t.map((x) => `${x.date}|${x.source}`);
        expect(key(deriveTrophies(b.artist, b.store))).toEqual(key(deriveTrophies(a.artist, a.store)));
      }),
    );
  });
});
