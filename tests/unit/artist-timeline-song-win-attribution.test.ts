/**
 * @vitest-environment jsdom
 */

/**
 * Artist view: when two songs by the same artist chart on the same show and day
 * and one wins, only the winning song shows the inline crown, and the trophy row
 * credits that same song.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ArtistTimeline } from "../../src/views/artist-timeline.ts";
import { deriveTrophies } from "../../src/views/artist-trophies.ts";
import { computeChartWins, getWinningReleaseOnShow } from "../../src/chart-engine.ts";
import type { DataStore, ParsedArtist, ParsedRelease } from "../../src/models.ts";

const D = "2024-01-02";

function release(id: string, values: Record<string, [number, string]>): ParsedRelease {
  return {
    id,
    title: `Song ${id}`,
    artistIds: ["a"],
    embeds: new Map(),
    dailyValues: new Map(
      Object.entries(values).map(([d, [value, source]]) => [d, { value, source, episode: 7 }]),
    ),
  } as ParsedRelease;
}

function artist(id: string, releases: ParsedRelease[]): ParsedArtist {
  return {
    id, name: id, artistType: "girl_group", generation: 4, logoUrl: "", releases, albumReleases: [],
  } as ParsedArtist;
}

function buildStore(artists: ParsedArtist[]): DataStore {
  const dates = ["2024-01-01", D, "2024-01-03"];
  const ds: DataStore = {
    artists: new Map(artists.map((a) => [a.id, a])),
    dates, startDate: dates[0], endDate: dates[2],
    firstAppearance: new Map(), chartWins: new Map(), releaseWinDates: new Map(),
  };
  const w = computeChartWins(ds);
  ds.chartWins = w.chartWins;
  ds.releaseWinDates = w.releaseWinDates;
  return ds;
}

/** Titles of the song rows that carry an inline crown. */
function crownedTitles(container: HTMLElement): string[] {
  const out: string[] = [];
  container.querySelectorAll(".artist-timeline__song-line").forEach((row) => {
    if (row.querySelector(".artist-timeline__inline-crown")) {
      out.push(row.querySelector(".artist-timeline__song-title")!.textContent ?? "");
    }
  });
  return out;
}

describe("ArtistTimeline - per-song win credit", () => {
  let container: HTMLElement;
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); });

  it("crowns only the song that won when two songs chart on the same show and day", () => {
    // x beats the rival on D; y is the artist's weaker song on the same show.
    const a = artist("a", [
      release("y", { [D]: [60, "inkigayo"] }),
      release("x", { [D]: [90, "inkigayo"] }),
    ]);
    const rival = artist("rival", [release("r", { [D]: [70, "inkigayo"] })]);
    const ds = buildStore([a, rival]);

    const tl = new ArtistTimeline();
    tl.mount(container, ds, "a");
    expect(crownedTitles(container)).toEqual(["Song x"]);
    tl.unmount();
  });

  it("agrees with the trophy row on which song won", () => {
    const a = artist("a", [
      release("y", { [D]: [60, "inkigayo"] }),
      release("x", { [D]: [90, "inkigayo"] }),
    ]);
    const ds = buildStore([a]);
    const tl = new ArtistTimeline();
    tl.mount(container, ds, "a");
    const trophy = deriveTrophies(a, ds)[0];
    expect(crownedTitles(container)).toEqual([trophy.songTitle]);
    tl.unmount();
  });

  it("does not crown a song on a show the artist did not win", () => {
    // Wins on inkigayo with x; y only charted on music_bank where a rival won.
    const a = artist("a", [
      release("x", { [D]: [90, "inkigayo"] }),
      release("y", { [D]: [60, "music_bank"] }),
    ]);
    const rival = artist("rival", [release("r", { [D]: [70, "music_bank"] })]);
    const ds = buildStore([a, rival]);
    const tl = new ArtistTimeline();
    tl.mount(container, ds, "a");
    expect(crownedTitles(container)).toEqual(["Song x"]);
    tl.unmount();
  });

  it("crowns the highest-scoring song when releaseWinDates is missing (same as the trophy row)", () => {
    const a = artist("a", [
      release("y", { [D]: [60, "inkigayo"] }),
      release("x", { [D]: [90, "inkigayo"] }),
    ]);
    const ds = buildStore([a]);
    ds.releaseWinDates = new Map();
    const tl = new ArtistTimeline();
    tl.mount(container, ds, "a");
    expect(crownedTitles(container)).toEqual(["Song x"]);
    expect(deriveTrophies(a, ds)[0].songTitle).toBe("Song x");
    tl.unmount();
  });

  it("crowns nothing when a rival strictly outscores every song of the artist", () => {
    const a = artist("a", [
      release("x", { [D]: [50, "inkigayo"] }),
      release("y", { [D]: [90, "inkigayo"] }),
    ]);
    const rival = artist("rival", [release("r", { [D]: [100, "inkigayo"] })]);
    const ds = buildStore([a, rival]);
    const tl = new ArtistTimeline();
    tl.mount(container, ds, "a");
    expect(crownedTitles(container)).toEqual([]);
    expect(deriveTrophies(a, ds)).toEqual([]);
    tl.unmount();
  });
});

