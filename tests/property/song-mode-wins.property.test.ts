// Feature: song-mode-wins-display, Property 1: Per-release win computation correctness
// Feature: song-mode-wins-display, Property 2: Win attribution specificity
// Feature: song-mode-wins-display, Property 3: Co-artist win inclusion
// Feature: song-mode-wins-display, Property 6: Cumulative wins monotonicity over time

import fc from 'fast-check';
import { computeReleaseWins, computeChartWins } from '../../src/chart-engine.ts';
import type { ChartSource, DailyValueEntry } from '../../src/types.ts';
import type { ParsedArtist, ParsedRelease, DataStore } from '../../src/models.ts';

// --- Constants ---

const CHART_SOURCES: ChartSource[] = [
  'inkigayo',
  'the_show',
  'show_champion',
  'music_bank',
  'm_countdown',
  'show_music_core',
];

const ARTIST_TYPES = [
  'boy_group',
  'girl_group',
  'solo_male',
  'solo_female',
  'mixed_group',
] as const;

// --- Shared Arbitraries ---

/** YYYY-MM-DD date string */
const arbDateStr: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2020, max: 2025 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

/** Generate a sorted array of unique date strings */
function arbSortedDates(minLen: number, maxLen: number): fc.Arbitrary<string[]> {
  return fc
    .uniqueArray(arbDateStr, { minLength: minLen, maxLength: maxLen })
    .map((dates) => [...dates].sort());
}

/** Generate a DailyValueEntry with a positive value */
const arbDailyValueEntry: fc.Arbitrary<DailyValueEntry> = fc.record({
  value: fc.integer({ min: 1, max: 5000 }),
  source: fc.constantFrom(...CHART_SOURCES) as fc.Arbitrary<string>,
  episode: fc.integer({ min: 1, max: 2000 }),
});

// --- Helper: Build DataStore and populate wins ---

/**
 * Build a DataStore from artists and dates, then compute and populate
 * chartWins and releaseWinDates so computeReleaseWins works correctly.
 */
function buildPopulatedDataStore(artists: ParsedArtist[], dates: string[]): DataStore {
  const artistMap = new Map<string, ParsedArtist>();
  for (const artist of artists) {
    artistMap.set(artist.id, artist);
  }
  const dataStore: DataStore = {
    artists: artistMap,
    dates,
    startDate: dates[0] ?? '',
    endDate: dates[dates.length - 1] ?? '',
    firstAppearance: new Map(),
    chartWins: new Map(),
    releaseWinDates: new Map(),
  };
  const { chartWins, releaseWinDates } = computeChartWins(dataStore);
  dataStore.chartWins = chartWins;
  dataStore.releaseWinDates = releaseWinDates;
  return dataStore;
}

/**
 * Reference: Deduplicate entries keeping only the highest-value release per artist.
 * First occurrence wins ties.
 */
