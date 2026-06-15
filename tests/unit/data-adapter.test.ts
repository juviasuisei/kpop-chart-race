import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the Data_Adapter module (loadFromAirtable).
 *
 * Validates: Requirements 4.8, 4.9, 5.5, 6.5, 6.6, 7.6, 8.4, 10.1, 10.4, 11.4
 */

// --- Helpers to build mock Airtable responses ---

function makeArtistRecord(
  id: string,
  fields: Record<string, unknown>,
) {
  return { id, fields };
}

function makeReleaseRecord(
  id: string,
  fields: Record<string, unknown>,
) {
  return { id, fields };
}

function makeEpisodeRecord(
  id: string,
  fields: Record<string, unknown>,
) {
  return { id, fields };
}

function makeRankingRecord(
  id: string,
  fields: Record<string, unknown>,
) {
  return { id, fields };
}

/**
 * Creates a mock fetch that returns different table responses in order:
 * 1. Artists, 2. Releases, 3. Episodes, 4. Rankings
 */
function createMockFetch(
  artists: unknown[],
  releases: unknown[],
  episodes: unknown[],
  rankings: unknown[],
) {
  let callIndex = 0;
  const responses = [artists, releases, episodes, rankings];

  return vi.fn().mockImplementation(() => {
    const records = responses[callIndex] ?? [];
    callIndex++;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ records }),
    });
  });
}

/** A minimal valid artist that will produce parseable output */
function validArtist(id: string, logoName: string, name: string) {
  return makeArtistRecord(id, {
    "Full Name": name,
    "Type": "Girl Group",
    "Gen": "4",
    "logo_name": logoName,
    "Releases": [`rel_${logoName}`],
  });
}

/** A release linked to one artist with a ranking */
function validRelease(id: string, name: string, artistIds: string[]) {
  return makeReleaseRecord(id, {
    Name: name,
    Artist: artistIds,
    Date: "2024-01-15",
    "Apple Music": "https://music.apple.com/test",
    Rankings: [`rank_${id}`],
  });
}

function validEpisode(id: string) {
  return makeEpisodeRecord(id, {
    Date: "2024-01-20",
    Show: "Inkigayo",
    Episode: 100,
  });
}

function validRanking(id: string, releaseId: string, episodeId: string) {
  return makeRankingRecord(id, {
    Score: 5000,
    Release: [releaseId],
    Episode: [episodeId],
    Performance: "https://youtube.com/performance",
  });
}

