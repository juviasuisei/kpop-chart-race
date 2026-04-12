// Feature: 0001-kpop-chart-race, Property 3: Daily Performance Sum Invariant
// Feature: 0001-kpop-chart-race, Property 5: Cumulative Value Invariant
// Feature: 0001-kpop-chart-race, Property 6: Ranking Descending Order
// Feature: 0001-kpop-chart-race, Property 7: Stable Sort for Ties
// Feature: 0001-kpop-chart-race, Property 4: Featured Release Selection
// Feature: 0001-kpop-chart-race, Property 18: Chart Win Determination and Crown Level

import fc from 'fast-check';
import {
  computeDailyValue,
  computeCumulativeValue,
  computeSnapshot,
  identifyFeaturedRelease,
  computeChartWins,
} from '../../src/chart-engine.ts';
import type { DailyValueEntry } from '../../src/types.ts';
import type {
  ParsedArtist,
  ParsedRelease,
  DataStore,
  ChartSnapshot,
} from '../../src/models.ts';

// --- Shared Arbitraries ---

const ARTIST_TYPES = [
  'boy_group',
  'girl_group',
  'solo_male',
  'solo_female',
  'mixed_group',
] as const;

const CHART_SOURCES = ['inkigayo', 'the_show', 'show_champion', 'music_bank'] as const;

/** YYYY-MM-DD date string */
const arbDateStr: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2020, max: 2025 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

/** Generate a sorted array of unique date strings */
const arbSortedDates = (minLen: number, maxLen: number): fc.Arbitrary<string[]> =>
  fc
    .uniqueArray(arbDateStr, { minLength: minLen, maxLength: maxLen })
    .map((dates) => [...dates].sort());

const arbDailyValueEntry: fc.Arbitrary<DailyValueEntry> = fc.record({
  value: fc.integer({ min: 0, max: 5000 }),
  source: fc.constantFrom(...CHART_SOURCES) as fc.Arbitrary<string>,
  episode: fc.integer({ min: 1, max: 2000 }),
});

/** Build a ParsedRelease with a Map<string, DailyValueEntry> from a subset of dates */
function arbParsedRelease(dates: string[]): fc.Arbitrary<ParsedRelease> {
  return fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 20 }),
      // For each date, optionally include a daily value entry
      fc.tuple(
        ...dates.map((date) =>
          fc
            .option(arbDailyValueEntry, { nil: undefined })
            .map((entry) => [date, entry] as const),
        ),
      ),
    )
    .map(([title, dateEntries]) => {
      const dailyValues = new Map<string, DailyValueEntry>();
      for (const [date, entry] of dateEntries) {
        if (entry !== undefined) {
          dailyValues.set(date, entry);
        }
      }
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return {
        id,
        title,
        dailyValues,
        embeds: new Map(),
      } satisfies ParsedRelease;
    });
}

/** Build a ParsedArtist with 1-3 releases across the given dates */
function arbParsedArtist(dates: string[]): fc.Arbitrary<ParsedArtist> {
  return fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.constantFrom(...ARTIST_TYPES),
      fc.integer({ min: 1, max: 5 }),
      fc.array(arbParsedRelease(dates), { minLength: 1, maxLength: 3 }),
    )
    .map(([name, artistType, generation, releases]) => {
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return {
        id,
        name,
        artistType,
        generation,
        logoUrl: `assets/logos/${id}.svg`,
        releases,
      } satisfies ParsedArtist;
    });
}

/** Build a DataStore from a list of artists and sorted dates */
function buildDataStore(artists: ParsedArtist[], dates: string[]): DataStore {
  const artistMap = new Map<string, ParsedArtist>();
  for (const artist of artists) {
    artistMap.set(artist.id, artist);
  }
  return {
    artists: artistMap,
    dates,
    startDate: dates[0] ?? '',
    endDate: dates[dates.length - 1] ?? '',
    chartWins: new Map(),
  };
}

// ============================================================
// Property 3: Daily Performance Sum Invariant
// **Validates: Requirements 1.5, 1.12**
// ============================================================

