/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for the Artist Timeline view.
 * Tests: rendering, date grouping, entry sorting, header stats, and unmounting.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ArtistTimeline } from "../../src/views/artist-timeline.ts";
import type { DataStore, ParsedArtist } from "../../src/models.ts";

function createMockDataStore(artists: Map<string, ParsedArtist>): DataStore {
  const dates: string[] = [];
  const firstAppearance = new Map<string, string>();

  // Build chartWins map
  const chartWins = new Map<string, Map<string, { artistIds: string[]; crownLevels: Map<string, number> }>>();

  // For testing: aespa wins on 2024-01-15 on inkigayo
  const dateWins = new Map<string, { artistIds: string[]; crownLevels: Map<string, number> }>();
  const crownLevels = new Map<string, number>();
  crownLevels.set("aespa", 3);
  dateWins.set("inkigayo", { artistIds: ["aespa"], crownLevels });
  chartWins.set("2024-01-15", dateWins);

  for (const [id, artist] of artists) {
    for (const release of artist.releases) {
      for (const date of release.dailyValues.keys()) {
        if (!dates.includes(date)) dates.push(date);
        if (!firstAppearance.has(id) || date < firstAppearance.get(id)!) {
          firstAppearance.set(id, date);
        }
      }
    }
  }
  dates.sort();

  return {
    artists,
    dates,
    startDate: dates[0] ?? "",
    endDate: dates[dates.length - 1] ?? "",
    firstAppearance,
    chartWins,
    releaseWinDates: new Map(),
  };
}

function createTestArtist(): ParsedArtist {
  return {
    id: "aespa",
    name: "aespa",
    artistType: "girl_group",
    generation: 4,
    logoUrl: "assets/logos/aespa.svg",
    releases: [
      {
        id: "supernova",
        title: "Supernova",
        artistIds: ["aespa"],
        dailyValues: new Map([
          ["2024-01-15", { value: 8500, source: "inkigayo", episode: 101 }],
          ["2024-01-22", { value: 6200, source: "music_bank", episode: 55 }],
        ]),
        embeds: new Map([
          [
            "2024-01-10",
            [{ type: "mv" as const, url: "https://www.youtube.com/watch?v=abc123def45" }],
          ],
          [
            "2024-01-15",
            [{ type: "live_performance" as const, url: "https://www.youtube.com/watch?v=xyz789abc12" }],
          ],
        ]),
      },
      {
        id: "drama",
        title: "Drama",
        artistIds: ["aespa"],
        dailyValues: new Map([
          ["2023-11-20", { value: 5000, source: "m_countdown", episode: 200 }],
        ]),
        embeds: new Map([
          [
            "2023-11-15",
            [{ type: "release_date" as const, url: "" }],
          ],
        ]),
      },
    ],
    albumReleases: [],
  };
}

