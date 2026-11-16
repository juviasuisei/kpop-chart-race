/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for the artist trophy row: derivation (order, attribution,
 * same-day wins, zero wins), rendered DOM / aria text, and header placement.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  deriveTrophies,
  formatTrophyLabel,
  createTrophyRow,
} from "../../src/views/artist-trophies.ts";
import { ArtistTimeline } from "../../src/views/artist-timeline.ts";
import type { DataStore, ParsedArtist } from "../../src/models.ts";

const LABELS: Record<string, string> = {
  inkigayo: "SBS Inkigayo",
  music_bank: "KBS Music Bank",
  m_countdown: "Mnet M Countdown",
};

type Win = { date: string; source: string; level?: number };

function makeArtist(
  dv: Array<{ title: string; date: string; source: string; episode: number; value: number }>,
): ParsedArtist {
  const byTitle = new Map<string, Map<string, { value: number; source: string; episode: number }>>();
  for (const d of dv) {
    if (!byTitle.has(d.title)) byTitle.set(d.title, new Map());
    byTitle.get(d.title)!.set(d.date, { value: d.value, source: d.source, episode: d.episode });
  }
  return {
    id: "a",
    name: "Artist A",
    artistType: "girl_group",
    generation: 4,
    logoUrl: "assets/logos/a.svg",
    releases: [...byTitle].map(([title, dailyValues]) => ({
      id: title.toLowerCase(),
      title,
      artistIds: ["a"],
      dailyValues,
      embeds: new Map(),
    })),
    albumReleases: [],
  } as unknown as ParsedArtist;
}

function makeStore(artist: ParsedArtist, wins: Win[]): DataStore {
  const chartWins: DataStore["chartWins"] = new Map();
  for (const w of wins) {
    if (!chartWins.has(w.date)) chartWins.set(w.date, new Map());
    chartWins.get(w.date)!.set(w.source, {
      artistIds: [artist.id],
      crownLevels: new Map([[artist.id, w.level ?? 1]]),
    });
  }
  return {
    artists: new Map([[artist.id, artist]]),
    dates: [],
    startDate: "",
    endDate: "",
    firstAppearance: new Map(),
    chartWins,
    releaseWinDates: new Map(),
  };
}