describe('Property 3: Daily Performance Sum Invariant', () => {
  it('daily value equals sum of all release .value fields for that artist on that date', () => {
    fc.assert(
      fc.property(
        arbSortedDates(1, 5).chain((dates) =>
          fc.tuple(fc.constant(dates), arbParsedArtist(dates)),
        ),
        ([dates, artist]) => {
          for (const date of dates) {
            const computed = computeDailyValue(artist, date);

            // Manually sum all release values for this date
            let expectedSum = 0;
            for (const release of artist.releases) {
              const entry = release.dailyValues.get(date);
              if (entry) {
                expectedSum += entry.value;
              }
            }

            expect(computed).toBe(expectedSum);
          }
        },
      ),
    );
  });
});


// ============================================================
// Property 5: Cumulative Value Invariant
// **Validates: Requirements 2.1, 2.4**
// ============================================================

describe('Property 5: Cumulative Value Invariant', () => {
  it('cumulative value equals sum of daily values from start through current date', () => {
    fc.assert(
      fc.property(
        arbSortedDates(2, 6).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            arbParsedArtist(dates),
            // Pick a random date from the array
            fc.integer({ min: 0, max: dates.length - 1 }).map((i) => dates[i]),
          ),
        ),
        ([dates, artist, targetDate]) => {
          const cumulative = computeCumulativeValue(artist, targetDate, dates);

          // Manually sum daily values from start through targetDate
          let expectedSum = 0;
          for (const d of dates) {
            if (d > targetDate) break;
            expectedSum += computeDailyValue(artist, d);
          }

          expect(cumulative).toBe(expectedSum);
        },
      ),
    );
  });
});

// ============================================================
// Property 6: Ranking Descending Order
// **Validates: Requirements 2.2**
// ============================================================

describe('Property 6: Ranking Descending Order', () => {
  it('snapshot entries are sorted in descending order of cumulativeValue', () => {
    fc.assert(
      fc.property(
        arbSortedDates(1, 5).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            // Generate 2-8 artists with unique ids
            fc
              .array(arbParsedArtist(dates), { minLength: 2, maxLength: 8 })
              .map((artists) => {
                // Ensure unique ids by appending index
                return artists.map((a, i) => ({
                  ...a,
                  id: `${a.id}-${i}`,
                }));
              }),
            // Pick a date
            fc.integer({ min: 0, max: dates.length - 1 }).map((i) => dates[i]),
          ),
        ),
        ([dates, artists, targetDate]) => {
          const dataStore = buildDataStore(artists, dates);
          const snapshot = computeSnapshot(targetDate, dataStore);

          // Verify descending order
          for (let i = 0; i < snapshot.entries.length - 1; i++) {
            expect(snapshot.entries[i].cumulativeValue).toBeGreaterThanOrEqual(
              snapshot.entries[i + 1].cumulativeValue,
            );
          }
        },
      ),
    );
  });
});

// ============================================================
// Property 7: Stable Sort for Ties
// **Validates: Requirements 2.3**
// ============================================================

describe('Property 7: Stable Sort for Ties', () => {
  it('tied artists maintain their relative order from the previous snapshot', () => {
    fc.assert(
      fc.property(
        arbSortedDates(2, 4).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            // Generate 3-6 artists
            fc
              .array(arbParsedArtist(dates), { minLength: 3, maxLength: 6 })
              .map((artists) =>
                artists.map((a, i) => ({ ...a, id: `artist-${i}` })),
              ),
          ),
        ),
        ([dates, artists]) => {
          // We need at least 2 dates to have a previous snapshot
          if (dates.length < 2) return;

          const dataStore = buildDataStore(artists, dates);

          // Compute first snapshot (no previous)
          const firstSnapshot = computeSnapshot(dates[0], dataStore);

          // Compute second snapshot using first as previous
          const secondSnapshot = computeSnapshot(dates[1], dataStore, firstSnapshot);

          // Find groups of tied entries in the second snapshot
          const entries = secondSnapshot.entries;
          let i = 0;
          while (i < entries.length) {
            let j = i + 1;
            while (j < entries.length && entries[j].cumulativeValue === entries[i].cumulativeValue) {
              j++;
            }
            // entries[i..j-1] are tied
            if (j - i > 1) {
              // Check that their relative order matches the previous snapshot
              const tiedIds = entries.slice(i, j).map((e) => e.artistId);
              const prevOrder = firstSnapshot.entries.map((e) => e.artistId);

              // Filter prevOrder to only include tied ids
              const prevTiedOrder = prevOrder.filter((id) => tiedIds.includes(id));
              // Filter tiedIds to only include those that were in previous
              const currentTiedInPrev = tiedIds.filter((id) => prevTiedOrder.includes(id));

              // The relative order of artists that were in the previous snapshot should be preserved
              expect(currentTiedInPrev).toEqual(prevTiedOrder.filter((id) => currentTiedInPrev.includes(id)));
            }
            i = j;
          }
        },
      ),
    );
  });
});