describe("ArtistTimeline — Rendering", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("mounts and renders artist header with name, type, and generation", () => {
    const artist = createTestArtist();
    const artists = new Map([["aespa", artist]]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    const header = container.querySelector(".artist-timeline__header");
    expect(header).not.toBeNull();

    const name = container.querySelector(".artist-timeline__name");
    expect(name?.textContent).toBe("aespa");

    const meta = container.querySelector(".artist-timeline__meta");
    expect(meta?.textContent).toContain("Girl Group");
    expect(meta?.textContent).toContain("Gen 4");

    timeline.unmount();
  });

  it("renders artist logo in header", () => {
    const artist = createTestArtist();
    const artists = new Map([["aespa", artist]]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    const logo = container.querySelector(".artist-timeline__logo") as HTMLImageElement;
    expect(logo).not.toBeNull();
    expect(logo.src).toContain("assets/logos/aespa.svg");

    timeline.unmount();
  });

  it("renders stats summary with total points, wins, releases, and active period", () => {
    const artist = createTestArtist();
    const artists = new Map([["aespa", artist]]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    const stats = container.querySelector(".artist-timeline__stats");
    expect(stats).not.toBeNull();

    // Total points: 8500 + 6200 + 5000 = 19700
    expect(stats?.textContent).toContain("19,700");

    // 1 win
    expect(stats?.textContent).toContain("1");

    // 2 releases
    expect(stats?.textContent).toContain("2");

    timeline.unmount();
  });

  it("groups entries by date with date headers in reverse chronological order", () => {
    const artist = createTestArtist();
    const artists = new Map([["aespa", artist]]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    const dateHeaders = container.querySelectorAll(".artist-timeline__date-header");
    expect(dateHeaders.length).toBeGreaterThanOrEqual(4);

    // First header should be most recent date (2024-01-22)
    expect(dateHeaders[0].textContent).toContain("2024");

    timeline.unmount();
  });

  it("highlights win entries with special class", () => {
    const artist = createTestArtist();
    const artists = new Map([["aespa", artist]]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    const winEntries = container.querySelectorAll(".artist-timeline__entry--win");
    expect(winEntries.length).toBeGreaterThanOrEqual(1);

    timeline.unmount();
  });

  it("renders crown icon for win entries", () => {
    const artist = createTestArtist();
    const artists = new Map([["aespa", artist]]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    const crownImg = container.querySelector(".artist-timeline__crown img") as HTMLImageElement;
    expect(crownImg).not.toBeNull();
    expect(crownImg.src).toContain("crown-3.svg");

    timeline.unmount();
  });

  it("renders YouTube embeds for non-release_date embed entries", () => {
    const artist = createTestArtist();
    const artists = new Map([["aespa", artist]]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    const iframes = container.querySelectorAll(".artist-timeline__embed iframe");
    // MV embed + live performance embed = 2
    expect(iframes.length).toBe(2);

    // Check that the MV iframe has YouTube embed URL
    const mvIframe = iframes[0] as HTMLIFrameElement;
    expect(mvIframe.src).toContain("youtube.com/embed/");

    timeline.unmount();
  });

  it("does not render iframe for release_date embed type", () => {
    const artist = createTestArtist();
    const artists = new Map([["aespa", artist]]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    // There should be a "release_date" type label but no iframe for it
    const embedTypes = container.querySelectorAll(".artist-timeline__embed-type");
    let hasReleaseDate = false;
    embedTypes.forEach((el) => {
      if (el.textContent?.toLowerCase().includes("release date")) {
        hasReleaseDate = true;
        // The next sibling should NOT be an embed with iframe
        const parent = el.parentElement!;
        const iframe = parent.querySelector(".artist-timeline__embed iframe");
        expect(iframe).toBeNull();
      }
    });
    expect(hasReleaseDate).toBe(true);

    timeline.unmount();
  });

  it("shows chart source logo and episode number", () => {
    const artist = createTestArtist();
    const artists = new Map([["aespa", artist]]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    const sourceLogo = container.querySelector(".artist-timeline__source-logo") as HTMLImageElement;
    expect(sourceLogo).not.toBeNull();

    const showText = container.querySelector(".artist-timeline__show-text");
    expect(showText?.textContent).toContain("Ep.");

    timeline.unmount();
  });
});

describe("ArtistTimeline — setArtist", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("switches to a different artist when setArtist is called", () => {
    const aespa = createTestArtist();
    const bts: ParsedArtist = {
      id: "bts",
      name: "BTS",
      artistType: "boy_group",
      generation: 3,
      logoUrl: "assets/logos/bts.svg",
      releases: [
        {
          id: "dynamite",
          title: "Dynamite",
          artistIds: ["bts"],
          dailyValues: new Map([
            ["2023-05-01", { value: 9000, source: "inkigayo", episode: 80 }],
          ]),
          embeds: new Map(),
        },
      ],
      albumReleases: [],
    };

    const artists = new Map([
      ["aespa", aespa],
      ["bts", bts],
    ]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    expect(container.querySelector(".artist-timeline__name")?.textContent).toBe("aespa");

    timeline.setArtist("bts");

    expect(container.querySelector(".artist-timeline__name")?.textContent).toBe("BTS");

    timeline.unmount();
  });

  it("does not re-render if same artist is set again", () => {
    const artist = createTestArtist();
    const artists = new Map([["aespa", artist]]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    const headerBefore = container.querySelector(".artist-timeline__header");

    timeline.setArtist("aespa"); // same artist

    const headerAfter = container.querySelector(".artist-timeline__header");
    // Should be the same DOM element (no re-render)
    expect(headerBefore).toBe(headerAfter);

    timeline.unmount();
  });
});

describe("ArtistTimeline — Unmount", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("clears container on unmount", () => {
    const artist = createTestArtist();
    const artists = new Map([["aespa", artist]]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    expect(container.innerHTML).not.toBe("");

    timeline.unmount();

    expect(container.innerHTML).toBe("");
  });

  it("shows error message for unknown artist", () => {
    const artists = new Map<string, ParsedArtist>();
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "unknown_artist");

    const prompt = container.querySelector(".artist-timeline__prompt");
    expect(prompt).not.toBeNull();
    expect(prompt?.textContent).toContain("not found");

    timeline.unmount();
  });
});

describe("ArtistTimeline — Entry Sorting", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("sorts wins before non-wins within same date", () => {
    const artist: ParsedArtist = {
      id: "aespa",
      name: "aespa",
      artistType: "girl_group",
      generation: 4,
      logoUrl: "assets/logos/aespa.svg",
      releases: [
        {
          id: "supernova",
          title: "Supernova",
          artistIds: ["aespa"],
          dailyValues: new Map([
            ["2024-01-15", { value: 8500, source: "inkigayo", episode: 101 }],
          ]),
          embeds: new Map(),
        },
        {
          id: "drama",
          title: "Drama",
          artistIds: ["aespa"],
          dailyValues: new Map([
            ["2024-01-15", { value: 5000, source: "music_bank", episode: 55 }],
          ]),
          embeds: new Map(),
        },
      ],
      albumReleases: [],
    };

    const artists = new Map([["aespa", artist]]);
    const dataStore = createMockDataStore(artists);

    const timeline = new ArtistTimeline();
    timeline.mount(container, dataStore, "aespa");

    // The 2024-01-15 date group should have the win entry first
    const dateGroups = container.querySelectorAll(".artist-timeline__date-group");
    // Find the Jan 15 group (should be first since it's most recent with chart data on same day)
    const jan15Group = dateGroups[0];
    const entries = jan15Group.querySelectorAll(".artist-timeline__entry");
    // First entry should be the win
    expect(entries[0].classList.contains("artist-timeline__entry--win")).toBe(true);

    timeline.unmount();
  });
});
