/**
 * Tests for Episode Browser component.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EpisodeBrowser } from "../../src/views/episode-browser.ts";
import type { DataStore, ParsedArtist, ParsedRelease } from "../../src/models.ts";

function createMockDataStore(): DataStore {
  const release1: ParsedRelease = {
    id: "song-a",
    title: "Song A",
    dailyValues: new Map([
      ["2024-01-07", { value: 5000, source: "inkigayo", episode: 100 }],
      ["2024-01-14", { value: 3000, source: "inkigayo", episode: 101 }],
    ]),
    embeds: new Map([
      ["2024-01-07", [{ type: "live_performance", url: "https://www.youtube.com/watch?v=abc123" }]],
    ]),
    artistIds: ["artist-a"],
  };

  const release2: ParsedRelease = {
    id: "song-b",
    title: "Song B",
    dailyValues: new Map([
      ["2024-01-07", { value: 8000, source: "inkigayo", episode: 100 }],
      ["2024-01-07", { value: 8000, source: "inkigayo", episode: 100 }],
    ]),
    embeds: new Map(),
    artistIds: ["artist-b"],
  };

  const release3: ParsedRelease = {
    id: "song-c",
    title: "Song C",
    dailyValues: new Map([
      ["2024-01-07", { value: 6000, source: "music_bank", episode: 50 }],
    ]),
    embeds: new Map(),
    artistIds: ["artist-a"],
  };

  const artistA: ParsedArtist = {
    id: "artist-a",
    name: "Artist Alpha",
    artistType: "girl_group",
    generation: 4,
    logoUrl: "assets/logos/artist_a.svg",
    releases: [release1, release3],
    albumReleases: [],
  };

  const artistB: ParsedArtist = {
    id: "artist-b",
    name: "Artist Beta",
    artistType: "boy_group",
    generation: 4,
    logoUrl: "assets/logos/artist_b.svg",
    releases: [release2],
    albumReleases: [],
  };

  const artists = new Map<string, ParsedArtist>();
  artists.set("artist-a", artistA);
  artists.set("artist-b", artistB);

  // chartWins: 2024-01-07 inkigayo winner is artist-b
  const chartWins = new Map<string, Map<string, { artistIds: string[]; crownLevels: Map<string, number> }>>();
  const jan7Wins = new Map<string, { artistIds: string[]; crownLevels: Map<string, number> }>();
  jan7Wins.set("inkigayo", {
    artistIds: ["artist-b"],
    crownLevels: new Map([["artist-b", 3]]),
  });
  chartWins.set("2024-01-07", jan7Wins);

  return {
    artists,
    dates: ["2024-01-07", "2024-01-14"],
    startDate: "2024-01-07",
    endDate: "2024-01-14",
    firstAppearance: new Map([
      ["artist-a", "2024-01-07"],
      ["artist-b", "2024-01-07"],
    ]),
    chartWins,
    releaseWinDates: new Map(),
  };
}

describe("EpisodeBrowser", () => {
  let container: HTMLElement;
  let dataStore: DataStore;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    dataStore = createMockDataStore();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("mounts and renders episode cards", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    const cards = container.querySelectorAll(".episode-card");
    // 3 unique episodes: inkigayo ep 100 (Jan 7), inkigayo ep 101 (Jan 14), music_bank ep 50 (Jan 7)
    expect(cards.length).toBe(3);

    browser.unmount();
  });

  it("sorts episodes by date descending (most recent first)", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    const dates = container.querySelectorAll(".episode-card__date");
    const dateTexts = Array.from(dates).map(el => el.textContent);
    // Jan 14 should come first (most recent)
    expect(dateTexts[0]).toBe("2024-01-14");

    browser.unmount();
  });

  it("shows winner with crown icon on #1 rank entry", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    // The #1 entry on inkigayo ep 100 (Jan 7) should have a crown instead of rank number
    const crownImgs = container.querySelectorAll(".episode-card__crown");
    expect(crownImgs.length).toBeGreaterThanOrEqual(1);

    const firstCrown = crownImgs[0] as HTMLImageElement;
    expect(firstCrown.src).toContain("crown-3.svg");

    browser.unmount();
  });

  it("shows chart entries sorted by value descending", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    // Find the inkigayo ep 100 card (Jan 7, has 2 entries: artist-b at 8000, artist-a at 5000)
    const cards = container.querySelectorAll(".episode-card");
    // It's the second or third card depending on sorting; find by episode number
    let inkigayo100Card: Element | null = null;
    for (const card of cards) {
      const epNum = card.querySelector(".episode-card__episode-num");
      const showName = card.querySelector(".episode-card__show-name");
      if (epNum?.textContent === "Episode #100" && showName?.textContent === "SBS Inkigayo") {
        inkigayo100Card = card;
        break;
      }
    }

    expect(inkigayo100Card).not.toBeNull();
    const entries = inkigayo100Card!.querySelectorAll(".episode-card__chart-entry");
    expect(entries.length).toBe(2);

    // First entry should be the higher value (8000 - Artist Beta)
    const firstInfo = entries[0].querySelector(".episode-card__entry-info");
    expect(firstInfo?.textContent).toContain("Artist Beta");

    const secondInfo = entries[1].querySelector(".episode-card__entry-info");
    expect(secondInfo?.textContent).toContain("Artist Alpha");

    browser.unmount();
  });

  it("filters episodes by source", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    browser.setSourceFilter("music_bank");
    const cards = container.querySelectorAll(".episode-card");
    expect(cards.length).toBe(1);

    const showName = cards[0].querySelector(".episode-card__show-name");
    expect(showName?.textContent).toBe("KBS Music Bank");

    browser.unmount();
  });

  it("shows all episodes when filter is 'all'", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    browser.setSourceFilter("music_bank");
    browser.setSourceFilter("all");
    const cards = container.querySelectorAll(".episode-card");
    expect(cards.length).toBe(3);

    browser.unmount();
  });

  it("renders inline embeds for live performances", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    // inkigayo ep 100 on Jan 7 has a live performance embed
    const embeds = container.querySelectorAll(".episode-card__embed");
    expect(embeds.length).toBeGreaterThanOrEqual(1);

    const iframe = embeds[0].querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.src).toContain("youtube.com/embed");

    browser.unmount();
  });

  it("shows top 3 by default with expand toggle", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    // The expand toggle should not appear for episodes with <= 3 entries
    // In our test data, inkigayo ep 100 has 2 entries, so no toggle
    const toggles = container.querySelectorAll(".episode-card__expand-toggle");
    expect(toggles.length).toBe(0); // all episodes have ≤3 entries

    browser.unmount();
  });

  it("unmount clears container content", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    expect(container.innerHTML).not.toBe("");
    browser.unmount();
    expect(container.innerHTML).toBe("");
  });

  it("gives artist links a real href from artistUrl for new-tab support", () => {
    const browser = new EpisodeBrowser();
    browser.artistUrl = (id) => `https://example.test/#view=artist-timeline&artist=${id}`;
    browser.mount(container, dataStore);

    const link = container.querySelector(".episode-card__artist-link") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toContain("view=artist-timeline&artist=");

    browser.unmount();
  });

  it("intercepts a plain click (in-place nav) but lets a Cmd-click fall through to the browser", () => {
    const browser = new EpisodeBrowser();
    const clicked: string[] = [];
    browser.artistUrl = (id) => `https://example.test/#artist=${id}`;
    browser.onArtistClick = (id) => clicked.push(id);
    browser.mount(container, dataStore);

    const link = container.querySelector(".episode-card__artist-link") as HTMLAnchorElement;

    // Plain click: default prevented (no browser navigation) and in-place nav runs.
    const plain = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(clicked.length).toBe(1);

    // Cmd-click: default NOT prevented, so the browser opens the href in a new
    // tab; the in-place handler does not fire again.
    const cmd = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true });
    link.dispatchEvent(cmd);
    expect(cmd.defaultPrevented).toBe(false);
    expect(clicked.length).toBe(1);

    browser.unmount();
  });

  it("renders episode header with show logo, name, episode number, and date", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    const header = container.querySelector(".episode-card__header")!;
    const logo = header.querySelector(".episode-card__show-logo") as HTMLImageElement;
    expect(logo.src).toContain("inkigayo.png");

    const showName = header.querySelector(".episode-card__show-name");
    expect(showName?.textContent).toBeTruthy();

    const epNum = header.querySelector(".episode-card__episode-num");
    expect(epNum?.textContent).toMatch(/Episode #\d+/);

    const date = header.querySelector(".episode-card__date");
    expect(date?.textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    browser.unmount();
  });
});

// ============================================================
// Tie handling at the episode level (competition ranks + recency tie-break)
// ============================================================

describe("EpisodeBrowser — ties", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /**
   * One episode (inkigayo ep 200 on 2024-02-01) with scores 100, 90, 90, 80.
   * The two 90s belong to releases with different earliest-chart dates so we
   * can assert the recency tie-break (newer release ranks above older).
   */
  function makeTieStore(opts: { winnerArtistIds?: string[] } = {}): DataStore {
    const EP = { source: "inkigayo", episode: 200 };
    const D = "2024-02-01";

    // Top scorer (100)
    const top: ParsedRelease = {
      id: "r-top", title: "Top Song", artistIds: ["a-top"], embeds: new Map(),
      dailyValues: new Map([[D, { value: 100, ...EP }]]),
    };
    // Tie A (90) — older: also charted back in January
    const tieOld: ParsedRelease = {
      id: "r-old", title: "Old Song", artistIds: ["a-old"], embeds: new Map(),
      dailyValues: new Map([
        ["2024-01-01", { value: 50, ...EP, episode: 190 }],
        [D, { value: 90, ...EP }],
      ]),
    };
    // Tie B (90) — newer: first ever charted on this episode's date
    const tieNew: ParsedRelease = {
      id: "r-new", title: "New Song", artistIds: ["a-new"], embeds: new Map(),
      dailyValues: new Map([[D, { value: 90, ...EP }]]),
    };
    // Lowest (80)
    const low: ParsedRelease = {
      id: "r-low", title: "Low Song", artistIds: ["a-low"], embeds: new Map(),
      dailyValues: new Map([[D, { value: 80, ...EP }]]),
    };

    const mkArtist = (id: string, name: string, r: ParsedRelease): ParsedArtist => ({
      id, name, artistType: "girl_group", generation: 4,
      logoUrl: `assets/logos/${id}.svg`, releases: [r], albumReleases: [],
    });

    const artists = new Map<string, ParsedArtist>([
      ["a-top", mkArtist("a-top", "Top", top)],
      ["a-old", mkArtist("a-old", "Old", tieOld)],
      ["a-new", mkArtist("a-new", "New", tieNew)],
      ["a-low", mkArtist("a-low", "Low", low)],
    ]);

    const chartWins = new Map<string, Map<string, { artistIds: string[]; crownLevels: Map<string, number> }>>();
    if (opts.winnerArtistIds && opts.winnerArtistIds.length > 0) {
      const crownLevels = new Map<string, number>();
      for (const id of opts.winnerArtistIds) crownLevels.set(id, 1);
      chartWins.set(D, new Map([["inkigayo", { artistIds: opts.winnerArtistIds, crownLevels }]]));
    }

    return {
      artists,
      dates: ["2024-01-01", D],
      startDate: "2024-01-01",
      endDate: D,
      firstAppearance: new Map(),
      chartWins,
      releaseWinDates: new Map(),
    };
  }

  /** Find the inkigayo ep 200 card. */
  function tieCard(): Element {
    const cards = container.querySelectorAll(".episode-card");
    for (const card of cards) {
      if (card.querySelector(".episode-card__episode-num")?.textContent === "Episode #200") {
        return card;
      }
    }
    throw new Error("ep 200 card not found");
  }

  it("gives tied entries the same rank and uses competition numbering (1,2,2,4)", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, makeTieStore());

    const card = tieCard();
    const ranks = Array.from(card.querySelectorAll(".episode-card__chart-entry")).map(row => {
      const rankEl = row.querySelector(".episode-card__rank");
      return rankEl?.textContent ?? "";
    });

    // Scores 100, 90, 90, 80 → competition ranks #1, #2, #2, #4 (the tied
    // slot #3 is skipped, so the next distinct value takes #4).
    expect(ranks).toEqual(["#1", "#2", "#2", "#4"]);

    browser.unmount();
  });

  it("orders a tie group by recency (newer release on top)", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, makeTieStore());

    const card = tieCard();
    const infos = Array.from(card.querySelectorAll(".episode-card__entry-info")).map(
      el => el.textContent ?? "",
    );

    // The two 90-point songs tie; "New" (first charted 2024-02-01) is newer than
    // "Old" (first charted 2024-01-01), so New ranks above Old.
    const newIdx = infos.findIndex(t => t.includes("New"));
    const oldIdx = infos.findIndex(t => t.includes("Old"));
    expect(newIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBeLessThan(oldIdx);

    browser.unmount();
  });

  it("shows a crown for every entry tied for first", () => {
    // Both a-top and a second release tie for the top score, and both are winners.
    const ds = makeTieStore({ winnerArtistIds: ["a-top", "a-new"] });
    // Bump New Song to 100 so it ties a-top for first.
    const newRelease = ds.artists.get("a-new")!.releases[0];
    newRelease.dailyValues.set("2024-02-01", { value: 100, source: "inkigayo", episode: 200 });

    const browser = new EpisodeBrowser();
    browser.mount(container, ds);

    const card = tieCard();
    const rows = Array.from(card.querySelectorAll(".episode-card__chart-entry"));
    const crownOf = (row: Element) => row.querySelector(".episode-card__crown");
    const rankTextOf = (row: Element) => {
      // A plain rank label is a .episode-card__rank WITHOUT the --crown modifier.
      const el = row.querySelector(".episode-card__rank:not(.episode-card__rank--crown)");
      return el?.textContent ?? null;
    };

    // First two entries tie for #1 → both crowns, neither a "#1" text label.
    expect(crownOf(rows[0])).not.toBeNull();
    expect(crownOf(rows[1])).not.toBeNull();
    expect(rankTextOf(rows[0])).toBeNull();
    expect(rankTextOf(rows[1])).toBeNull();

    // Two entries tie for #1, so the tied slot #2 is skipped: the next entry
    // (90 pts) takes competition rank #3 with a plain label (no crown).
    expect(crownOf(rows[2])).toBeNull();
    expect(rankTextOf(rows[2])).toBe("#3");

    browser.unmount();
  });
});

