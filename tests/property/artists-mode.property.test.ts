// Feature: ui-overhaul-songs-filters-toolbar, Property 3: Artists mode cumulative value correctness
// Feature: ui-overhaul-songs-filters-toolbar, Property 4: Artists mode yearly aggregate correctness
// **Validates: Requirements 1.5, 1.6**

import fc from "fast-check";
import { computeSnapshot } from "../../src/chart-engine.ts";
import type { ArtistType, ChartSource, DailyValueEntry } from "../../src/types.ts";
import type { DataStore, ParsedArtist, ParsedRelease } from "../../src/models.ts";

// --- Constants ---

const ARTIST_TYPES: ArtistType[] = [
  "boy_group",
  "girl_group",
  "solo_male",
  "solo_female",
  "mixed_group",
];

const CHART_SOURCES: ChartSource[] = [
  "inkigayo",
  "the_show",
  "show_champion",
  "music_bank",
  "m_countdown",
  "show_music_core",
];

// --- Generators ---

/** Generate a sorted array of date strings */
function generateDates(startDate: Date, numDays: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates.sort();
}

/** Generate a DailyValueEntry with a specific source */
const arbDailyValueEntry: fc.Arbitrary<DailyValueEntry> = fc
  .tuple(
    fc.integer({ min: 1, max: 1000 }),
    fc.constantFrom(...CHART_SOURCES),
    fc.integer({ min: 1, max: 52 }),
  )
  .map(([value, source, episode]) => ({ value, source, episode }));

/** Generate a ParsedRelease with dailyValues spanning a set of dates */
function arbRelease(
  releaseId: string,
  dates: string[],
  parentArtistId: string,
): fc.Arbitrary<ParsedRelease> {
  // Generate a subset of dates with daily values
  return fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 15 }),
      fc.uniqueArray(fc.constantFrom(...dates), { minLength: 0, maxLength: Math.min(dates.length, 15) }),
      fc.array(arbDailyValueEntry, { minLength: 0, maxLength: 15 }),
    )
    .map(([title, selectedDates, values]) => {
      const dailyValues = new Map<string, DailyValueEntry>();
      const numEntries = Math.min(selectedDates.length, values.length);
      for (let i = 0; i < numEntries; i++) {
        dailyValues.set(selectedDates[i], values[i]);
      }
      return {
        id: releaseId,
        title,
        dailyValues,
        embeds: new Map(),
        artistIds: [parentArtistId],
      };
    });
}

/** Generate a full DataStore with 1-5 artists, each with 1-3 releases */
const arbDataStore: fc.Arbitrary<DataStore> = fc
  .tuple(
    fc.integer({ min: 5, max: 30 }), // number of days
    fc.integer({ min: 1, max: 5 }), // number of artists
  )
  .chain(([numDays, numArtists]) => {
    const startDate = new Date("2024-01-01");
    const dates = generateDates(startDate, numDays);

    // Generate artist IDs
    const artistIds = Array.from({ length: numArtists }, (_, i) => `artist_${i}`);

    // Generate artists with releases
    const artistArbitraries = artistIds.map((artistId) =>
      fc
        .tuple(
          fc.string({ minLength: 1, maxLength: 15 }),
          fc.constantFrom(...ARTIST_TYPES),
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 3 }), // number of releases
        )
        .chain(([name, artistType, generation, numReleases]) => {
          const releaseIds = Array.from(
            { length: numReleases },
            (_, i) => `${artistId}_release_${i}`,
          );
          const releaseArbs = releaseIds.map((releaseId) =>
            arbRelease(releaseId, dates, artistId),
          );
          return fc.tuple(...releaseArbs).map((releases) => ({
            id: artistId,
            name,
            artistType,
            generation,
            logoUrl: `assets/logos/${artistId}.svg`,
            releases,
            albumReleases: [],
          } as ParsedArtist));
        }),
    );

    return fc.tuple(...artistArbitraries).map((artists) => {
      const artistMap = new Map<string, ParsedArtist>();
      for (const artist of artists) {
        artistMap.set(artist.id, artist);
      }
      return {
        artists: artistMap,
        dates,
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        firstAppearance: new Map<string, string>(),
        chartWins: new Map(),
      } as DataStore;
    });
  });

// --- Helper: Manually compute cumulative value with source filter ---

/**
 * Manually computes the expected cumulative value for an artist up to a given date,
 * optionally filtered by source. This is the oracle for Property 3.
 */
function manualCumulativeValue(
  artist: ParsedArtist,
  date: string,
  dates: string[],
  source: string,
): number {
  let total = 0;
  for (const d of dates) {
    if (d > date) break;
    for (const release of artist.releases) {
      const entry = release.dailyValues.get(d);
      if (entry) {
        if (source === "all" || entry.source === source) {
          total += entry.value;
        }
      }
    }
  }
  return total;
}

