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

  it("shows winner with crown icon when chartWins entry exists", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    const winners = container.querySelectorAll(".episode-card__winner");
    // Only inkigayo ep 100 on Jan 7 has a winner
    expect(winners.length).toBe(1);

    const winnerText = winners[0].querySelector(".episode-card__winner-text");
    expect(winnerText?.textContent).toContain("Artist Beta");
    expect(winnerText?.textContent).toContain("Song B");

    const crownImg = winners[0].querySelector(".episode-card__crown") as HTMLImageElement;
    expect(crownImg.src).toContain("crown-3.svg");

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

  it("renders performances section when live_performance embeds exist", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    const perfToggles = container.querySelectorAll(".episode-card__performances-toggle");
    // Only inkigayo ep 100 on Jan 7 has a live performance
    expect(perfToggles.length).toBe(1);
    expect(perfToggles[0].textContent).toBe("Performances (1)");

    browser.unmount();
  });

  it("expands performances section on toggle click", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    const perfSection = container.querySelector(".episode-card__performances")!;
    const toggle = container.querySelector(".episode-card__performances-toggle") as HTMLButtonElement;

    expect(perfSection.classList.contains("episode-card__performances--open")).toBe(false);

    toggle.click();
    expect(perfSection.classList.contains("episode-card__performances--open")).toBe(true);

    toggle.click();
    expect(perfSection.classList.contains("episode-card__performances--open")).toBe(false);

    browser.unmount();
  });

  it("unmount clears container content", () => {
    const browser = new EpisodeBrowser();
    browser.mount(container, dataStore);

    expect(container.innerHTML).not.toBe("");
    browser.unmount();
    expect(container.innerHTML).toBe("");
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