// ============================================================
// Estimated (curve-filled) score styling
// ============================================================

describe("EpisodeBrowser — estimated scores", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /** Music Bank ep 10 with one real score and one estimated (filled) score. */
  function makeStore(): DataStore {
    const D = "2024-03-01";
    const EP = { source: "music_bank", episode: 10 };
    const real: ParsedRelease = {
      id: "r-real", title: "Real Song", artistIds: ["a-real"], embeds: new Map(),
      dailyValues: new Map([[D, { value: 1200, ...EP }]]),
    };
    const est: ParsedRelease = {
      id: "r-est", title: "Filled Song", artistIds: ["a-est"], embeds: new Map(),
      dailyValues: new Map([[D, { value: 900, ...EP, estimated: true }]]),
    };
    const mk = (id: string, name: string, r: ParsedRelease): ParsedArtist => ({
      id, name, artistType: "girl_group", generation: 4,
      logoUrl: `assets/logos/${id}.svg`, releases: [r], albumReleases: [],
    });
    return {
      artists: new Map<string, ParsedArtist>([
        ["a-real", mk("a-real", "Real", real)],
        ["a-est", mk("a-est", "Est", est)],
      ]),
      dates: [D], startDate: D, endDate: D,
      firstAppearance: new Map(), chartWins: new Map(), releaseWinDates: new Map(),
    };
  }

  it("flags estimated scores with the modifier class and a tooltip", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, makeStore());

    const est = container.querySelector(".episode-card__entry-points--estimated") as HTMLElement;
    expect(est).not.toBeNull();
    expect(est.textContent).toBe("900");
    expect(est.getAttribute("data-tooltip")).toMatch(/estimated/i);

    browser.unmount();
  });

  it("does not flag real (published) scores as estimated", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, makeStore());

    const allPoints = Array.from(container.querySelectorAll(".episode-card__entry-points"));
    const real = allPoints.find(el => el.textContent === "1,200") as HTMLElement;
    expect(real).toBeTruthy();
    expect(real.classList.contains("episode-card__entry-points--estimated")).toBe(false);
    expect(real.getAttribute("data-tooltip")).toBeNull();

    browser.unmount();
  });
});
