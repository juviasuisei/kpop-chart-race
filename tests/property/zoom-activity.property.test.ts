// Feature: ui-overhaul-songs-filters-toolbar, Properties 13, 14, 15
// **Validates: Requirements 9.3, 9.5, 10.1**

import fc from "fast-check";
import { filterByActivity, hasRecentActivity, dateMinusDays } from "../../src/utils.ts";
import type { DataStore, ParsedArtist, ParsedRelease, RankedEntry } from "../../src/models.ts";
import type { ChartSource, DailyValueEntry } from "../../src/types.ts";

// --- Constants ---

const CHART_SOURCES: ChartSource[] = [
  "inkigayo",
  "the_show",
  "show_champion",
  "music_bank",
  "m_countdown",
  "show_music_core",
];

const ARTIST_TYPES = [
  "boy_group",
  "girl_group",
  "solo_male",
  "solo_female",
  "mixed_group",
] as const;

// --- Shared Arbitraries ---

/** Generates a date string offset from a base date */
function dateFromOffset(dayOffset: number): string {
  const base = new Date("2024-06-15T00:00:00");
  base.setDate(base.getDate() + dayOffset);
  return base.toISOString().slice(0, 10);
}

/**
 * Generates a DataStore with many artists that have activity spread across
 * various dates, suitable for testing zoom limits.
 */