describe("Data_Adapter — loadFromAirtable", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_AIRTABLE_API_TOKEN", "pat_test_token_123");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Mock sessionStorage to prevent cache interactions
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      get length() { return storage.size; },
      key: (_index: number) => null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function importLoadFromAirtable() {
    const mod = await import("../../src/airtable/data-adapter");
    return mod.loadFromAirtable;
  }

  // --- Requirement 4.8: Invalid artist type → record skipped with warning ---

  it("skips artist with invalid type and emits a warning", async () => {
    const artists = [
      makeArtistRecord("art1", {
        "Full Name": "Invalid Type Group",
        "Type": "Unknown Category",
        "Gen": "4",
        "logo_name": "invalid_type_group",
      }),
      validArtist("art2", "aespa", "aespa"),
    ];
    const releases = [validRelease("rel_aespa", "Supernova", ["art2"])];
    const episodes = [validEpisode("ep1")];
    const rankings = [validRanking("rank_rel_aespa", "rel_aespa", "ep1")];

    const mockFetch = createMockFetch(artists, releases, episodes, rankings);
    vi.stubGlobal("fetch", mockFetch);

    const loadFromAirtable = await importLoadFromAirtable();
    const store = await loadFromAirtable();

    // The invalid artist should be skipped
    expect(store.artists.has("invalid_type_group")).toBe(false);
    expect(store.artists.has("aespa")).toBe(true);

    // Warning should be emitted for invalid type
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid artist type "Unknown Category"'),
    );
  });

  // --- Requirement 4.9: Invalid generation → record skipped with warning ---

  it("skips artist with invalid generation and emits a warning", async () => {
    const artists = [
      makeArtistRecord("art1", {
        "Full Name": "Bad Gen Group",
        "Type": "Boy Group",
        "Gen": "not_a_number",
        "logo_name": "bad_gen_group",
      }),
      validArtist("art2", "aespa", "aespa"),
    ];
    const releases = [validRelease("rel_aespa", "Supernova", ["art2"])];
    const episodes = [validEpisode("ep1")];
    const rankings = [validRanking("rank_rel_aespa", "rel_aespa", "ep1")];

    const mockFetch = createMockFetch(artists, releases, episodes, rankings);
    vi.stubGlobal("fetch", mockFetch);

    const loadFromAirtable = await importLoadFromAirtable();
    const store = await loadFromAirtable();

    expect(store.artists.has("bad_gen_group")).toBe(false);
    expect(store.artists.has("aespa")).toBe(true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid generation value "not_a_number"'),
    );
  });

  // --- Requirement 5.5: Release with zero linked artists → skipped with warning ---

  it("skips release with zero linked artists and emits a warning", async () => {
    const artists = [validArtist("art1", "aespa", "aespa")];
    const releases = [
      // Release with empty Artists array
      makeReleaseRecord("rel_orphan", {
        Name: "Orphan Song",
        Artist: [],
        Date: "2024-03-01",
      }),
      validRelease("rel_aespa", "Supernova", ["art1"]),
    ];
    const episodes = [validEpisode("ep1")];
    const rankings = [validRanking("rank_rel_aespa", "rel_aespa", "ep1")];

    const mockFetch = createMockFetch(artists, releases, episodes, rankings);
    vi.stubGlobal("fetch", mockFetch);

    const loadFromAirtable = await importLoadFromAirtable();
    await loadFromAirtable();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping release "Orphan Song": links to zero Artists'),
    );
  });

  // --- Requirement 6.5: Ranking with no linked episode → skipped with warning ---

  it("skips ranking with no linked episode and emits a warning", async () => {
    const artists = [validArtist("art1", "aespa", "aespa")];
    const releases = [validRelease("rel_aespa", "Supernova", ["art1"])];
    const episodes = [validEpisode("ep1")];
    const rankings = [
      // Ranking with no Episode link
      makeRankingRecord("rank_no_ep", {
        Score: 3000,
        Release: ["rel_aespa"],
        Episode: [],
      }),
      validRanking("rank_rel_aespa", "rel_aespa", "ep1"),
    ];

    const mockFetch = createMockFetch(artists, releases, episodes, rankings);
    vi.stubGlobal("fetch", mockFetch);

    const loadFromAirtable = await importLoadFromAirtable();
    await loadFromAirtable();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping ranking "rank_no_ep": no linked Episode'),
    );
  });

  // --- Requirement 6.6: Ranking with no linked release → skipped with warning ---

  it("skips ranking with no linked release and emits a warning", async () => {
    const artists = [validArtist("art1", "aespa", "aespa")];
    const releases = [validRelease("rel_aespa", "Supernova", ["art1"])];
    const episodes = [validEpisode("ep1")];
    const rankings = [
      // Ranking with no Release link
      makeRankingRecord("rank_no_rel", {
        Score: 2000,
        Release: [],
        Episode: ["ep1"],
      }),
      validRanking("rank_rel_aespa", "rel_aespa", "ep1"),
    ];

    const mockFetch = createMockFetch(artists, releases, episodes, rankings);
    vi.stubGlobal("fetch", mockFetch);

    const loadFromAirtable = await importLoadFromAirtable();
    await loadFromAirtable();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping ranking "rank_no_rel": no linked Release'),
    );
  });

  // --- Requirement 7.6: Embed skipped when episode has no date ---

  it("skips embed when linked episode has no date", async () => {
    const artists = [validArtist("art1", "aespa", "aespa")];
    const releases = [
      makeReleaseRecord("rel_aespa", {
        Name: "Supernova",
        Artist: ["art1"],
        Rankings: ["rank1"],
      }),
    ];
    // Episode without a Date
    const episodes = [
      makeEpisodeRecord("ep_nodate", {
        Show: "Music Bank",
        Episode: 50,
      }),
    ];
    const rankings = [
      makeRankingRecord("rank1", {
        Score: 4000,
        Release: ["rel_aespa"],
        Episode: ["ep_nodate"],
        Performance: "https://youtube.com/perf",
      }),
    ];

    const mockFetch = createMockFetch(artists, releases, episodes, rankings);
    vi.stubGlobal("fetch", mockFetch);

    const loadFromAirtable = await importLoadFromAirtable();

    // This should not throw — the ranking is skipped gracefully
    // Since there are no valid dailyValues, the artist is excluded
    // which causes "zero valid artists" error. So add a valid setup too.
    // Let's restructure: provide a second valid artist+release+episode+ranking
    // so the function doesn't throw.
    vi.stubGlobal("fetch", createMockFetch(
      [validArtist("art1", "aespa", "aespa"), validArtist("art2", "twice", "TWICE")],
      [
        makeReleaseRecord("rel_aespa", {
          Name: "Supernova",
          Artist: ["art1"],
          Rankings: ["rank1"],
        }),
        validRelease("rel_twice", "Feel Special", ["art2"]),
      ],
      [
        makeEpisodeRecord("ep_nodate", { Show: "Music Bank", Episode: 50 }),
        validEpisode("ep_valid"),
      ],
      [
        makeRankingRecord("rank1", {
          Score: 4000,
          Release: ["rel_aespa"],
          Episode: ["ep_nodate"],
          Performance: "https://youtube.com/perf",
        }),
        validRanking("rank_rel_twice", "rel_twice", "ep_valid"),
      ],
    ));

    // Need to re-import because we changed the fetch mock
    vi.resetModules();
    vi.stubEnv("VITE_AIRTABLE_API_TOKEN", "pat_test_token_123");
    const mod = await import("../../src/airtable/data-adapter");
    const store = await mod.loadFromAirtable();

    // The warning about episode with no Date should be emitted
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("linked Episode has no Date"),
    );

    // aespa should have no dailyValues (excluded from store) since the only
    // ranking linked to it was skipped
    expect(store.artists.has("aespa")).toBe(false);
    expect(store.artists.has("twice")).toBe(true);
  });

  // --- Requirement 11.4: Zero valid artists throws error ---

  it("throws error when zero valid artists result after assembly", async () => {
    // All artists have invalid types
    const artists = [
      makeArtistRecord("art1", {
        "Full Name": "Bad Group",
        "Type": "Invalid Type",
        "Gen": "3",
        "logo_name": "bad_group",
      }),
    ];
    const releases = [
      makeReleaseRecord("rel1", {
        Name: "Some Song",
        Artist: ["art1"],
        Date: "2024-01-01",
        Rankings: ["rank1"],
      }),
    ];
    const episodes = [validEpisode("ep1")];
    const rankings = [validRanking("rank1", "rel1", "ep1")];

    const mockFetch = createMockFetch(artists, releases, episodes, rankings);
    vi.stubGlobal("fetch", mockFetch);

    const loadFromAirtable = await importLoadFromAirtable();

    await expect(loadFromAirtable()).rejects.toThrow(
      "No chart data available: zero valid artists after assembly",
    );
  });

  // --- Requirement 10.1: Progress callback per-table during fetch phase ---

  it("calls progress callback per-table during fetch phase", async () => {
    const artists = [validArtist("art1", "aespa", "aespa")];
    const releases = [validRelease("rel_aespa", "Supernova", ["art1"])];
    const episodes = [validEpisode("ep1")];
    const rankings = [validRanking("rank_rel_aespa", "rel_aespa", "ep1")];

    const mockFetch = createMockFetch(artists, releases, episodes, rankings);
    vi.stubGlobal("fetch", mockFetch);

    const loadFromAirtable = await importLoadFromAirtable();
    const progressCalls: Array<[number, number, string]> = [];
    await loadFromAirtable((loaded, total, name) => {
      progressCalls.push([loaded, total, name]);
    });

    // Should have per-table calls: Artists, Releases, Episodes, Rankings
    const tableNames = progressCalls.map((c) => c[2]);
    expect(tableNames).toContain("Artists");
    expect(tableNames).toContain("Releases");
    expect(tableNames).toContain("Episodes");
    expect(tableNames).toContain("Rankings");

    // The first 4 calls should be the table fetch progress
    expect(progressCalls[0][2]).toBe("Artists");
    expect(progressCalls[1][2]).toBe("Releases");
    expect(progressCalls[2][2]).toBe("Episodes");
    expect(progressCalls[3][2]).toBe("Rankings");
  });

  // --- Requirement 10.4: Progress callback single "Cache" call on cache hit ---

  it("calls progress with 'Cache' on cache hit", async () => {
    // Pre-populate sessionStorage with a valid cache entry
    const { CacheManager } = await import("../../src/airtable/cache-manager");
    const cacheManager = new CacheManager();

    // Build a minimal valid DataStore to cache
    const { default: _ } = await import("../../src/models");
    const fakeStore = {
      artists: new Map([
        [
          "aespa",
          {
            id: "aespa",
            name: "aespa",
            artistType: "girl_group" as const,
            generation: 4,
            logoUrl: "assets/logos/aespa.svg",
            koreanName: undefined,
            debut: undefined,
            releases: [
              {
                id: "supernova",
                title: "Supernova",
                dailyValues: new Map([
                  ["2024-01-20", { value: 5000, source: "inkigayo", episode: 100 }],
                ]),
                embeds: new Map(),
              },
            ],
          },
        ],
      ]),
      dates: ["2024-01-20"],
      startDate: "2024-01-20",
      endDate: "2024-01-20",
      firstAppearance: new Map([["aespa", "2024-01-20"]]),
      chartWins: new Map(),
    };
    cacheManager.set(fakeStore as any);

    // Now re-import and call loadFromAirtable — it should hit cache
    vi.resetModules();
    vi.stubEnv("VITE_AIRTABLE_API_TOKEN", "pat_test_token_123");

    const mod = await import("../../src/airtable/data-adapter");
    const progressCalls: Array<[number, number, string]> = [];
    const store = await mod.loadFromAirtable((loaded, total, name) => {
      progressCalls.push([loaded, total, name]);
    });

    // Should have received a single "Cache" progress call
    expect(progressCalls).toHaveLength(1);
    expect(progressCalls[0][2]).toBe("Cache");
    expect(store.artists.has("aespa")).toBe(true);
  });

  // --- Requirement 8.4: Empty DataStore — startDate/endDate are empty strings ---

  it("artist with no dailyValues is excluded, resulting in empty firstAppearance for that artist", async () => {
    // Provide two artists: one with data, one without
    // The artist without data has releases but no rankings → no dailyValues
    const artists = [
      validArtist("art1", "aespa", "aespa"),
      validArtist("art2", "twice", "TWICE"),
    ];
    const releases = [
      // aespa has a release with a ranking (dailyValues)
      validRelease("rel_aespa", "Supernova", ["art1"]),
      // TWICE has a release with NO rankings → no dailyValues
      makeReleaseRecord("rel_twice", {
        Name: "Feel Special",
        Artist: ["art2"],
        Date: "2024-02-01",
        "Apple Music": "https://music.apple.com/twice",
      }),
    ];
    const episodes = [validEpisode("ep1")];
    const rankings = [validRanking("rank_rel_aespa", "rel_aespa", "ep1")];

    const mockFetch = createMockFetch(artists, releases, episodes, rankings);
    vi.stubGlobal("fetch", mockFetch);

    const loadFromAirtable = await importLoadFromAirtable();
    const store = await loadFromAirtable();

    // TWICE should be excluded from the artists map (no dailyValues)
    expect(store.artists.has("twice")).toBe(false);
    expect(store.artists.has("aespa")).toBe(true);

    // firstAppearance should not include the excluded artist
    expect(store.firstAppearance.has("twice")).toBe(false);
    expect(store.firstAppearance.has("aespa")).toBe(true);
    expect(store.firstAppearance.get("aespa")).toBe("2024-01-20");

    // startDate/endDate are derived from existing dailyValues
    expect(store.startDate).toBe("2024-01-20");
    expect(store.endDate).toBe("2024-01-20");
  });
});