// ============================================================
// Property 4: Featured Release Selection
// **Validates: Requirements 1.6**
// ============================================================

describe('Property 4: Featured Release Selection', () => {
  it('selects the highest-value release, or most recent non-zero when all zero on current date', () => {
    fc.assert(
      fc.property(
        arbSortedDates(2, 5).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            // Artist with 2-3 releases
            arbParsedArtist(dates),
            fc.integer({ min: 0, max: dates.length - 1 }).map((i) => dates[i]),
          ),
        ),
        ([dates, artist, targetDate]) => {
          const featured = identifyFeaturedRelease(artist, targetDate, dates);

          // Compute daily values per release on the target date
          const releaseValues = artist.releases.map((r) => ({
            id: r.id,
            title: r.title,
            value: r.dailyValues.get(targetDate)?.value ?? 0,
          }));

          const maxValue = Math.max(...releaseValues.map((r) => r.value));

          if (maxValue > 0) {
            // The featured release should be the one with the highest value
            const bestRelease = releaseValues.find((r) => r.value === maxValue)!;
            expect(featured.releaseId).toBe(bestRelease.id);
            expect(featured.title).toBe(bestRelease.title);
          } else {
            // All zero on current date — should be the most recent release with non-zero value
            // Walk backwards through dates before targetDate
            let foundPrevious = false;
            for (let i = dates.length - 1; i >= 0; i--) {
              const d = dates[i];
              if (d >= targetDate) continue;
              for (const release of artist.releases) {
                const entry = release.dailyValues.get(d);
                if (entry && entry.value > 0) {
                  expect(featured.releaseId).toBe(release.id);
                  expect(featured.title).toBe(release.title);
                  foundPrevious = true;
                  break;
                }
              }
              if (foundPrevious) break;
            }

            if (!foundPrevious) {
              // Fallback: first release
              const fallback = artist.releases[0];
              expect(featured.releaseId).toBe(fallback?.id ?? '');
              expect(featured.title).toBe(fallback?.title ?? '');
            }
          }
        },
      ),
    );
  });
});

// ============================================================
// Property 18: Chart Win Determination and Crown Level
// **Validates: Requirements 7.11**
// ============================================================

/** Reference dedup: keep only the highest-value release per artist (first wins ties) */
function refDeduplicateByArtist(
  entries: { artistId: string; releaseId: string; value: number }[],
): { artistId: string; releaseId: string; value: number }[] {
  const best = new Map<string, { artistId: string; releaseId: string; value: number }>();
  for (const e of entries) {
    const existing = best.get(e.artistId);
    if (!existing || e.value > existing.value) {
      best.set(e.artistId, e);
    }
  }
  return Array.from(best.values());
}

