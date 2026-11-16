import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * M Countdown #925 (2026-04-23) through the REAL load path
 * (loadFromAirtable -> assembleDataStore -> fillMissingScores -> CacheManager),
 * with Airtable-shaped records. Rows mirror the real episode: two published
 * scores (10,700 and 4,108) then rank-order placeholders -1..-5.
 *
 * Regression: the #2-anchor fix shipped, but a browser tab that had already
 * cached the store (sessionStorage, key airtable-v2, 1 hour TTL) kept serving
 * the values the OLD fill wrote, because the cache version never changed when
 * the fill logic did.
 */

const ROWS: Array<{ id: string; name: string; score: number }> = [
  { id: "txt", name: "TOMORROW X TOGETHER", score: 10700 },
  { id: "akmu", name: "AKMU", score: 4108 },
  { id: "plave", name: "PLAVE", score: -1 },
  { id: "kiss", name: "KISS OF LIFE", score: -2 },
  { id: "mody", name: "MODYSSEY", score: -3 },
  { id: "hwasa", name: "HWASA", score: -4 },
  { id: "dayoung", name: "DAYOUNG", score: -5 },
];
const DATE = "2026-04-23";

function airtableTables() {
  const artists = ROWS.map(r => ({
    id: `art_${r.id}`,
    fields: { "Full Name": r.name, Type: "Girl Group", Gen: "4", logo_name: r.id },
  }));
  const releases = ROWS.map(r => ({
    id: `rel_${r.id}`,
    fields: { Name: `${r.name} song`, Artist: [`art_${r.id}`], Date: "2026-04-01" },
  }));
  const episodes = [{ id: "ep925", fields: { Date: DATE, Show: "M Countdown", Episode: 925 } }];
  const rankings = ROWS.map(r => ({
    id: `rk_${r.id}`,
    fields: { Score: r.score, Release: [`rel_${r.id}`], Episode: ["ep925"] },
  }));
  return [artists, releases, episodes, rankings];
}

function mockFetch() {
  const tables = airtableTables();
  let i = 0;
  return vi.fn().mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({ records: tables[i++] ?? [] }) }),
  );
}

/** What the site cached with the pre-fix fill: ranks 3+ hung off #1 x 0.75. */
const STALE_VALUES: Record<string, number> = {
  txt: 10700, akmu: 4108, plave: 6786, kiss: 5763, mody: 4736, hwasa: 4285, dayoung: 3578,
};

function staleCachePayload() {
  return {
    version: "airtable-v2", // the string every deployed browser tab holds
    timestamp: Date.now(),
    data: {
      artists: ROWS.map(r => [r.id, {
        id: r.id, name: r.name, artistType: "girl_group", generation: 4,
        logoUrl: `assets/logos/${r.id}.svg`, albumReleases: [],
        releases: [{
          id: `${r.id}-song`, title: `${r.name} song`, artistIds: [r.id], embeds: [],
          dailyValues: [[DATE, {
            value: STALE_VALUES[r.id], source: "m_countdown", episode: 925,
            ...(r.score < 0 ? { estimated: true } : {}),
          }]],
        }],
      }]),
      dates: [DATE], startDate: DATE, endDate: DATE,
      firstAppearance: ROWS.map(r => [r.id, DATE]), chartWins: [],
    },
  };
}

function valuesOf(store: { artists: Map<string, { releases: Array<{ dailyValues: Map<string, { value: number }> }> }> }) {
  const out: Record<string, number> = {};
  for (const [id, a] of store.artists) out[id] = a.releases[0].dailyValues.get(DATE)!.value;
  return out;
}

describe("M Countdown #925 through loadFromAirtable", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_AIRTABLE_API_TOKEN", "pat_test_token_123");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
      get length() { return storage.size; },
      key: () => null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function load() {
    const mod = await import("../../src/airtable/data-adapter");
    return mod.loadFromAirtable();
  }

  it("fresh fetch: every projected score sits below the real #2 (rules out grouping/ordering causes)", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const v = valuesOf(await load());
    expect(v.txt).toBe(10700);
    expect(v.akmu).toBe(4108);
    const projected = [v.plave, v.kiss, v.mody, v.hwasa, v.dayoung];
    for (const p of projected) expect(p).toBeLessThan(4108);
    expect([...projected].sort((a, b) => b - a)).toEqual(projected);
    expect(v.plave).toBe(Math.round(4108 * 0.8456));
  });

  it("a cache written by the pre-fix fill (old version string) is not served after the fix", async () => {
    storage.set("airtable-v2", JSON.stringify(staleCachePayload()));
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);

    const v = valuesOf(await load());

    expect(fetchMock).toHaveBeenCalled(); // stale entry rejected, data refetched
    expect(v.plave).toBeLessThan(4108);
    expect(v.plave).not.toBe(6786);
  });

  it("a cache written by the current build is still served (no refetch)", async () => {
    vi.stubGlobal("fetch", mockFetch());
    await load(); // populates the cache
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const v = valuesOf(await load());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(v.plave).toBeLessThan(4108);
  });
});