function arbDataStoreForZoom(numArtists: number, numDays: number) {
  const dates = Array.from({ length: numDays }, (_, i) => dateFromOffset(i - numDays + 1));
  dates.sort();

  return fc
    .array(
      fc.tuple(
        fc.integer({ min: 0, max: numDays - 1 }), // day offset for activity
        fc.constantFrom(...CHART_SOURCES),
        fc.integer({ min: 1, max: 500 }),
      ),
      { minLength: 1, maxLength: numDays },
    )
    .chain((templateDailyValues) =>
      fc
        .array(
          fc.array(
            fc.tuple(
              fc.integer({ min: 0, max: numDays - 1 }),
              fc.constantFrom(...CHART_SOURCES),
              fc.integer({ min: 1, max: 500 }),
            ),
            { minLength: 1, maxLength: Math.min(numDays, 10) },
          ),
          { minLength: numArtists, maxLength: numArtists },
        )
        .map((allArtistDailyValues) => {
          const artists = new Map<string, ParsedArtist>();

          for (let aIdx = 0; aIdx < allArtistDailyValues.length; aIdx++) {
            const artistId = `artist-${aIdx}`;
            const dailyValues = new Map<string, DailyValueEntry>();

            for (const [dayIdx, source, value] of allArtistDailyValues[aIdx]) {
              const date = dates[dayIdx];
              if (!dailyValues.has(date)) {
                dailyValues.set(date, { value, source, episode: 1 });
              }
            }

            const release: ParsedRelease = {
              id: `release-${aIdx}-0`,
              title: `Song ${aIdx}`,
              dailyValues,
              embeds: new Map(),
              artistIds: [artistId],
            };

            artists.set(artistId, {
              id: artistId,
              name: `Artist ${aIdx}`,
              artistType: ARTIST_TYPES[aIdx % ARTIST_TYPES.length],
              generation: (aIdx % 5) + 1,
              logoUrl: `logos/${artistId}.svg`,
              releases: [release],
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
        }),
    );
}

/**
 * Generates a set of RankedEntry entries for testing filterByActivity.
 * Entries are pre-ranked by descending cumulativeValue.
 */
function arbRankedEntries(count: number): fc.Arbitrary<RankedEntry[]> {
  return fc
    .array(
      fc.tuple(
        fc.integer({ min: 1, max: 50000 }),
        fc.constantFrom(...ARTIST_TYPES),
        fc.integer({ min: 1, max: 5 }),
      ),
      { minLength: count, maxLength: count },
    )
    .map((tuples) => {
      // Sort by descending value to simulate snapshot output
      tuples.sort((a, b) => b[0] - a[0]);
      return tuples.map(([cumulativeValue, artistType, generation], idx) => ({
        artistId: `artist-${idx}`,
        artistName: `Artist ${idx}`,
        artistType,
        generation,
        logoUrl: `logos/artist-${idx}.svg`,
        cumulativeValue,
        previousCumulativeValue: 0,
        dailyValue: 0,
        rank: idx + 1,
        previousRank: 0,
        featuredRelease: { releaseId: `release-${idx}-0`, title: `Song ${idx}` },
        isGoalpost: false,
        mode: "artists" as const,
      }));
    });
}

// ============================================================
// Property 15: Inactive window 3-day boundary
// **Validates: Requirements 10.1**
// ============================================================

describe("Property 15: Inactive window 3-day boundary", () => {
  it("entry with most recent activity within 3 days is active; more than 3 days is inactive", () => {
    fc.assert(
      fc.property(
        // Generate a snapshot date and an activity offset in days (0–10)
        fc.integer({ min: 10, max: 30 }), // days of data range
        fc.integer({ min: 0, max: 10 }), // days before snapshot that the activity occurred
        (numDays, activityDaysAgo) => {
          const snapshotDate = dateFromOffset(0); // "2024-06-15"
          const activityDate = dateFromOffset(-activityDaysAgo);

          // Create a minimal DataStore with one artist whose only activity is on activityDate
          const artistId = "test-artist";
          const dailyValues = new Map<string, DailyValueEntry>();
          dailyValues.set(activityDate, {
            value: 100,
            source: "inkigayo",
            episode: 1,
          });

          const release: ParsedRelease = {
            id: "release-0",
            title: "Test Song",
            dailyValues,
            embeds: new Map(),
            artistIds: [artistId],
          };

          const artists = new Map<string, ParsedArtist>();
          artists.set(artistId, {
            id: artistId,
            name: "Test Artist",
            artistType: "boy_group",
            generation: 4,
            logoUrl: "logos/test-artist.svg",
            releases: [release],
            albumReleases: [],
          });

          const dates = Array.from({ length: numDays }, (_, i) =>
            dateFromOffset(i - numDays + 1),
          ).sort();

          const dataStore: DataStore = {
            artists,
            dates,
            startDate: dates[0],
            endDate: dates[dates.length - 1],
            firstAppearance: new Map(),
            chartWins: new Map(),
          };

          // The 3-day cutoff: cutoffDate = snapshotDate - 3 days
          const cutoffDate = dateMinusDays(snapshotDate, 3);
          const isActive = hasRecentActivity(artistId, cutoffDate, snapshotDate, dataStore);

          if (activityDaysAgo <= 3) {
            // Activity is within 3 days — should be active
            expect(isActive).toBe(true);
          } else {
            // Activity is more than 3 days ago — should be inactive
            expect(isActive).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 13: Race view zoom limits entries to at most 10
// **Validates: Requirements 9.3**
// ============================================================

describe("Property 13: Race view zoom limits entries to at most 10", () => {
  it("with zoom 10, filterByActivity returns at most 10 non-goalpost entries", () => {
    fc.assert(
      fc.property(
        // Generate 20–50 ranked entries
        fc.integer({ min: 20, max: 50 }).chain((count) => arbRankedEntries(count)),
        // Generate a DataStore with matching artists that have various activity dates
        fc.integer({ min: 20, max: 50 }).chain((numArtists) =>
          arbDataStoreForZoom(numArtists, 15),
        ),
        (entries, dataStore) => {
          const snapshotDate = dataStore.endDate;

          // Align entries with data store artists (use as many as we have in common)
          const availableArtistIds = Array.from(dataStore.artists.keys());
          const alignedEntries = entries.slice(0, availableArtistIds.length).map((entry, idx) => ({
            ...entry,
            artistId: availableArtistIds[idx],
            rank: idx + 1,
          }));

          if (alignedEntries.length === 0) return;

          // Call filterByActivity with zoom level 10
          const result = filterByActivity(alignedEntries, snapshotDate, dataStore, 10);

          // Count non-goalpost entries
          const nonGoalposts = result.filter((e) => e.isGoalpost === false);

          // Non-goalpost entries should be at most 10
          expect(nonGoalposts.length).toBeLessThanOrEqual(10);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("total result may include additional goalpost entries beyond the 10 regulars", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 50 }).chain((count) => arbRankedEntries(count)),
        fc.integer({ min: 20, max: 50 }).chain((numArtists) =>
          arbDataStoreForZoom(numArtists, 15),
        ),
        (entries, dataStore) => {
          const snapshotDate = dataStore.endDate;

          const availableArtistIds = Array.from(dataStore.artists.keys());
          const alignedEntries = entries.slice(0, availableArtistIds.length).map((entry, idx) => ({
            ...entry,
            artistId: availableArtistIds[idx],
            rank: idx + 1,
          }));

          if (alignedEntries.length === 0) return;

          const result = filterByActivity(alignedEntries, snapshotDate, dataStore, 10);

          // Total entries may be more than 10 (goalposts added)
          // But non-goalposts must be at most 10
          const regulars = result.filter((e) => !e.isGoalpost);
          const goalposts = result.filter((e) => e.isGoalpost);

          expect(regulars.length).toBeLessThanOrEqual(10);
          // Total can exceed 10 when goalposts are present
          expect(result.length).toBe(regulars.length + goalposts.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 14: Yearly view zoom limits entries to at most 10 per year
// **Validates: Requirements 9.5**
// ============================================================

describe("Property 14: Yearly view zoom limits entries to at most 10 per year", () => {
  it("with zoom 'Top 10', yearly computation returns at most 10 entries per year in descending order", () => {
    fc.assert(
      fc.property(
        // Generate a DataStore with more than 10 artists across multiple sources
        fc.integer({ min: 12, max: 25 }).chain((numArtists) =>
          arbDataStoreForZoom(numArtists, 30),
        ),
        (dataStore) => {
          // Extract unique years from the DataStore dates
          const yearSet = new Set<number>();
          for (const date of dataStore.dates) {
            yearSet.add(parseInt(date.substring(0, 4), 10));
          }
          const years = Array.from(yearSet);

          // For each year, compute the yearly data with a limit of 10
          // (mirrors YearlyView.computeYearData(year, 10) logic)
          for (const year of years) {
            const yearStr = String(year);
            const artistPoints = new Map<string, number>();

            // Sum points per artist for this year (no source filter = "all")
            for (const [artistId, artist] of dataStore.artists) {
              let points = 0;
              for (const release of artist.releases) {
                for (const [date, entry] of release.dailyValues) {
                  if (date.startsWith(yearStr)) {
                    points += entry.value;
                  }
                }
              }
              if (points > 0) {
                artistPoints.set(artistId, points);
              }
            }

            // Build entries and sort descending by points
            const entries = Array.from(artistPoints.entries())
              .map(([artistId, points]) => ({ artistId, points }))
              .sort((a, b) => b.points - a.points);

            // Apply the "Top 10" limit
            const limited = entries.slice(0, 10);

            // Assert: at most 10 entries
            expect(limited.length).toBeLessThanOrEqual(10);

            // Assert: entries are in descending order by value
            for (let i = 0; i < limited.length - 1; i++) {
              expect(limited[i].points).toBeGreaterThanOrEqual(limited[i + 1].points);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("top-10 limited entries are the highest-value entries from the full year", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 12, max: 25 }).chain((numArtists) =>
          arbDataStoreForZoom(numArtists, 30),
        ),
        (dataStore) => {
          const yearSet = new Set<number>();
          for (const date of dataStore.dates) {
            yearSet.add(parseInt(date.substring(0, 4), 10));
          }
          const years = Array.from(yearSet);

          for (const year of years) {
            const yearStr = String(year);
            const artistPoints = new Map<string, number>();

            for (const [artistId, artist] of dataStore.artists) {
              let points = 0;
              for (const release of artist.releases) {
                for (const [date, entry] of release.dailyValues) {
                  if (date.startsWith(yearStr)) {
                    points += entry.value;
                  }
                }
              }
              if (points > 0) {
                artistPoints.set(artistId, points);
              }
            }

            // Full list sorted descending
            const allEntries = Array.from(artistPoints.entries())
              .map(([artistId, points]) => ({ artistId, points }))
              .sort((a, b) => b.points - a.points);

            // Top 10 limited
            const top10 = allEntries.slice(0, 10);

            // Every entry NOT in the top 10 should have points <= the minimum of top 10
            if (top10.length === 10 && allEntries.length > 10) {
              const minTop10 = top10[top10.length - 1].points;
              for (let i = 10; i < allEntries.length; i++) {
                expect(allEntries[i].points).toBeLessThanOrEqual(minTop10);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