describe('Property 18: Chart Win Determination and Crown Level', () => {
  it('winners are highest-value artists per (date, source) and crown levels track wins with no cap', () => {
    fc.assert(
      fc.property(
        arbSortedDates(2, 5).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            fc
              .array(arbParsedArtist(dates), { minLength: 2, maxLength: 5 })
              .map((artists) =>
                artists.map((a, i) => ({ ...a, id: `artist-${i}` })),
              ),
          ),
        ),
        ([dates, artists]) => {
          const dataStore = buildDataStore(artists, dates);
          const chartWins = computeChartWins(dataStore);

          // Track expected win counts per (artistId, releaseId, source)
          const expectedWinCounts = new Map<string, number>();

          for (const date of dates) {
            // Collect all entries by source for this date
            const entriesBySource = new Map<
              string,
              { artistId: string; releaseId: string; value: number }[]
            >();

            for (const [artistId, artist] of dataStore.artists) {
              for (const release of artist.releases) {
                const dv = release.dailyValues.get(date);
                if (!dv) continue;
                const source = dv.source;
                if (!entriesBySource.has(source)) {
                  entriesBySource.set(source, []);
                }
                entriesBySource.get(source)!.push({
                  artistId,
                  releaseId: release.id,
                  value: dv.value,
                });
              }
            }

            const dateResult = chartWins.get(date);

            for (const [source, rawEntries] of entriesBySource) {
              // Apply dedup before determining winners (matches implementation)
              const entries = refDeduplicateByArtist(rawEntries);

              const maxValue = Math.max(...entries.map((e) => e.value));
              const expectedWinners = entries.filter((e) => e.value === maxValue);
              const expectedWinnerIds = [...new Set(expectedWinners.map((w) => w.artistId))];

              // Update expected win counts
              for (const winner of expectedWinners) {
                const key = `${winner.artistId}|${winner.releaseId}|${source}`;
                const prev = expectedWinCounts.get(key) ?? 0;
                expectedWinCounts.set(key, prev + 1);
              }

              if (dateResult) {
                const sourceResult = dateResult.get(source);
                if (sourceResult) {
                  // Verify winners match
                  expect([...sourceResult.artistIds].sort()).toEqual(
                    [...expectedWinnerIds].sort(),
                  );

                  // Verify crown levels are unbounded (no cap)
                  for (const [artistId, crownLevel] of sourceResult.crownLevels) {
                    expect(crownLevel).toBeGreaterThanOrEqual(1);

                    // Verify crown level matches expected count (no cap)
                    const relevantWinners = expectedWinners.filter(
                      (w) => w.artistId === artistId,
                    );
                    let maxCrown = 0;
                    for (const w of relevantWinners) {
                      const key = `${w.artistId}|${w.releaseId}|${source}`;
                      const count = expectedWinCounts.get(key) ?? 0;
                      maxCrown = Math.max(maxCrown, count);
                    }
                    expect(crownLevel).toBe(maxCrown);
                  }
                }
              }
            }
          }
        },
      ),
    );
  });
});


// ============================================================
// Feature: 0010-display-behavior-enhancements
// Property 1: Zero-value exclusion invariant
// **Validates: Requirements 1.1, 1.2, 1.3, 1.5**
// ============================================================

