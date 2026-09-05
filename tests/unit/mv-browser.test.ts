/**
 * Tests for the MV Browser component.
 *
 * An MV is a release carrying an `mv` embed; the MV's date is that embed's
 * date key. MVs are grouped into date cards. Date cards follow the shared
 * date-sort direction; WITHIN a date, MVs are ALWAYS ordered by the release's
 * total chart score (sum of daily values) descending.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MvBrowser } from "../../src/views/mv-browser.ts";
import type { DataStore, ParsedArtist, ParsedRelease } from "../../src/models.ts";

function mkArtist(
  id: string,
  name: string,
  generation: number,
  releases: ParsedRelease[],
): ParsedArtist {
  return {
    id,
    name,
    artistType: "girl_group",
    generation,
    logoUrl: `assets/logos/${id}.svg`,
    releases,
    albumReleases: [],
  };
}

/**
 * Mock store with three MVs:
 * - "High" (artist-a, gen 4): MV on 2024-02-01, total score 100+50 = 150
 * - "Low"  (artist-b, gen 4): MV on 2024-02-01, total score 60
 * - "Old"  (artist-a, gen 4): MV on 2024-01-01, total score 200
 * Plus a release with NO mv embed (should be ignored).
 */
function createMockDataStore(): DataStore {
  const high: ParsedRelease = {
    id: "r-high",
    title: "High Song",
    artistIds: ["artist-a"],
    dailyValues: new Map([
      ["2024-02-05", { value: 100, source: "inkigayo", episode: 1 }],
      ["2024-02-12", { value: 50, source: "inkigayo", episode: 2 }],
    ]),
    embeds: new Map([
      ["2024-02-01", [{ type: "mv", url: "https://youtu.be/AAAAAAAAAAA" }]],
    ]),
  };

  const low: ParsedRelease = {
    id: "r-low",
    title: "Low Song",
    artistIds: ["artist-b"],
    dailyValues: new Map([
      ["2024-02-05", { value: 60, source: "inkigayo", episode: 1 }],
    ]),
    embeds: new Map([
      ["2024-02-01", [{ type: "mv", url: "https://youtu.be/BBBBBBBBBBB" }]],
    ]),
  };

  const old: ParsedRelease = {
    id: "r-old",
    title: "Old Song",
    artistIds: ["artist-a"],
    dailyValues: new Map([
      ["2024-01-03", { value: 200, source: "inkigayo", episode: 0 }],
    ]),
    embeds: new Map([
      ["2024-01-01", [{ type: "mv", url: "https://youtu.be/CCCCCCCCCCC" }]],
    ]),
  };

  // No MV embed — must never appear in the MV timeline.
  const noMv: ParsedRelease = {
    id: "r-nomv",
    title: "No MV Song",
    artistIds: ["artist-b"],
    dailyValues: new Map([
      ["2024-02-05", { value: 999, source: "inkigayo", episode: 1 }],
    ]),
    embeds: new Map([
      ["2024-02-04", [{ type: "live_performance", url: "https://youtu.be/DDDDDDDDDDD" }]],
    ]),
  };

  const artists = new Map<string, ParsedArtist>();
  artists.set("artist-a", mkArtist("artist-a", "Artist Alpha", 4, [high, old]));
  artists.set("artist-b", mkArtist("artist-b", "Artist Beta", 3, [low, noMv]));

  return {
    artists,
    dates: ["2024-01-01", "2024-02-01"],
    startDate: "2024-01-01",
    endDate: "2024-02-12",
    firstAppearance: new Map(),
    chartWins: new Map(),
    releaseWinDates: new Map(),
  };
}