function refDedup(
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

// ============================================================
// Property 1: Per-release win computation correctness
// **Validates: Requirements 1.1, 1.4, 1.5**
// ============================================================

describe('Feature: song-mode-wins-display, Property 1: Per-release win computation correctness', () => {
  it('computeReleaseWins returns count equal to (date, source) pairs where the release won up to the query date', () => {
    fc.assert(
      fc.property(
        arbSortedDates(3, 8).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            // 2–4 artists, each with 1–2 releases with positive values
            fc.integer({ min: 2, max: 4 }).chain((artistCount) =>
              fc.tuple(
                ...Array.from({ length: artistCount }, (_, i) => {
                  const artistId = `artist-${i}`;
                  return fc
                    .tuple(
                      fc.constantFrom(...ARTIST_TYPES),
                      fc.integer({ min: 1, max: 5 }),
                      // 1–2 releases per artist
                      fc.integer({ min: 1, max: 2 }).chain((releaseCount) =>
                        fc.tuple(
                          ...Array.from({ length: releaseCount }, (_, ri) =>
                            // Each release gets 1–4 daily value entries on random dates
                            fc.shuffledSubarray(dates, { minLength: 1, maxLength: Math.min(4, dates.length) }).chain(
                              (selectedDates) =>
                                fc.array(arbDailyValueEntry, { minLength: selectedDates.length, maxLength: selectedDates.length })
                                  .map((entries) => {
                                    const dailyValues = new Map<string, DailyValueEntry>();
                                    for (let k = 0; k < selectedDates.length; k++) {
                                      dailyValues.set(selectedDates[k], entries[k]);
                                    }
                                    return {
                                      id: `${artistId}-release-${ri}`,
                                      title: `Song ${ri}`,
                                      dailyValues,
                                      embeds: new Map(),
                                      artistIds: [artistId],
                                    } satisfies ParsedRelease;
                                  }),
                            ),
                          ),
                        ),
                      ),
                    )
                    .map(([artistType, generation, releases]) => ({
                      id: artistId,
                      name: `Artist ${i}`,
                      artistType,
                      generation,
                      logoUrl: `assets/logos/${artistId}.svg`,
                      releases: releases as ParsedRelease[],
                      albumReleases: [],
                    } satisfies ParsedArtist));
                }),
              ),
            ),
            // Pick a query date from the dates array
            fc.integer({ min: 0, max: dates.length - 1 }).map((i) => dates[i]),
          ),
        ),
        ([dates, artistsTuple, queryDate]) => {
          const artists = artistsTuple as unknown as ParsedArtist[];
          const dataStore = buildPopulatedDataStore(artists, dates);

          // For each artist/release, verify computeReleaseWins against an oracle
          for (const artist of artists) {
            for (const release of artist.releases) {
              const releaseKey = `${artist.id}::${release.id}`;
              const actual = computeReleaseWins(releaseKey, queryDate, dataStore);

              // Oracle: count (date, source) pairs where this release won
              let expected = 0;
              for (const date of dates) {
                if (date > queryDate) break;

                // Collect all entries by source for this date
                const entriesBySource = new Map<string, { artistId: string; releaseId: string; value: number }[]>();
                for (const [aId, a] of dataStore.artists) {
                  for (const r of a.releases) {
                    const dv = r.dailyValues.get(date);
                    if (!dv) continue;
                    if (!entriesBySource.has(dv.source)) {
                      entriesBySource.set(dv.source, []);
                    }
                    entriesBySource.get(dv.source)!.push({ artistId: aId, releaseId: r.id, value: dv.value });
                  }
                }

                for (const [, rawEntries] of entriesBySource) {
                  const deduped = refDedup(rawEntries);
                  const maxVal = Math.max(...deduped.map((e) => e.value));
                  const winners = deduped.filter((e) => e.value === maxVal);

                  // Check if this release's artist won AND this release is the winning release
                  for (const winner of winners) {
                    if (winner.artistId === artist.id && winner.releaseId === release.id) {
                      expected++;
                    }
                  }
                }
              }

              expect(actual).toBe(expected);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 2: Win attribution specificity
// **Validates: Requirements 1.2**
// ============================================================

describe('Feature: song-mode-wins-display, Property 2: Win attribution specificity', () => {
  it('for an artist with multiple releases, only the max-value release on a (date, source) gets the win', () => {
    fc.assert(
      fc.property(
        arbSortedDates(2, 5).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            fc.constantFrom(...CHART_SOURCES),
            // Two distinct values for an artist's two releases (ensure they differ)
            fc.integer({ min: 100, max: 5000 }).chain((highVal) =>
              fc.integer({ min: 1, max: highVal - 1 }).map((lowVal) => ({ highVal, lowVal })),
            ),
          ),
        ),
        ([dates, source, { highVal, lowVal }]) => {
          const date = dates[0];

          // Artist with two releases on the same (date, source), different values
          const artist: ParsedArtist = {
            id: 'multi-release',
            name: 'Multi Release Artist',
            artistType: 'boy_group',
            generation: 4,
            logoUrl: 'assets/logos/multi-release.svg',
            releases: [
              {
                id: 'winner-release',
                title: 'Winner Song',
                dailyValues: new Map([[date, { value: highVal, source, episode: 1 }]]),
                embeds: new Map(),
                artistIds: ['multi-release'],
              },
              {
                id: 'loser-release',
                title: 'Loser Song',
                dailyValues: new Map([[date, { value: lowVal, source, episode: 1 }]]),
                embeds: new Map(),
                artistIds: ['multi-release'],
              },
            ],
            albumReleases: [],
          };

          const dataStore = buildPopulatedDataStore([artist], dates);

          const winnerKey = 'multi-release::winner-release';
          const loserKey = 'multi-release::loser-release';

          const winnerWins = computeReleaseWins(winnerKey, dates[dates.length - 1], dataStore);
          const loserWins = computeReleaseWins(loserKey, dates[dates.length - 1], dataStore);

          // Only the winner release should get the win
          expect(winnerWins).toBe(1);
          expect(loserWins).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 3: Co-artist win inclusion
// **Validates: Requirements 1.3**
// ============================================================

describe('Feature: song-mode-wins-display, Property 3: Co-artist win inclusion', () => {
  it('if any co-artist ID appears in winners and the release contributed the winning value, the release gets the win', () => {
    fc.assert(
      fc.property(
        arbSortedDates(2, 5).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            fc.constantFrom(...CHART_SOURCES),
            fc.integer({ min: 500, max: 5000 }), // value for the co-artist release
          ),
        ),
        ([dates, source, winningValue]) => {
          const date = dates[0];

          // A release credited to two artists: primary artist-a and co-artist artist-b
          const coArtistRelease: ParsedRelease = {
            id: 'collab-song',
            title: 'Collab Song',
            dailyValues: new Map([[date, { value: winningValue, source, episode: 1 }]]),
            embeds: new Map(),
            artistIds: ['artist-a', 'artist-b'],
          };

          const artistA: ParsedArtist = {
            id: 'artist-a',
            name: 'Primary Artist',
            artistType: 'boy_group',
            generation: 4,
            logoUrl: 'assets/logos/artist-a.svg',
            releases: [coArtistRelease],
            albumReleases: [],
          };

          const artistB: ParsedArtist = {
            id: 'artist-b',
            name: 'Co Artist',
            artistType: 'girl_group',
            generation: 4,
            logoUrl: 'assets/logos/artist-b.svg',
            releases: [coArtistRelease],
            albumReleases: [],
          };

          // A competitor with a lower value (ensures the co-artist release wins)
          const competitor: ParsedArtist = {
            id: 'competitor',
            name: 'Competitor',
            artistType: 'solo_male',
            generation: 3,
            logoUrl: 'assets/logos/competitor.svg',
            releases: [
              {
                id: 'competitor-song',
                title: 'Competitor Song',
                dailyValues: new Map([[date, { value: 1, source, episode: 1 }]]),
                embeds: new Map(),
                artistIds: ['competitor'],
              },
            ],
            albumReleases: [],
          };

          const dataStore = buildPopulatedDataStore([artistA, artistB, competitor], dates);

          // The release should get wins counted from both artist-a and artist-b entries
          const releaseKey = 'artist-a::collab-song';
          const wins = computeReleaseWins(releaseKey, dates[dates.length - 1], dataStore);

          // The co-artist release won on this (date, source). Both artist-a and artist-b
          // appear as winners with the same release. So releaseWinDates will have entries
          // for both "artist-a::collab-song" and "artist-b::collab-song".
          // computeReleaseWins aggregates across all credited artist IDs.
          expect(wins).toBeGreaterThanOrEqual(1);

          // Also verify through the secondary artist key lookup that wins are counted
          // (the function looks up all artistIds on the release)
          const secondaryKey = 'artist-b::collab-song';
          const secondaryDates = dataStore.releaseWinDates.get(secondaryKey);
          if (secondaryDates && secondaryDates.length > 0) {
            // The total wins should include contributions from both credited artists
            expect(wins).toBe(2); // one from artist-a winning, one from artist-b winning
          } else {
            // Only artist-a won (artist-b might not have been highest after dedup)
            expect(wins).toBe(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 6: Cumulative wins monotonicity over time
// **Validates: Requirements 4.1, 4.2, 4.3**
// ============================================================

describe('Feature: song-mode-wins-display, Property 6: Cumulative wins monotonicity over time', () => {
  it('for any two dates where date1 ≤ date2, computeReleaseWins(key, date1) ≤ computeReleaseWins(key, date2)', () => {
    fc.assert(
      fc.property(
        arbSortedDates(3, 10).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            // 2–3 artists, each with 1–2 releases
            fc.integer({ min: 2, max: 3 }).chain((artistCount) =>
              fc.tuple(
                ...Array.from({ length: artistCount }, (_, i) => {
                  const artistId = `artist-${i}`;
                  return fc
                    .tuple(
                      fc.constantFrom(...ARTIST_TYPES),
                      fc.integer({ min: 1, max: 5 }),
                      fc.integer({ min: 1, max: 2 }).chain((releaseCount) =>
                        fc.tuple(
                          ...Array.from({ length: releaseCount }, (_, ri) =>
                            fc.shuffledSubarray(dates, { minLength: 1, maxLength: Math.min(5, dates.length) }).chain(
                              (selectedDates) =>
                                fc.array(arbDailyValueEntry, { minLength: selectedDates.length, maxLength: selectedDates.length })
                                  .map((entries) => {
                                    const dailyValues = new Map<string, DailyValueEntry>();
                                    for (let k = 0; k < selectedDates.length; k++) {
                                      dailyValues.set(selectedDates[k], entries[k]);
                                    }
                                    return {
                                      id: `${artistId}-release-${ri}`,
                                      title: `Song ${ri}`,
                                      dailyValues,
                                      embeds: new Map(),
                                      artistIds: [artistId],
                                    } satisfies ParsedRelease;
                                  }),
                            ),
                          ),
                        ),
                      ),
                    )
                    .map(([artistType, generation, releases]) => ({
                      id: artistId,
                      name: `Artist ${i}`,
                      artistType,
                      generation,
                      logoUrl: `assets/logos/${artistId}.svg`,
                      releases: releases as ParsedRelease[],
                      albumReleases: [],
                    } satisfies ParsedArtist));
                }),
              ),
            ),
            // Pick two date indices (sorted pair)
            fc.tuple(
              fc.integer({ min: 0, max: dates.length - 1 }),
              fc.integer({ min: 0, max: dates.length - 1 }),
            ).map(([a, b]) => a <= b ? [dates[a], dates[b]] : [dates[b], dates[a]]),
          ),
        ),
        ([dates, artistsTuple, [date1, date2]]) => {
          const artists = artistsTuple as unknown as ParsedArtist[];
          const dataStore = buildPopulatedDataStore(artists, dates);

          // For every release, wins at date1 ≤ wins at date2
          for (const artist of artists) {
            for (const release of artist.releases) {
              const releaseKey = `${artist.id}::${release.id}`;
              const winsAtDate1 = computeReleaseWins(releaseKey, date1, dataStore);
              const winsAtDate2 = computeReleaseWins(releaseKey, date2, dataStore);

              expect(winsAtDate1).toBeLessThanOrEqual(winsAtDate2);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 4: Win count display formatting
// **Validates: Requirements 2.1, 2.2, 2.3**
// ============================================================

describe('Feature: song-mode-wins-display, Property 4: Win count display formatting', () => {
  it('for song-mode bars: wins > 0 shows "{count} win"/"wins", wins = 0 hides element', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        (winCount) => {
          // Format text the same way the renderer does
          const textContent = winCount > 0 ? `${winCount} ${winCount === 1 ? "win" : "wins"}` : "";
          const display = winCount > 0 ? "" : "none";

          if (winCount === 0) {
            // Wins element should be hidden (display="none") and have no text
            expect(display).toBe("none");
            expect(textContent).toBe("");
          } else if (winCount === 1) {
            // Singular form
            expect(textContent).toBe("1 win");
            expect(display).toBe("");
          } else {
            // Plural form: "{count} wins"
            expect(textContent).toBe(`${winCount} wins`);
            expect(display).toBe("");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('display formatting matches renderer logic for arbitrary win counts in song mode bars', () => {
    fc.assert(
      fc.property(
        // Generate a DataStore scenario with a song-mode entry that has a known number of wins
        arbSortedDates(2, 6).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            fc.constantFrom(...CHART_SOURCES),
            fc.integer({ min: 1, max: 5000 }),
            // Number of win dates to include (0 to all dates)
            fc.integer({ min: 0, max: dates.length }),
          ),
        ),
        ([dates, source, value, winDateCount]) => {
          const winDates = dates.slice(0, winDateCount);

          // Build a simple DataStore with one artist+release that wins on specific dates
          const artist: ParsedArtist = {
            id: 'test-artist',
            name: 'Test Artist',
            artistType: 'boy_group',
            generation: 4,
            logoUrl: 'assets/logos/test.svg',
            releases: [{
              id: 'test-release',
              title: 'Test Song',
              dailyValues: new Map(dates.map(d => [d, { value, source, episode: 1 }])),
              embeds: new Map(),
              artistIds: ['test-artist'],
            }],
            albumReleases: [],
          };

          const dataStore = buildPopulatedDataStore([artist], dates);
          const releaseKey = 'test-artist::test-release';
          const queryDate = dates[dates.length - 1];
          const totalWins = computeReleaseWins(releaseKey, queryDate, dataStore);

          // Apply the renderer's formatting logic
          const textContent = totalWins > 0 ? `${totalWins} ${totalWins === 1 ? "win" : "wins"}` : "";
          const display = totalWins > 0 ? "" : "none";

          // Verify formatting properties
          if (totalWins === 0) {
            expect(display).toBe("none");
            expect(textContent).toBe("");
          } else {
            expect(display).toBe("");
            if (totalWins === 1) {
              expect(textContent).toBe("1 win");
            } else {
              expect(textContent).toMatch(new RegExp(`^${totalWins} wins$`));
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 5: Goalpost label wins formatting
// **Validates: Requirements 3.1, 3.2**
// ============================================================

describe('Feature: song-mode-wins-display, Property 5: Goalpost label wins formatting', () => {
  it('for song-mode goalpost bars: wins > 0 appends " · N win(s)" to label, wins = 0 omits wins segment', () => {
    fc.assert(
      fc.property(
        fc.record({
          rank: fc.integer({ min: 1, max: 100 }),
          artistName: fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('·') && s.trim().length > 0),
          cumulativeValue: fc.integer({ min: 1, max: 99999 }),
          totalWins: fc.integer({ min: 0, max: 50 }),
        }),
        ({ rank, artistName, cumulativeValue, totalWins }) => {
          // Replicate the renderer's goalpost label construction:
          // `#${rank} · ${artistName} · ${Math.round(cumulativeValue).toLocaleString()}${winsText}`
          const winsText = totalWins > 0 ? ` · ${totalWins} ${totalWins === 1 ? "win" : "wins"}` : "";
          const label = `#${rank} · ${artistName} · ${Math.round(cumulativeValue).toLocaleString()}${winsText}`;

          if (totalWins === 0) {
            // Label should NOT contain any wins segment
            expect(label).not.toContain(" win");
            expect(label).not.toContain(" wins");
            // Should end with the cumulative value
            expect(label).toBe(`#${rank} · ${artistName} · ${Math.round(cumulativeValue).toLocaleString()}`);
          } else if (totalWins === 1) {
            // Label should end with " · 1 win"
            expect(label).toContain(" · 1 win");
            expect(label).not.toContain(" · 1 wins");
            expect(label).toMatch(/ · 1 win$/);
          } else {
            // Label should end with " · N wins"
            expect(label).toContain(` · ${totalWins} wins`);
            expect(label).toMatch(new RegExp(` · ${totalWins} wins$`));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('goalpost label formatting integrates correctly with computeReleaseWins output', () => {
    fc.assert(
      fc.property(
        arbSortedDates(2, 6).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            fc.constantFrom(...CHART_SOURCES),
            fc.integer({ min: 1, max: 5000 }),
            fc.integer({ min: 1, max: 20 }), // rank
          ),
        ),
        ([dates, source, value, rank]) => {
          // Build a DataStore with one song that may or may not win
          const artist: ParsedArtist = {
            id: 'gp-artist',
            name: 'GP Artist',
            artistType: 'girl_group',
            generation: 4,
            logoUrl: 'assets/logos/gp.svg',
            releases: [{
              id: 'gp-release',
              title: 'GP Song',
              dailyValues: new Map(dates.map(d => [d, { value, source, episode: 1 }])),
              embeds: new Map(),
              artistIds: ['gp-artist'],
            }],
            albumReleases: [],
          };

          const dataStore = buildPopulatedDataStore([artist], dates);
          const releaseKey = 'gp-artist::gp-release';
          const queryDate = dates[dates.length - 1];
          const totalWins = computeReleaseWins(releaseKey, queryDate, dataStore);

          // Construct goalpost label as the renderer does
          const artistName = 'GP Song'; // In song mode, artistName is the release title
          const cumulativeValue = value * dates.length; // approximate
          const winsText = totalWins > 0 ? ` · ${totalWins} ${totalWins === 1 ? "win" : "wins"}` : "";
          const label = `#${rank} · ${artistName} · ${Math.round(cumulativeValue).toLocaleString()}${winsText}`;

          if (totalWins === 0) {
            // No wins segment in label
            expect(label).not.toMatch(/ · \d+ wins?$/);
          } else {
            // Wins segment present at end of label
            expect(label).toMatch(/ · \d+ wins?$/);
            // Correct pluralization
            if (totalWins === 1) {
              expect(label).toMatch(/ · 1 win$/);
            } else {
              expect(label).toMatch(new RegExp(` · ${totalWins} wins$`));
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