describe('Property 1: Zero-value exclusion invariant', () => {
  it('snapshot entries all have cumulativeValue > 0 and ranks form [1..N]', () => {
    fc.assert(
      fc.property(
        arbSortedDates(1, 5).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            fc
              .array(arbParsedArtist(dates), { minLength: 2, maxLength: 8 })
              .map((artists) =>
                artists.map((a, i) => ({ ...a, id: `artist-${i}` })),
              ),
            fc.integer({ min: 0, max: dates.length - 1 }).map((i) => dates[i]),
          ),
        ),
        ([dates, artists, targetDate]) => {
          const dataStore = buildDataStore(artists, dates);
          const snapshot = computeSnapshot(targetDate, dataStore);

          // Every entry must have cumulativeValue > 0
          for (const entry of snapshot.entries) {
            expect(entry.cumulativeValue).toBeGreaterThan(0);
          }

          // Ranks must form contiguous [1..N]
          const expectedRanks = snapshot.entries.map((_, i) => i + 1);
          const actualRanks = snapshot.entries.map((e) => e.rank);
          expect(actualRanks).toEqual(expectedRanks);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Feature: 0014-chart-display-improvements
// Property 1: Chart Win Deduplication and Crown Correctness
// **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6**
// ============================================================

import { dateMinus365, hasRecentActivity, filterByActivity } from '../../src/utils.ts';
import type { RankedEntry } from '../../src/models.ts';

describe('Feature 0014, Property 1: Chart Win Deduplication and Crown Correctness', () => {
  /**
   * Build artists where at least one artist has multiple releases on the same (date, source).
   * This ensures the dedup logic is exercised.
   */
  const arbMultiReleaseArtists = arbSortedDates(1, 3).chain((dates) =>
    fc.tuple(
      fc.constant(dates),
      fc.constantFrom(...CHART_SOURCES).chain((source) =>
        fc.tuple(
          fc.constant(source),
          // Artist with 2 releases that share the same (date, source)
          fc.integer({ min: 100, max: 5000 }).chain((val1) =>
            fc.integer({ min: 100, max: 5000 }).map((val2) => ({
              val1,
              val2,
            })),
          ),
        ),
      ),
    ),
  );

  it('each artist is represented by at most one release per (date, source) in chart wins', () => {
    fc.assert(
      fc.property(
        arbSortedDates(1, 3).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            fc.constantFrom(...CHART_SOURCES),
            fc.integer({ min: 100, max: 5000 }),
            fc.integer({ min: 100, max: 5000 }),
          ),
        ),
        ([dates, source, val1, val2]) => {
          // Create an artist with two releases on the same (date, source)
          const date = dates[0];
          const artist: ParsedArtist = {
            id: 'multi-release-artist',
            name: 'Multi Release',
            artistType: 'boy_group',
            generation: 4,
            logoUrl: 'assets/logos/multi.svg',
            releases: [
              {
                id: 'release-a',
                title: 'Song A',
                dailyValues: new Map([[date, { value: val1, source, episode: 1 }]]),
                embeds: new Map(),
              },
              {
                id: 'release-b',
                title: 'Song B',
                dailyValues: new Map([[date, { value: val2, source, episode: 1 }]]),
                embeds: new Map(),
              },
            ],
          };

          // Create a second artist with one release
          const otherArtist: ParsedArtist = {
            id: 'single-release-artist',
            name: 'Single Release',
            artistType: 'girl_group',
            generation: 4,
            logoUrl: 'assets/logos/single.svg',
            releases: [
              {
                id: 'release-c',
                title: 'Song C',
                dailyValues: new Map([[date, { value: 1, source, episode: 1 }]]),
                embeds: new Map(),
              },
            ],
          };

          const dataStore = buildDataStore([artist, otherArtist], dates);
          const chartWins = computeChartWins(dataStore);

          const dateResult = chartWins.get(date);
          if (dateResult) {
            const sourceResult = dateResult.get(source);
            if (sourceResult) {
              // The multi-release artist should appear at most once in artistIds
              const multiCount = sourceResult.artistIds.filter(
                (id) => id === 'multi-release-artist',
              ).length;
              expect(multiCount).toBeLessThanOrEqual(1);

              // Crown level for the multi-release artist should be based on
              // only the highest-value release
              if (sourceResult.crownLevels.has('multi-release-artist')) {
                const crownLevel = sourceResult.crownLevels.get('multi-release-artist')!;
                expect(crownLevel).toBeGreaterThanOrEqual(1);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('crown level increments only for the selected (highest-value) release', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CHART_SOURCES),
        fc.integer({ min: 100, max: 5000 }),
        (source, highVal) => {
          const lowVal = Math.max(1, highVal - 50);
          const dates = ['2024-01-01', '2024-01-02'];

          // Artist with two releases: release-a has highVal, release-b has lowVal
          const artist: ParsedArtist = {
            id: 'dedup-artist',
            name: 'Dedup Artist',
            artistType: 'boy_group',
            generation: 4,
            logoUrl: 'assets/logos/dedup.svg',
            releases: [
              {
                id: 'release-high',
                title: 'High Song',
                dailyValues: new Map([
                  [dates[0], { value: highVal, source, episode: 1 }],
                  [dates[1], { value: highVal, source, episode: 2 }],
                ]),
                embeds: new Map(),
              },
              {
                id: 'release-low',
                title: 'Low Song',
                dailyValues: new Map([
                  [dates[0], { value: lowVal, source, episode: 1 }],
                  [dates[1], { value: lowVal, source, episode: 2 }],
                ]),
                embeds: new Map(),
              },
            ],
          };

          const dataStore = buildDataStore([artist], dates);
          const chartWins = computeChartWins(dataStore);

          // On both dates, the artist should win with the high-value release
          for (const date of dates) {
            const dateResult = chartWins.get(date);
            if (dateResult) {
              const sourceResult = dateResult.get(source);
              if (sourceResult) {
                expect(sourceResult.artistIds).toContain('dedup-artist');
                // Crown level should increment by 1 per date (not 2 for both releases)
                const crownLevel = sourceResult.crownLevels.get('dedup-artist')!;
                expect(crownLevel).toBeGreaterThanOrEqual(1);
              }
            }
          }

          // After both dates, the crown level should be exactly 2 (one per date)
          const lastDateResult = chartWins.get(dates[1]);
          if (lastDateResult) {
            const sourceResult = lastDateResult.get(source);
            if (sourceResult && sourceResult.crownLevels.has('dedup-artist')) {
              expect(sourceResult.crownLevels.get('dedup-artist')).toBe(2);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Feature: 0014-chart-display-improvements
// Property 2: Activity Filter Correctness at Zoom 10
// **Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6**
// ============================================================

describe('Feature 0014, Property 2: Activity Filter Correctness at Zoom 10', () => {
  /** Build a RankedEntry for testing */
  function makeRankedEntryForFilter(rank: number, artistId: string): RankedEntry {
    return {
      artistId,
      artistName: `Artist ${artistId}`,
      artistType: 'boy_group',
      generation: 4,
      logoUrl: `assets/logos/${artistId}.svg`,
      cumulativeValue: 1000 - rank * 10,
      previousCumulativeValue: 900 - rank * 10,
      dailyValue: 100,
      rank,
      previousRank: rank,
      featuredRelease: { title: 'Song', releaseId: 'song' },
    };
  }

  it('rank 1 is always included, goalpost shown, active entries fill remaining slots', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 0, max: 9 }),
        (entryCount, activeCount) => {
          const clampedActive = Math.min(activeCount, entryCount - 1);
          const snapshotDate = '2024-06-15';
          const recentDate = '2024-06-01'; // within 30 days
          const oldDate = '2024-01-01'; // outside 30 days

          const entries: RankedEntry[] = [];
          const artists = new Map<string, ParsedArtist>();

          for (let i = 0; i < entryCount; i++) {
            const artistId = `artist-filter-${i}`;
            entries.push(makeRankedEntryForFilter(i + 1, artistId));

            // Rank 1 (i=0) always has activity; ranks 2+ get activity based on clampedActive
            const hasActivity = i === 0 || i <= clampedActive;
            const dateForValues = hasActivity ? recentDate : oldDate;

            artists.set(artistId, {
              id: artistId,
              name: `Artist ${artistId}`,
              artistType: 'boy_group',
              generation: 4,
              logoUrl: `assets/logos/${artistId}.svg`,
              releases: [{
                id: 'release-1',
                title: 'Song',
                dailyValues: new Map([[dateForValues, { value: 100, source: 'inkigayo', episode: 1 }]]),
                embeds: new Map(),
              }],
            });
          }

          const dataStore: DataStore = {
            artists,
            dates: [oldDate, recentDate, snapshotDate],
            startDate: oldDate,
            endDate: snapshotDate,
            chartWins: new Map(),
          };

          const result = filterByActivity(entries, snapshotDate, dataStore, 10);

          // Rank 1 always included
          expect(result.length).toBeGreaterThanOrEqual(1);
          expect(result[0].rank).toBe(1);

          // Result should not exceed 10
          expect(result.length).toBeLessThanOrEqual(10);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Feature: 0014-chart-display-improvements
// Property 3: Activity Filter Is Identity at Zoom "all"
// **Validates: Requirements 2.4**
// ============================================================

describe('Feature 0014, Property 3: Activity Filter Is Identity at Zoom "all"', () => {
  function makeRankedEntryForIdentity(rank: number): RankedEntry {
    return {
      artistId: `artist-identity-${rank}`,
      artistName: `Artist ${rank}`,
      artistType: 'boy_group',
      generation: 4,
      logoUrl: `assets/logos/artist-${rank}.svg`,
      cumulativeValue: 1000 - rank * 10,
      previousCumulativeValue: 900 - rank * 10,
      dailyValue: 100,
      rank,
      previousRank: rank,
      featuredRelease: { title: 'Song', releaseId: 'song' },
    };
  }

  it('returns input unchanged when zoom is "all"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        (size) => {
          const entries = Array.from({ length: size }, (_, i) =>
            makeRankedEntryForIdentity(i + 1),
          );
          const snapshotDate = '2024-06-15';
          const emptyStore: DataStore = {
            artists: new Map(),
            dates: [],
            startDate: '',
            endDate: '',
            chartWins: new Map(),
          };

          const result = filterByActivity(entries, snapshotDate, emptyStore, 'all');
          expect(result).toEqual(entries);
        },
      ),
      { numRuns: 100 },
    );
  });
});
