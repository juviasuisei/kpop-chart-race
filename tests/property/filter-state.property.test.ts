// Feature: ui-overhaul-songs-filters-toolbar, Properties 8, 9, 10, 11, 12, 16
// **Validates: Requirements 6.1, 6.2, 6.3, 6.6, 7.3, 7.4, 7.5, 11.1, 11.2**

import fc from "fast-check";
import { FilterStateManager } from "../../src/filter-state-manager.ts";
import { EventBus } from "../../src/event-bus.ts";
import { computeSnapshotSongs, computeCumulativeValueFiltered, applyGenerationFilter, extractGenerations } from "../../src/chart-engine.ts";
import type { DataStore, ParsedArtist, ParsedRelease, RankedEntry } from "../../src/models.ts";
import type { ChartSource, DailyValueEntry, FilterState } from "../../src/types.ts";

// --- Shared Arbitraries ---

const DISPLAY_MODES = ["songs", "artists"] as const;
const GENERATIONS = [1, 2, 3, 4, 5, "all"] as const;
const SOURCES = [
  "all",
  "inkigayo",
  "the_show",
  "show_champion",
  "music_bank",
  "m_countdown",
  "show_music_core",
] as const;
const SPECIFIC_SOURCES: ChartSource[] = [
  "inkigayo",
  "the_show",
  "show_champion",
  "music_bank",
  "m_countdown",
  "show_music_core",
];
const ZOOM_LEVELS = [10, "all"] as const;
const VIEWS = ["race", "yearly"] as const;
const METRICS = ["points", "wins"] as const;

/** Generates a valid FilterState combination */
const arbFilterState = fc.record({
  displayMode: fc.constantFrom(...DISPLAY_MODES),
  generation: fc.constantFrom(...GENERATIONS) as fc.Arbitrary<number | "all">,
  source: fc.constantFrom(...SOURCES) as fc.Arbitrary<string>,
  zoom: fc.constantFrom(...ZOOM_LEVELS) as fc.Arbitrary<10 | "all">,
  view: fc.constantFrom(...VIEWS),
  metric: fc.constantFrom(...METRICS),
});

/** Generates a date string in YYYY-MM-DD format within a constrained range */
function arbDate(dayIndex: number): string {
  const base = new Date("2024-01-01");
  base.setDate(base.getDate() + dayIndex);
  return base.toISOString().slice(0, 10);
}

/**
 * Generates a DataStore with multiple artists, releases, and dailyValues from
 * varied sources. Used for testing source filter properties.
 */
const arbDataStoreWithSources = fc.integer({ min: 5, max: 20 }).chain((numDays) => {
  const dates = Array.from({ length: numDays }, (_, i) => arbDate(i));

  return fc
    .tuple(
      fc.integer({ min: 1, max: 5 }), // number of artists
      fc.integer({ min: 1, max: 3 }), // releases per artist
    )
    .chain(([numArtists, releasesPerArtist]) => {
      // Generate dailyValues for each release: array of [dayIndex, sourceIndex, value]
      const arbDailyValues = fc.array(
        fc.tuple(
          fc.integer({ min: 0, max: numDays - 1 }),
          fc.integer({ min: 0, max: SPECIFIC_SOURCES.length - 1 }),
          fc.integer({ min: 1, max: 500 }),
        ),
        { minLength: 1, maxLength: numDays * 2 },
      );

      // Generate all daily values for all artists and releases
      const arbAllDailyValues = fc.array(
        fc.array(arbDailyValues, {
          minLength: releasesPerArtist,
          maxLength: releasesPerArtist,
        }),
        { minLength: numArtists, maxLength: numArtists },
      );

      return arbAllDailyValues.map((allArtistData) => {
        const artists = new Map<string, ParsedArtist>();

        for (let aIdx = 0; aIdx < allArtistData.length; aIdx++) {
          const artistId = `artist-${aIdx}`;
          const releases: ParsedRelease[] = [];

          for (let rIdx = 0; rIdx < allArtistData[aIdx].length; rIdx++) {
            const dailyValues = new Map<string, DailyValueEntry>();

            for (const [dayIdx, sourceIdx, value] of allArtistData[aIdx][rIdx]) {
              const date = dates[dayIdx];
              // Only keep first entry per date (simulates one source per date per release)
              if (!dailyValues.has(date)) {
                dailyValues.set(date, {
                  value,
                  source: SPECIFIC_SOURCES[sourceIdx],
                  episode: 1,
                });
              }
            }

            releases.push({
              id: `release-${aIdx}-${rIdx}`,
              title: `Release ${aIdx}-${rIdx}`,
              dailyValues,
              embeds: new Map(),
              artistIds: [artistId],
            });
          }

          artists.set(artistId, {
            id: artistId,
            name: `Artist ${aIdx}`,
            artistType: "boy_group",
            generation: (aIdx % 5) + 1,
            logoUrl: `logos/${artistId}.svg`,
            releases,
            albumReleases: [],
          });
        }

        const dataStore: DataStore = {
          artists,
          dates,
          startDate: dates[0],
          endDate: dates[dates.length - 1],
          firstAppearance: new Map(),
          chartWins: new Map(),
        };

        return dataStore;
      });
    });
});

