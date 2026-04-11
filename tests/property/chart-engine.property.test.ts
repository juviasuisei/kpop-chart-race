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

describe('Property 18: Chart Win Determination and Crown Level', () => {
  it('winners are highest-value artists per (date, source) and crown levels track wins capped at 5', () => {
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

            for (const [source, entries] of entriesBySource) {
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

                  // Verify crown levels are capped at 5
                  for (const [artistId, crownLevel] of sourceResult.crownLevels) {
                    expect(crownLevel).toBeGreaterThanOrEqual(1);
                    expect(crownLevel).toBeLessThanOrEqual(5);

                    // Verify crown level matches expected count (capped at 5)
                    // Find the max win count for this artist across their winning releases on this source
                    const relevantWinners = expectedWinners.filter(
                      (w) => w.artistId === artistId,
                    );
                    let maxCrown = 0;
                    for (const w of relevantWinners) {
                      const key = `${w.artistId}|${w.releaseId}|${source}`;
                      const count = expectedWinCounts.get(key) ?? 0;
                      maxCrown = Math.max(maxCrown, Math.min(count, 5));
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