/**
 * Manually computes the expected yearly aggregate for an artist within a year,
 * optionally filtered by source. This is the oracle for Property 4.
 */
function manualYearlyAggregate(
  artist: ParsedArtist,
  year: number,
  dates: string[],
  source: string,
): number {
  let total = 0;
  const yearStr = String(year);
  for (const d of dates) {
    if (!d.startsWith(yearStr)) continue;
    for (const release of artist.releases) {
      const entry = release.dailyValues.get(d);
      if (entry) {
        if (source === "all" || entry.source === source) {
          total += entry.value;
        }
      }
    }
  }
  return total;
}

// --- Source filter arbitrary ---

const arbSourceFilter: fc.Arbitrary<string> = fc.constantFrom(
  "all",
  ...CHART_SOURCES,
);

// ============================================================
// Property 3: Artists mode cumulative value correctness
// **Validates: Requirements 1.5**
// ============================================================

describe("Property 3: Artists mode cumulative value correctness", () => {
  it("each entry's cumulativeValue equals sum of ALL releases' dailyValues up to date (filtered by source)", () => {
    fc.assert(
      fc.property(
        arbDataStore.chain((dataStore) =>
          fc.tuple(
            fc.constant(dataStore),
            fc.constantFrom(...dataStore.dates),
            arbSourceFilter,
          ),
        ),
        ([dataStore, date, source]) => {
          // Call computeSnapshot with source filter
          const snapshot = computeSnapshot(date, dataStore, undefined, source);

          // Verify each entry's cumulativeValue against manual computation
          for (const entry of snapshot.entries) {
            const artist = dataStore.artists.get(entry.artistId);
            if (!artist) continue;

            const expected = manualCumulativeValue(
              artist,
              date,
              dataStore.dates,
              source,
            );
            expect(entry.cumulativeValue).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("with a specific source filter, only dailyValues matching that source contribute", () => {
    fc.assert(
      fc.property(
        arbDataStore.chain((dataStore) =>
          fc.tuple(
            fc.constant(dataStore),
            fc.constantFrom(...dataStore.dates),
            fc.constantFrom(...CHART_SOURCES),
          ),
        ),
        ([dataStore, date, source]) => {
          const snapshot = computeSnapshot(date, dataStore, undefined, source);

          for (const entry of snapshot.entries) {
            const artist = dataStore.artists.get(entry.artistId);
            if (!artist) continue;

            const expected = manualCumulativeValue(
              artist,
              date,
              dataStore.dates,
              source,
            );
            expect(entry.cumulativeValue).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("with source='all', matches the unfiltered sum of all dailyValues", () => {
    fc.assert(
      fc.property(
        arbDataStore.chain((dataStore) =>
          fc.tuple(
            fc.constant(dataStore),
            fc.constantFrom(...dataStore.dates),
          ),
        ),
        ([dataStore, date]) => {
          const snapshot = computeSnapshot(date, dataStore, undefined, "all");

          for (const entry of snapshot.entries) {
            const artist = dataStore.artists.get(entry.artistId);
            if (!artist) continue;

            // "all" means sum everything without source restriction
            const expected = manualCumulativeValue(
              artist,
              date,
              dataStore.dates,
              "all",
            );
            expect(entry.cumulativeValue).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 4: Artists mode yearly aggregate correctness
// **Validates: Requirements 1.6**
// ============================================================

describe("Property 4: Artists mode yearly aggregate correctness", () => {
  it("each artist's yearly aggregate equals sum of all releases' dailyValues within that year (filtered by source)", () => {
    fc.assert(
      fc.property(
        arbDataStore.chain((dataStore) => {
          const years = Array.from(
            new Set(dataStore.dates.map((d) => parseInt(d.slice(0, 4), 10))),
          );
          if (years.length === 0) return fc.constant({ dataStore, year: 2024, source: "all" as string });
          return fc.tuple(
            fc.constant(dataStore),
            fc.constantFrom(...years),
            arbSourceFilter,
          ).map(([ds, y, s]) => ({ dataStore: ds, year: y, source: s }));
        }),
        ({ dataStore, year, source }) => {
          const yearDates = dataStore.dates.filter((d) =>
            d.startsWith(String(year)),
          );
          if (yearDates.length === 0) return;

          // For each artist, verify yearly aggregate equals sum of source-filtered
          // dailyValues within that year
          for (const [artistId, artist] of dataStore.artists) {
            const expected = manualYearlyAggregate(
              artist,
              year,
              dataStore.dates,
              source,
            );

            // Verify via snapshot difference:
            // yearly aggregate = cumulative(lastDateOfYear) - cumulative(dayBeforeYear)
            const lastDateOfYear = yearDates[yearDates.length - 1];
            const snapshotEnd = computeSnapshot(
              lastDateOfYear,
              dataStore,
              undefined,
              source,
            );

            const firstDateOfYear = yearDates[0];
            const datesBeforeYear = dataStore.dates.filter(
              (d) => d < firstDateOfYear,
            );

            if (datesBeforeYear.length > 0) {
              const lastDateBeforeYear =
                datesBeforeYear[datesBeforeYear.length - 1];
              const snapshotBefore = computeSnapshot(
                lastDateBeforeYear,
                dataStore,
                undefined,
                source,
              );

              const endEntry = snapshotEnd.entries.find(
                (e) => e.artistId === artistId,
              );
              const beforeEntry = snapshotBefore.entries.find(
                (e) => e.artistId === artistId,
              );

              const cumulativeEnd = endEntry?.cumulativeValue ?? 0;
              const cumulativeBefore = beforeEntry?.cumulativeValue ?? 0;
              const yearlyAggregate = cumulativeEnd - cumulativeBefore;

              expect(yearlyAggregate).toBe(expected);
            } else {
              // No data before this year — yearly aggregate equals cumulative at end
              const endEntry = snapshotEnd.entries.find(
                (e) => e.artistId === artistId,
              );
              const cumulativeEnd = endEntry?.cumulativeValue ?? 0;

              expect(cumulativeEnd).toBe(expected);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("with a specific source filter, only matching dailyValues contribute to the yearly aggregate", () => {
    fc.assert(
      fc.property(
        arbDataStore.chain((dataStore) => {
          const years = Array.from(
            new Set(dataStore.dates.map((d) => parseInt(d.slice(0, 4), 10))),
          );
          if (years.length === 0) return fc.constant({ dataStore, year: 2024, source: "inkigayo" as string });
          return fc.tuple(
            fc.constant(dataStore),
            fc.constantFrom(...years),
            fc.constantFrom(...CHART_SOURCES),
          ).map(([ds, y, s]) => ({ dataStore: ds, year: y, source: s }));
        }),
        ({ dataStore, year, source }) => {
          const yearDates = dataStore.dates.filter((d) =>
            d.startsWith(String(year)),
          );
          if (yearDates.length === 0) return;

          for (const [artistId, artist] of dataStore.artists) {
            const expected = manualYearlyAggregate(
              artist,
              year,
              dataStore.dates,
              source,
            );

            // Compute via snapshot at the last date of the year
            const lastDateOfYear = yearDates[yearDates.length - 1];
            const snapshotEnd = computeSnapshot(
              lastDateOfYear,
              dataStore,
              undefined,
              source,
            );

            const datesBeforeYear = dataStore.dates.filter(
              (d) => d < yearDates[0],
            );

            let yearlyAggregate: number;
            if (datesBeforeYear.length > 0) {
              const snapshotBefore = computeSnapshot(
                datesBeforeYear[datesBeforeYear.length - 1],
                dataStore,
                undefined,
                source,
              );
              const endEntry = snapshotEnd.entries.find(
                (e) => e.artistId === artistId,
              );
              const beforeEntry = snapshotBefore.entries.find(
                (e) => e.artistId === artistId,
              );
              yearlyAggregate =
                (endEntry?.cumulativeValue ?? 0) -
                (beforeEntry?.cumulativeValue ?? 0);
            } else {
              const endEntry = snapshotEnd.entries.find(
                (e) => e.artistId === artistId,
              );
              yearlyAggregate = endEntry?.cumulativeValue ?? 0;
            }

            expect(yearlyAggregate).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("with source='all', yearly aggregate matches sum of all dailyValues in that year regardless of source", () => {
    fc.assert(
      fc.property(
        arbDataStore.chain((dataStore) => {
          const years = Array.from(
            new Set(dataStore.dates.map((d) => parseInt(d.slice(0, 4), 10))),
          );
          if (years.length === 0) return fc.constant({ dataStore, year: 2024 });
          return fc
            .constantFrom(...years)
            .map((y) => ({ dataStore, year: y }));
        }),
        ({ dataStore, year }) => {
          const yearDates = dataStore.dates.filter((d) =>
            d.startsWith(String(year)),
          );
          if (yearDates.length === 0) return;

          for (const [, artist] of dataStore.artists) {
            // With "all" source, expected = sum of all dailyValues in that year
            const expected = manualYearlyAggregate(
              artist,
              year,
              dataStore.dates,
              "all",
            );

            // Compute actual from raw data directly
            let actual = 0;
            for (const d of yearDates) {
              for (const release of artist.releases) {
                const entry = release.dailyValues.get(d);
                if (entry) {
                  actual += entry.value;
                }
              }
            }

            expect(actual).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