describe("getWinningReleaseOnShow", () => {
  it("returns the credited song and crown level, or undefined for a non-winner", () => {
    const a = artist("a", [
      release("y", { [D]: [60, "inkigayo"] }),
      release("x", { [D]: [90, "inkigayo"] }),
    ]);
    const rival = artist("rival", [release("r", { [D]: [70, "music_bank"] })]);
    const ds = buildStore([a, rival]);
    expect(getWinningReleaseOnShow(ds, a, D, "inkigayo")).toEqual({ releaseId: "x", crownLevel: 1 });
    expect(getWinningReleaseOnShow(ds, a, D, "music_bank")).toBeUndefined();
    expect(getWinningReleaseOnShow(ds, rival, D, "inkigayo")).toBeUndefined();
    expect(getWinningReleaseOnShow(ds, rival, D, "music_bank")).toEqual({ releaseId: "r", crownLevel: 1 });
  });

  it("credits the first song when an artist's own songs tie at the top", () => {
    const a = artist("a", [
      release("p", { [D]: [80, "inkigayo"] }),
      release("q", { [D]: [80, "inkigayo"] }),
    ]);
    const ds = buildStore([a]);
    expect(getWinningReleaseOnShow(ds, a, D, "inkigayo")?.releaseId).toBe("p");
    ds.releaseWinDates = new Map();
    expect(getWinningReleaseOnShow(ds, a, D, "inkigayo")?.releaseId).toBe("p");
  });

  it("works for an artist object that is not the store's own copy", () => {
    const a = artist("a", [release("x", { [D]: [90, "inkigayo"] })]);
    const ds = buildStore([a]);
    ds.artists = new Map();
    expect(getWinningReleaseOnShow(ds, a, D, "inkigayo")?.releaseId).toBe("x");
  });
});

describe("ArtistTimeline - crown level follows the song's win count", () => {
  let container: HTMLElement;
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); });

  it("shows the 2nd-win crown on the winning song only, and the trophy carries the same level", () => {
    const D2 = "2024-01-03";
    const a = artist("a", [
      release("x", { [D]: [90, "inkigayo"], [D2]: [95, "inkigayo"] }),
      release("y", { [D]: [60, "inkigayo"], [D2]: [65, "inkigayo"] }),
    ]);
    const ds = buildStore([a]);
    const tl = new ArtistTimeline();
    tl.mount(container, ds, "a");
    const crowns = Array.from(container.querySelectorAll<HTMLImageElement>(".artist-timeline__inline-crown"));
    expect(crowns.map((c) => c.alt).sort()).toEqual(["1 win(s)", "2 win(s)"]);
    expect(deriveTrophies(a, ds).map((t) => t.crownLevel)).toEqual([1, 2]);
    expect(crownedTitles(container)).toEqual(["Song x", "Song x"]);
    tl.unmount();
  });
});