describe("deriveTrophies", () => {
  it("returns wins oldest first regardless of insertion order", () => {
    const artist = makeArtist([
      { title: "B", date: "2024-03-01", source: "inkigayo", episode: 3, value: 10 },
      { title: "A", date: "2024-01-01", source: "music_bank", episode: 1, value: 10 },
      { title: "C", date: "2024-02-01", source: "inkigayo", episode: 2, value: 10 },
    ]);
    const store = makeStore(artist, [
      { date: "2024-03-01", source: "inkigayo", level: 3 },
      { date: "2024-01-01", source: "music_bank", level: 1 },
      { date: "2024-02-01", source: "inkigayo", level: 2 },
    ]);
    const t = deriveTrophies(artist, store);
    expect(t.map((x) => x.date)).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
    expect(t.map((x) => x.songTitle)).toEqual(["A", "C", "B"]);
    expect(t.map((x) => x.crownLevel)).toEqual([1, 2, 3]);
  });

  it("attributes the song, show and episode of each win", () => {
    const artist = makeArtist([
      { title: "Supernova", date: "2024-01-15", source: "inkigayo", episode: 101, value: 8500 },
    ]);
    const [t] = deriveTrophies(artist, makeStore(artist, [{ date: "2024-01-15", source: "inkigayo" }]));
    expect(t).toMatchObject({ songTitle: "Supernova", source: "inkigayo", episode: 101, date: "2024-01-15" });
  });

  it("gives one trophy per show when two shows are won on the same day", () => {
    const artist = makeArtist([
      { title: "X", date: "2024-01-15", source: "music_bank", episode: 5, value: 1 },
      { title: "Y", date: "2024-01-15", source: "inkigayo", episode: 6, value: 1 },
    ]);
    const store = makeStore(artist, [
      { date: "2024-01-15", source: "music_bank" },
      { date: "2024-01-15", source: "inkigayo" },
    ]);
    const t = deriveTrophies(artist, store);
    expect(t).toHaveLength(2);
    // stable tie-break by source key
    expect(t.map((x) => x.source)).toEqual(["inkigayo", "music_bank"]);
    expect(t.map((x) => x.songTitle)).toEqual(["Y", "X"]);
  });

  it("picks the highest-scoring song when two songs charted on the winning show", () => {
    const artist = makeArtist([
      { title: "Low", date: "2024-01-15", source: "inkigayo", episode: 9, value: 100 },
      { title: "High", date: "2024-01-15", source: "inkigayo", episode: 9, value: 9000 },
    ]);
    const t = deriveTrophies(artist, makeStore(artist, [{ date: "2024-01-15", source: "inkigayo" }]));
    expect(t).toHaveLength(1);
    expect(t[0].songTitle).toBe("High");
  });

  it("ignores wins by other artists and honours the source filter", () => {
    const artist = makeArtist([
      { title: "A", date: "2024-01-01", source: "inkigayo", episode: 1, value: 1 },
      { title: "B", date: "2024-01-02", source: "music_bank", episode: 2, value: 1 },
    ]);
    const store = makeStore(artist, [
      { date: "2024-01-01", source: "inkigayo" },
      { date: "2024-01-02", source: "music_bank" },
    ]);
    store.chartWins.get("2024-01-02")!.get("music_bank")!.artistIds = ["someone-else"];
    expect(deriveTrophies(artist, store)).toHaveLength(1);
    expect(deriveTrophies(artist, store, "music_bank")).toHaveLength(0);
    expect(deriveTrophies(artist, store, "inkigayo")).toHaveLength(1);
  });

  it("falls back to a placeholder title when the winning song has no chart entry", () => {
    const artist = makeArtist([]);
    const [t] = deriveTrophies(artist, makeStore(artist, [{ date: "2024-01-01", source: "inkigayo" }]));
    expect(t.songTitle).toBe("Unknown song");
  });

  it("returns an empty list for an artist with zero wins", () => {
    const artist = makeArtist([{ title: "A", date: "2024-01-01", source: "inkigayo", episode: 1, value: 1 }]);
    expect(deriveTrophies(artist, makeStore(artist, []))).toEqual([]);
  });
});