// ============================================================
// Property 12: FilterState preservation on view switch
// **Validates: Requirements 11.1, 11.2**
// ============================================================

describe("Property 12: FilterState preservation on view switch", () => {
  it("for any valid FilterState, after a view switch all non-view fields remain identical", () => {
    fc.assert(
      fc.property(arbFilterState, (initialState) => {
        const eventBus = new EventBus();
        const manager = new FilterStateManager(eventBus, initialState);

        // Determine the opposite view
        const oppositeView = initialState.view === "race" ? "yearly" : "race";

        // Switch to the opposite view
        manager.update({ view: oppositeView });

        const stateAfterSwitch = manager.getState();

        // The view should have changed
        expect(stateAfterSwitch.view).toBe(oppositeView);

        // All other fields must remain identical
        expect(stateAfterSwitch.displayMode).toBe(initialState.displayMode);
        expect(stateAfterSwitch.generation).toBe(initialState.generation);
        expect(stateAfterSwitch.source).toBe(initialState.source);
        expect(stateAfterSwitch.zoom).toBe(initialState.zoom);
        expect(stateAfterSwitch.metric).toBe(initialState.metric);
      }),
      { numRuns: 100 },
    );
  });

  it("for any valid FilterState, switching view twice returns to the original state", () => {
    fc.assert(
      fc.property(arbFilterState, (initialState) => {
        const eventBus = new EventBus();
        const manager = new FilterStateManager(eventBus, initialState);

        // Switch to opposite view
        const oppositeView = initialState.view === "race" ? "yearly" : "race";
        manager.update({ view: oppositeView });

        // Switch back to original view
        manager.update({ view: initialState.view });

        const finalState = manager.getState();

        // All fields must be identical to the initial state
        expect(finalState.displayMode).toBe(initialState.displayMode);
        expect(finalState.generation).toBe(initialState.generation);
        expect(finalState.source).toBe(initialState.source);
        expect(finalState.zoom).toBe(initialState.zoom);
        expect(finalState.view).toBe(initialState.view);
        expect(finalState.metric).toBe(initialState.metric);
      }),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 10: Source filter cumulative correctness
// **Validates: Requirements 7.3, 7.4**
// ============================================================

describe("Property 10: Source filter cumulative correctness", () => {
  it("for any DataStore, date, and source filter, cumulativeValue equals sum of only matching-source dailyValues", () => {
    fc.assert(
      fc.property(
        arbDataStoreWithSources,
        fc.constantFrom(...SPECIFIC_SOURCES),
        (dataStore, selectedSource) => {
          // Pick the last date as the snapshot date
          const snapshotDate = dataStore.endDate;

          // Build a FilterState with the selected source
          const filterState: FilterState = {
            displayMode: "songs",
            generation: "all",
            source: selectedSource,
            zoom: "all",
            view: "race",
            metric: "points",
          };

          // Compute snapshot with source filter
          const snapshot = computeSnapshotSongs(
            snapshotDate,
            dataStore,
            filterState,
          );

          // Verify each entry's cumulativeValue matches manual computation
          for (const entry of snapshot.entries) {
            // Parse the releaseKey to identify artist and release
            // releaseKey format: `${artistId}::${releaseId}`
            const [artistId, releaseId] = entry.releaseKey!.split("::");
            const artist = dataStore.artists.get(artistId);
            expect(artist).toBeDefined();

            const release = artist!.releases.find((r) => r.id === releaseId);
            expect(release).toBeDefined();

            // Manually sum only dailyValues where source matches selectedSource
            let expectedCumulative = 0;
            for (const d of dataStore.dates) {
              if (d > snapshotDate) break;
              const dv = release!.dailyValues.get(d);
              if (dv && dv.source === selectedSource) {
                expectedCumulative += dv.value;
              }
            }

            expect(entry.cumulativeValue).toBe(expectedCumulative);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("computeCumulativeValueFiltered returns correct sum for a specific source", () => {
    fc.assert(
      fc.property(
        arbDataStoreWithSources,
        fc.constantFrom(...SPECIFIC_SOURCES),
        (dataStore, selectedSource) => {
          const snapshotDate = dataStore.endDate;

          // Test computeCumulativeValueFiltered directly for each artist
          for (const [, artist] of dataStore.artists) {
            const result = computeCumulativeValueFiltered(
              artist,
              snapshotDate,
              dataStore.dates,
              selectedSource,
            );

            // Manual computation: sum all matching dailyValues across all releases
            let expected = 0;
            for (const release of artist.releases) {
              for (const d of dataStore.dates) {
                if (d > snapshotDate) break;
                const dv = release.dailyValues.get(d);
                if (dv && dv.source === selectedSource) {
                  expected += dv.value;
                }
              }
            }

            expect(result).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 11: Source filter preserves zero-value entries
// **Validates: Requirements 7.5**
// ============================================================

describe("Property 11: Source filter preserves zero-value entries", () => {
  it("entries with zero matching values for a source still appear with cumulativeValue === 0", () => {
    fc.assert(
      fc.property(
        arbDataStoreWithSources,
        (dataStore) => {
          // Find a source that at least one artist/release does NOT use
          // Strategy: pick a source that is absent from at least one release
          let targetSource: ChartSource | null = null;
          let targetArtistId: string | null = null;
          let targetReleaseId: string | null = null;

          for (const [artistId, artist] of dataStore.artists) {
            for (const release of artist.releases) {
              // Check which sources this release uses
              const usedSources = new Set<string>();
              for (const [, dv] of release.dailyValues) {
                usedSources.add(dv.source);
              }

              // Find a source NOT used by this release
              for (const source of SPECIFIC_SOURCES) {
                if (!usedSources.has(source)) {
                  targetSource = source;
                  targetArtistId = artistId;
                  targetReleaseId = release.id;
                  break;
                }
              }
              if (targetSource) break;
            }
            if (targetSource) break;
          }

          // If we couldn't find a mismatch (all releases use all sources), skip
          // This is a precondition — fast-check will generate another case
          if (!targetSource || !targetArtistId || !targetReleaseId) return;

          const filterState: FilterState = {
            displayMode: "songs",
            generation: "all",
            source: targetSource,
            zoom: "all",
            view: "race",
            metric: "points",
          };

          const snapshot = computeSnapshotSongs(
            dataStore.endDate,
            dataStore,
            filterState,
          );

          // The entry for the target release should still exist with cumulativeValue === 0
          const targetKey = `${targetArtistId}::${targetReleaseId}`;
          const entry = snapshot.entries.find((e) => e.releaseKey === targetKey);

          expect(entry).toBeDefined();
          expect(entry!.cumulativeValue).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 8: Generation filter only passes matching entries
// **Validates: Requirements 6.2, 6.3**
// ============================================================

describe("Property 8: Generation filter only passes matching entries", () => {
  /**
   * Arbitrary that generates RankedEntry arrays with various generations,
   * including co-artists with different generations.
   */
  const arbGeneration = fc.integer({ min: 1, max: 5 });

  const arbResolvedArtist = fc.record({
    id: fc.string({ minLength: 1, maxLength: 10 }),
    name: fc.string({ minLength: 1, maxLength: 20 }),
    logoUrl: fc.constant("logos/test.svg"),
    artistType: fc.constantFrom("boy_group", "girl_group", "solo_male", "solo_female", "mixed_group") as fc.Arbitrary<"boy_group" | "girl_group" | "solo_male" | "solo_female" | "mixed_group">,
    generation: arbGeneration,
  });

  const arbRankedEntry = fc.tuple(
    fc.string({ minLength: 1, maxLength: 10 }),
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.constantFrom("boy_group", "girl_group", "solo_male", "solo_female", "mixed_group") as fc.Arbitrary<"boy_group" | "girl_group" | "solo_male" | "solo_female" | "mixed_group">,
    arbGeneration,
    fc.integer({ min: 1, max: 10000 }),
    fc.integer({ min: 1, max: 100 }),
    fc.array(arbResolvedArtist, { minLength: 0, maxLength: 4 }),
  ).map(([artistId, artistName, artistType, generation, cumulativeValue, rank, coArtists]) => ({
    artistId,
    artistName,
    artistType,
    generation,
    logoUrl: "logos/test.svg",
    cumulativeValue,
    previousCumulativeValue: 0,
    dailyValue: 0,
    rank,
    previousRank: 0,
    featuredRelease: { releaseId: "r1", title: "Song" },
    isGoalpost: false,
    releaseKey: `${artistId}::r1`,
    coArtists,
    mode: "songs" as const,
  }));

  it("after filtering by a specific generation, every entry has at least one artist matching that generation", () => {
    fc.assert(
      fc.property(
        fc.array(arbRankedEntry, { minLength: 1, maxLength: 20 }),
        arbGeneration,
        (entries, selectedGeneration) => {
          const filtered = applyGenerationFilter(entries, selectedGeneration);

          // Every remaining entry must have at least one matching artist
          for (const entry of filtered) {
            const hasMatchingArtist =
              entry.generation === selectedGeneration ||
              (entry.coArtists ?? []).some((a) => a.generation === selectedGeneration);
            expect(hasMatchingArtist).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("when generation is 'all', applyGenerationFilter returns all entries unchanged", () => {
    fc.assert(
      fc.property(
        fc.array(arbRankedEntry, { minLength: 1, maxLength: 20 }),
        (entries) => {
          const filtered = applyGenerationFilter(entries, "all");
          expect(filtered.length).toBe(entries.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 9: Generation filter produces contiguous ranks
// **Validates: Requirements 6.6**
// ============================================================

describe("Property 9: Generation filter produces contiguous ranks", () => {
  const arbGeneration = fc.integer({ min: 1, max: 5 });

  const arbResolvedArtist = fc.record({
    id: fc.string({ minLength: 1, maxLength: 10 }),
    name: fc.string({ minLength: 1, maxLength: 20 }),
    logoUrl: fc.constant("logos/test.svg"),
    artistType: fc.constantFrom("boy_group", "girl_group", "solo_male", "solo_female", "mixed_group") as fc.Arbitrary<"boy_group" | "girl_group" | "solo_male" | "solo_female" | "mixed_group">,
    generation: arbGeneration,
  });

  /** Generate a list of entries pre-sorted by descending cumulativeValue (mimics snapshot output) */
  const arbSortedEntries = fc.array(
    fc.tuple(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.constantFrom("boy_group", "girl_group", "solo_male", "solo_female", "mixed_group") as fc.Arbitrary<"boy_group" | "girl_group" | "solo_male" | "solo_female" | "mixed_group">,
      arbGeneration,
      fc.integer({ min: 0, max: 10000 }),
      fc.array(arbResolvedArtist, { minLength: 0, maxLength: 4 }),
    ),
    { minLength: 1, maxLength: 20 },
  ).map((tuples) => {
    // Sort by descending cumulativeValue to simulate snapshot output
    tuples.sort((a, b) => b[4] - a[4]);
    return tuples.map(([artistId, artistName, artistType, generation, cumulativeValue, coArtists], idx) => ({
      artistId,
      artistName,
      artistType,
      generation,
      logoUrl: "logos/test.svg",
      cumulativeValue,
      previousCumulativeValue: 0,
      dailyValue: 0,
      rank: idx + 1,
      previousRank: 0,
      featuredRelease: { releaseId: "r1", title: "Song" },
      isGoalpost: false,
      releaseKey: `${artistId}::r1-${idx}`,
      coArtists,
      mode: "songs" as const,
    }));
  });

  it("after filtering, ranks form a contiguous 1..N sequence with cumulativeValue at rank k >= rank k+1", () => {
    fc.assert(
      fc.property(
        arbSortedEntries,
        arbGeneration,
        (entries, selectedGeneration) => {
          const filtered = applyGenerationFilter(entries, selectedGeneration);

          if (filtered.length === 0) return; // no entries match — valid

          // Ranks must be contiguous 1..N
          for (let i = 0; i < filtered.length; i++) {
            expect(filtered[i].rank).toBe(i + 1);
          }

          // Entry at rank k must have cumulativeValue >= entry at rank k+1
          for (let i = 0; i < filtered.length - 1; i++) {
            expect(filtered[i].cumulativeValue).toBeGreaterThanOrEqual(
              filtered[i + 1].cumulativeValue,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 16: Generation filter dropdown sorted descending from data
// **Validates: Requirements 6.1**
// ============================================================

describe("Property 16: Generation filter dropdown sorted descending from data", () => {
  it("extractGenerations returns generations in descending numeric order and includes all generations from the DataStore", () => {
    fc.assert(
      fc.property(
        arbDataStoreWithSources,
        (dataStore) => {
          const generations = extractGenerations(dataStore);

          // Collect all generation values present in the DataStore
          const allGenerations = new Set<number>();
          for (const [, artist] of dataStore.artists) {
            allGenerations.add(artist.generation);
          }

          // All generation values from DataStore must be present in the result
          for (const gen of allGenerations) {
            expect(generations).toContain(gen);
          }

          // Result must be in descending numeric order
          for (let i = 0; i < generations.length - 1; i++) {
            expect(generations[i]).toBeGreaterThan(generations[i + 1]);
          }

          // No duplicates
          const unique = new Set(generations);
          expect(unique.size).toBe(generations.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