describe("MvBrowser", () => {
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

  it("only includes releases that have an mv embed", () => {
    const browser = new MvBrowser();
    browser.mount(container, dataStore);

    const items = container.querySelectorAll(".mv-card__item");
    // 3 MVs total (High, Low, Old); the no-MV release is excluded.
    expect(items.length).toBe(3);
    const text = container.textContent ?? "";
    expect(text).not.toContain("No MV Song");

    browser.unmount();
  });

  it("groups MVs by their embed date into date cards", () => {
    const browser = new MvBrowser();
    browser.mount(container, dataStore);

    const cards = container.querySelectorAll(".mv-card");
    // Two distinct MV dates: 2024-02-01 (High, Low) and 2024-01-01 (Old).
    expect(cards.length).toBe(2);

    const dates = Array.from(container.querySelectorAll(".mv-card__date")).map(
      el => el.textContent,
    );
    expect(dates).toContain("2024-02-01");
    expect(dates).toContain("2024-01-01");

    browser.unmount();
  });

  it("orders date groups descending (most recent first) by default", () => {
    const browser = new MvBrowser();
    browser.mount(container, dataStore);

    const dates = Array.from(container.querySelectorAll(".mv-card__date")).map(
      el => el.textContent,
    );
    expect(dates[0]).toBe("2024-02-01");
    expect(dates[dates.length - 1]).toBe("2024-01-01");

    browser.unmount();
  });

  it("orders date groups ascending when setDateSort('asc') is called", () => {
    const browser = new MvBrowser();
    browser.mount(container, dataStore);

    browser.setDateSort("asc");
    const dates = Array.from(container.querySelectorAll(".mv-card__date")).map(
      el => el.textContent,
    );
    expect(dates[0]).toBe("2024-01-01");
    expect(dates[dates.length - 1]).toBe("2024-02-01");

    browser.unmount();
  });

  it("within a date, orders MVs by total release score descending — regardless of date sort", () => {
    const browser = new MvBrowser();
    browser.mount(container, dataStore);

    // Find the 2024-02-01 card (High = 150, Low = 60).
    const cards = Array.from(container.querySelectorAll(".mv-card"));
    const febCard = cards.find(
      c => c.querySelector(".mv-card__date")?.textContent === "2024-02-01",
    )!;
    const infosDesc = Array.from(febCard.querySelectorAll(".mv-card__item-info")).map(
      el => el.textContent ?? "",
    );
    // High (150) must come before Low (60).
    expect(infosDesc[0]).toContain("High Song");
    expect(infosDesc[1]).toContain("Low Song");

    // Flip the date sort — the WITHIN-date order must stay score-desc.
    browser.setDateSort("asc");
    const cards2 = Array.from(container.querySelectorAll(".mv-card"));
    const febCard2 = cards2.find(
      c => c.querySelector(".mv-card__date")?.textContent === "2024-02-01",
    )!;
    const infosAsc = Array.from(febCard2.querySelectorAll(".mv-card__item-info")).map(
      el => el.textContent ?? "",
    );
    expect(infosAsc[0]).toContain("High Song");
    expect(infosAsc[1]).toContain("Low Song");

    browser.unmount();
  });

  it("shows the release's total score (sum of all daily values)", () => {
    const browser = new MvBrowser();
    browser.mount(container, dataStore);

    const cards = Array.from(container.querySelectorAll(".mv-card"));
    const febCard = cards.find(
      c => c.querySelector(".mv-card__date")?.textContent === "2024-02-01",
    )!;
    const scores = Array.from(febCard.querySelectorAll(".mv-card__item-score")).map(
      el => el.textContent,
    );
    // High = 100 + 50 = 150, Low = 60.
    expect(scores[0]).toBe("150");
    expect(scores[1]).toBe("60");

    browser.unmount();
  });

  it("renders a YouTube embed iframe for each MV", () => {
    const browser = new MvBrowser();
    browser.mount(container, dataStore);

    const iframes = container.querySelectorAll(".mv-card__embed iframe");
    expect(iframes.length).toBe(3);
    const first = iframes[0] as HTMLIFrameElement;
    expect(first.src).toContain("youtube.com/embed/");

    browser.unmount();
  });

  it("filters MVs by artist (matches any credited artist)", () => {
    const browser = new MvBrowser();
    browser.mount(container, dataStore);

    browser.setArtistFilter("artist-a");
    // artist-a has two MVs: High (2024-02-01) and Old (2024-01-01).
    const items = container.querySelectorAll(".mv-card__item");
    expect(items.length).toBe(2);
    const text = container.textContent ?? "";
    expect(text).not.toContain("Low Song");

    browser.unmount();
  });

  it("filters MVs by generation (matches any credited artist's generation)", () => {
    const browser = new MvBrowser();
    browser.mount(container, dataStore);

    // Gen 3 → only Artist Beta's "Low Song".
    browser.setGenerationFilter(3);
    const items = container.querySelectorAll(".mv-card__item");
    expect(items.length).toBe(1);
    expect((container.textContent ?? "")).toContain("Low Song");

    browser.unmount();
  });

  it("shows an empty-state message when no MVs match", () => {
    const browser = new MvBrowser();
    browser.mount(container, dataStore);

    browser.setArtistFilter("artist-does-not-exist");
    const empty = container.querySelector(".mv-browser__empty");
    expect(empty).not.toBeNull();
    expect(container.querySelectorAll(".mv-card").length).toBe(0);

    browser.unmount();
  });

  it("gives artist links a real href from artistUrl for new-tab support", () => {
    const browser = new MvBrowser();
    browser.artistUrl = (id) => `https://example.test/#view=artist-timeline&artist=${id}`;
    browser.mount(container, dataStore);

    const link = container.querySelector(".mv-card__artist-link") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toContain("view=artist-timeline&artist=");

    browser.unmount();
  });

  it("intercepts a plain click but lets a Cmd-click fall through to the browser", () => {
    const browser = new MvBrowser();
    const clicked: string[] = [];
    browser.artistUrl = (id) => `https://example.test/#artist=${id}`;
    browser.onArtistClick = (id) => clicked.push(id);
    browser.mount(container, dataStore);

    const link = container.querySelector(".mv-card__artist-link") as HTMLAnchorElement;

    const plain = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(clicked.length).toBe(1);

    const cmd = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true });
    link.dispatchEvent(cmd);
    expect(cmd.defaultPrevented).toBe(false);
    expect(clicked.length).toBe(1);

    browser.unmount();
  });

  it("deduplicates a multi-artist MV so it appears once", () => {
    // A collab release credited to both artists, processed only from the first.
    const collab: ParsedRelease = {
      id: "r-collab",
      title: "Collab Song",
      artistIds: ["artist-a", "artist-b"],
      dailyValues: new Map([["2024-03-05", { value: 300, source: "inkigayo", episode: 3 }]]),
      embeds: new Map([["2024-03-01", [{ type: "mv", url: "https://youtu.be/EEEEEEEEEEE" }]]]),
    };
    dataStore.artists.get("artist-a")!.releases.push(collab);
    dataStore.artists.get("artist-b")!.releases.push(collab);

    const browser = new MvBrowser();
    browser.mount(container, dataStore);

    const collabItems = Array.from(container.querySelectorAll(".mv-card__item")).filter(
      el => (el.textContent ?? "").includes("Collab Song"),
    );
    expect(collabItems.length).toBe(1);
    // Both credited artists are linked.
    const links = collabItems[0].querySelectorAll(".mv-card__artist-link");
    expect(links.length).toBe(2);

    browser.unmount();
  });

  it("unmount clears container content", () => {
    const browser = new MvBrowser();
    browser.mount(container, dataStore);
    expect(container.innerHTML).not.toBe("");
    browser.unmount();
    expect(container.innerHTML).toBe("");
  });
});
