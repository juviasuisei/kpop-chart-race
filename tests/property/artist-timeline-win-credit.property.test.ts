/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { ArtistTimeline } from "../../src/views/artist-timeline.ts";
import { deriveTrophies } from "../../src/views/artist-trophies.ts";
import { computeChartWins, getReleaseWinOnDate } from "../../src/chart-engine.ts";
import type { DataStore, ParsedArtist } from "../../src/models.ts";

const D = "2024-01-02";
const DATES = ["2024-01-01", D, "2024-01-03"];

// N songs of artist "a" on one show/day (scores), plus an optional rival score.
const arb = fc.record({
  scores: fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 5 }),
  rival: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }),
});

function build(scores: number[], rival?: number): { ds: DataStore; a: ParsedArtist } {
  const mk = (id: string, aid: string, v: number) => ({
    id, title: `S${id}`, artistIds: [aid], embeds: new Map(),
    dailyValues: new Map([[D, { value: v, source: "inkigayo", episode: 1 }]]),
  });
  const a = {
    id: "a", name: "a", artistType: "girl_group", generation: 4, logoUrl: "", albumReleases: [],
    releases: scores.map((v, i) => mk(`r${i}`, "a", v)),
  } as unknown as ParsedArtist;
  const artists = new Map<string, ParsedArtist>([["a", a]]);
  if (rival !== undefined) {
    artists.set("rv", {
      id: "rv", name: "rv", artistType: "solo", generation: 4, logoUrl: "", albumReleases: [],
      releases: [mk("rv0", "rv", rival)],
    } as unknown as ParsedArtist);
  }
  const ds: DataStore = {
    artists, dates: DATES, startDate: DATES[0], endDate: DATES[2],
    firstAppearance: new Map(), chartWins: new Map(), releaseWinDates: new Map(),
  };
  const w = computeChartWins(ds);
  ds.chartWins = w.chartWins;
  ds.releaseWinDates = w.releaseWinDates;
  return { ds, a };
}

describe("artist view win trophy per song", () => {
  it("at most one song is crowned per show/day, it is the credited song, and it matches the trophy row", () => {
    fc.assert(fc.property(arb, ({ scores, rival }) => {
      const { ds, a } = build(scores, rival);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const tl = new ArtistTimeline();
      tl.mount(container, ds, "a");
      const crowned: string[] = [];
      container.querySelectorAll(".artist-timeline__song-line").forEach((row) => {
        if (row.querySelector(".artist-timeline__inline-crown")) {
          crowned.push(row.querySelector(".artist-timeline__song-title")!.textContent!);
        }
      });
      tl.unmount();
      document.body.removeChild(container);

      const credited = a.releases.filter((r) => getReleaseWinOnDate(ds, "a", r.id, D, "inkigayo")).map((r) => r.title);
      // Independent oracle: the artist wins iff its best score is not strictly beaten, and the
      // credited song is its first highest-scoring one.
      const best = Math.max(...scores);
      const expected = rival !== undefined && rival > best ? [] : [`Sr${scores.indexOf(best)}`];
      expect(credited).toEqual(expected);
      expect(crowned.length).toBeLessThanOrEqual(1);
      expect(crowned).toEqual(credited);
      const trophies = deriveTrophies(a, ds);
      expect(trophies.map((t) => t.songTitle)).toEqual(credited);
    }), { numRuns: 150 });
  });
});