describe("trophy row DOM", () => {
  const artist = makeArtist([
    { title: "Supernova", date: "2024-01-15", source: "inkigayo", episode: 101, value: 8500 },
    { title: "Drama", date: "2024-02-20", source: "music_bank", episode: 55, value: 7000 },
  ]);
  const store = makeStore(artist, [
    { date: "2024-01-15", source: "inkigayo", level: 1 },
    { date: "2024-02-20", source: "music_bank", level: 14 },
  ]);

  it("formats the label as Song - Show - Date", () => {
    const [t] = deriveTrophies(artist, store);
    expect(formatTrophyLabel(t, LABELS)).toBe("Supernova - SBS Inkigayo - Jan 15, 2024");
  });

  it("renders no row for zero wins", () => {
    expect(createTrophyRow([], LABELS)).toBeNull();
  });

  it("renders one focusable button per win with an aria-label, plus a count", () => {
    const row = createTrophyRow(deriveTrophies(artist, store), LABELS)!;
    const items = row.querySelectorAll<HTMLElement>(".artist-trophies__item");
    expect(items).toHaveLength(2);
    expect(items[0].tagName).toBe("BUTTON");
    expect(items[0].getAttribute("type")).toBe("button");
    expect(items[0].getAttribute("aria-label")).toBe("Supernova - SBS Inkigayo - Jan 15, 2024");
    expect(items[1].getAttribute("aria-label")).toBe("Drama - KBS Music Bank - Feb 20, 2024");
    expect(row.querySelector(".artist-trophies__count")?.textContent).toBe("2 wins");
  });

  it("uses singular 'win' for one trophy", () => {
    const row = createTrophyRow(deriveTrophies(artist, store).slice(0, 1), LABELS)!;
    expect(row.querySelector(".artist-trophies__count")?.textContent).toBe("1 win");
  });

  it("uses the crown icon for the win level, capped at 12", () => {
    const row = createTrophyRow(deriveTrophies(artist, store), LABELS)!;
    const imgs = row.querySelectorAll("img");
    expect(imgs[0].getAttribute("src")).toBe("assets/crowns/crown-1.svg");
    expect(imgs[1].getAttribute("src")).toBe("assets/crowns/crown-12.svg");
    expect(imgs[0].getAttribute("alt")).toBe("");
  });

  it("shows the tooltip on hover and on focus, hides on blur/leave, and toggles on tap", () => {
    const row = createTrophyRow(deriveTrophies(artist, store), LABELS)!;
    document.body.appendChild(row);
    const tip = row.querySelector<HTMLElement>(".artist-trophies__tip")!;
    const [a, b] = Array.from(row.querySelectorAll<HTMLElement>(".artist-trophies__item"));
    expect(tip.hidden).toBe(true);

    a.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe("Supernova - SBS Inkigayo - Jan 15, 2024");
    a.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    expect(tip.hidden).toBe(true);

    b.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(tip.textContent).toBe("Drama - KBS Music Bank - Feb 20, 2024");
    b.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(tip.hidden).toBe(true);

    a.click();
    expect(tip.hidden).toBe(false);
    a.click();
    expect(tip.hidden).toBe(true);

    a.click();
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(tip.hidden).toBe(true);
    row.remove();
  });

  it("treats song titles as text, never markup", () => {
    const evil = makeArtist([
      { title: "<img src=x onerror=alert(1)>", date: "2024-01-01", source: "inkigayo", episode: 1, value: 1 },
    ]);
    const row = createTrophyRow(
      deriveTrophies(evil, makeStore(evil, [{ date: "2024-01-01", source: "inkigayo" }])),
      LABELS,
    )!;
    expect(row.querySelectorAll("img")).toHaveLength(1); // only the crown icon
    expect(row.querySelector(".artist-trophies__item")!.getAttribute("aria-label")).toContain("<img");
  });
});

describe("ArtistTimeline header integration", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => container.remove());

  it("places the trophy row between the meta line and the stats grid", () => {
    const artist = makeArtist([
      { title: "Supernova", date: "2024-01-15", source: "inkigayo", episode: 101, value: 8500 },
    ]);
    const store = makeStore(artist, [{ date: "2024-01-15", source: "inkigayo" }]);
    new ArtistTimeline().mount(container, store, "a");
    const kids = Array.from(container.querySelector(".artist-timeline__header")!.children).map((c) => c.className);
    const meta = kids.indexOf("artist-timeline__meta");
    const trophies = kids.indexOf("artist-trophies");
    const stats = kids.indexOf("artist-timeline__stats");
    expect(meta).toBeGreaterThanOrEqual(0);
    expect(trophies).toBe(meta + 1);
    expect(stats).toBe(trophies + 1);
    expect(container.querySelector(".artist-trophies__item")!.getAttribute("aria-label")).toBe(
      "Supernova - SBS Inkigayo - Jan 15, 2024",
    );
  });

  it("renders no trophy row for an artist with zero wins", () => {
    const artist = makeArtist([{ title: "A", date: "2024-01-01", source: "inkigayo", episode: 1, value: 1 }]);
    new ArtistTimeline().mount(container, makeStore(artist, []), "a");
    expect(container.querySelector(".artist-trophies")).toBeNull();
  });

  it("follows the source filter", () => {
    const artist = makeArtist([
      { title: "A", date: "2024-01-01", source: "inkigayo", episode: 1, value: 1 },
      { title: "B", date: "2024-01-02", source: "music_bank", episode: 2, value: 1 },
    ]);
    const store = makeStore(artist, [
      { date: "2024-01-01", source: "inkigayo" },
      { date: "2024-01-02", source: "music_bank" },
    ]);
    const tl = new ArtistTimeline();
    tl.mount(container, store, "a");
    expect(container.querySelectorAll(".artist-trophies__item")).toHaveLength(2);
    tl.setSourceFilter("music_bank");
    expect(container.querySelectorAll(".artist-trophies__item")).toHaveLength(1);
  });
});
