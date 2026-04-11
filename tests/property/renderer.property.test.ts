// Feature: 0001-kpop-chart-race, Property 9: Tween Interpolation
// Feature: 0001-kpop-chart-race, Property 10: Generation to Roman Numeral Conversion
// Feature: 0001-kpop-chart-race, Property 8: Bar Width Proportionality
// Feature: 0001-kpop-chart-race, Property 11: Zoom Level Filtering
// Feature: 0001-kpop-chart-race, Property 12: Scrubber Position to Date Mapping

import fc from 'fast-check';
import { tween, toRomanNumeral, computeBarWidth, filterByZoom, positionToDate } from '../../src/utils.ts';
import type { RankedEntry } from '../../src/models.ts';

// ============================================================
// Property 9: Tween Interpolation
// **Validates: Requirements 3.4**
// ============================================================

describe('Property 9: Tween Interpolation', () => {
  it('tween(s, e, t) === s + (e - s) * t for any start, end, t ∈ [0,1]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (start, end, t) => {
          const result = tween(start, end, t);
          const expected = start + (end - start) * t;
          expect(result).toBeCloseTo(expected, 10);
        },
      ),
    );
  });

  it('tween(s, e, 0) === start', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100000, max: 100000 }),
        fc.integer({ min: -100000, max: 100000 }),
        (start, end) => {
          expect(tween(start, end, 0)).toBe(start);
        },
      ),
    );
  });

  it('tween(s, e, 1) === end', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100000, max: 100000 }),
        fc.integer({ min: -100000, max: 100000 }),
        (start, end) => {
          expect(tween(start, end, 1)).toBe(end);
        },
      ),
    );
  });
});


// ============================================================
// Property 10: Generation to Roman Numeral Conversion
// **Validates: Requirements 4.7**
// ============================================================

/** Reference implementation for Roman numeral conversion */
function referenceRoman(n: number): string {
  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const numerals = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let remaining = n;
  let result = '';
  for (let i = 0; i < values.length; i++) {
    while (remaining >= values[i]) {
      result += numerals[i];
      remaining -= values[i];
    }
  }
  return `Gen ${result}`;
}

describe('Property 10: Generation to Roman Numeral Conversion', () => {
  it('produces correct "Gen " + Roman numeral for any positive integer 1-100', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (n) => {
          const result = toRomanNumeral(n);
          const expected = referenceRoman(n);
          expect(result).toBe(expected);
        },
      ),
    );
  });

  it('result always starts with "Gen "', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (n) => {
          expect(toRomanNumeral(n)).toMatch(/^Gen [IVXLCDM]+$/);
        },
      ),
    );
  });
});

// ============================================================
// Property 8: Bar Width Proportionality
// **Validates: Requirements 3.3**
// ============================================================

describe('Property 8: Bar Width Proportionality', () => {
  it('bar width is proportional: (cumulativeValue / maxCumulativeValue) * 85', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 1, max: 100000 }),
        (cumulative, max) => {
          const result = computeBarWidth(cumulative, max);
          const expected = (cumulative / max) * 85;
          expect(result).toBeCloseTo(expected, 10);
        },
      ),
    );
  });

  it('returns 0 when maxCumulativeValue is 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        (cumulative) => {
          expect(computeBarWidth(cumulative, 0)).toBe(0);
        },
      ),
    );
  });
});

// ============================================================
// Property 11: Zoom Level Filtering
// **Validates: Requirements 5.2**
// ============================================================

/** Build a minimal RankedEntry for testing */
function makeRankedEntry(rank: number): RankedEntry {
  return {
    artistId: `artist-${rank}`,
    artistName: `Artist ${rank}`,
    artistType: 'boy_group',
    generation: 4,
    logoUrl: `assets/logos/artist-${rank}.svg`,
    cumulativeValue: 1000 - rank,
    previousCumulativeValue: 900 - rank,
    dailyValue: 100,
    rank,
    previousRank: rank,
    featuredRelease: { title: 'Song', releaseId: 'song' },
  };
}

describe('Property 11: Zoom Level Filtering', () => {
  it('returns top-10 entries when zoom is 10, or all when "all"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.constantFrom(10 as const, 'all' as const),
        (size, zoomLevel) => {
          const entries = Array.from({ length: size }, (_, i) => makeRankedEntry(i + 1));
          const filtered = filterByZoom(entries, zoomLevel);

          if (zoomLevel === 'all') {
            expect(filtered.length).toBe(size);
          } else {
            expect(filtered.length).toBe(Math.min(10, size));
          }
        },
      ),
    );
  });

  it('filtered entries are the top-N ranked entries from the full list', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        (size) => {
          const entries = Array.from({ length: size }, (_, i) => makeRankedEntry(i + 1));
          const filtered = filterByZoom(entries, 10);
          const expectedSlice = entries.slice(0, Math.min(10, size));
          expect(filtered).toEqual(expectedSlice);
        },
      ),
    );
  });
});

// ============================================================
// Property 12: Scrubber Position to Date Mapping
// **Validates: Requirements 6.5**
// ============================================================

/** Generate a sorted array of unique YYYY-MM-DD date strings */
const arbSortedDates = (minLen: number, maxLen: number): fc.Arbitrary<string[]> =>
  fc
    .uniqueArray(
      fc
        .tuple(
          fc.integer({ min: 2020, max: 2025 }),
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 }),
        )
        .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
      { minLength: minLen, maxLength: maxLen },
    )
    .map((dates) => [...dates].sort());

describe('Property 12: Scrubber Position to Date Mapping', () => {
  it('returns the correct date at the given position index', () => {
    fc.assert(
      fc.property(
        arbSortedDates(1, 50).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            fc.integer({ min: 0, max: dates.length - 1 }),
          ),
        ),
        ([dates, position]) => {
          const result = positionToDate(position, dates);
          expect(result).toBe(dates[position]);
        },
      ),
    );
  });

  it('is monotonically increasing: higher position → later or equal date', () => {
    fc.assert(
      fc.property(
        arbSortedDates(2, 50).chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            fc.integer({ min: 0, max: dates.length - 2 }),
          ),
        ),
        ([dates, pos]) => {
          const date1 = positionToDate(pos, dates);
          const date2 = positionToDate(pos + 1, dates);
          expect(date2 >= date1).toBe(true);
        },
      ),
    );
  });

  it('clamps at boundaries: negative positions → first date, beyond length → last date', () => {
    fc.assert(
      fc.property(
        arbSortedDates(1, 30),
        fc.integer({ min: -100, max: -1 }),
        fc.integer({ min: 0, max: 100 }),
        (dates, negPos, overflow) => {
          // Negative position clamps to first date
          expect(positionToDate(negPos, dates)).toBe(dates[0]);
          // Position beyond array clamps to last date
          expect(positionToDate(dates.length + overflow, dates)).toBe(dates[dates.length - 1]);
        },
      ),
    );
  });
});


// ============================================================
// Bugfix 0006: Bug Condition — Initial Render Bar Sizing
// **Validates: Requirements 1.1, 1.2, 1.3 (bugfix.md)**
// ============================================================

import { ChartRaceRenderer } from '../../src/chart-race-renderer.ts';
import { EventBus } from '../../src/event-bus.ts';
import type { ChartSnapshot } from '../../src/models.ts';

/** Arbitrary for ArtistType values */
const arbArtistType = fc.constantFrom(
  'boy_group' as const,
  'girl_group' as const,
  'solo_male' as const,
  'solo_female' as const,
  'mixed_group' as const,
);

/** Generate a random RankedEntry with the given rank and cumulative value */
function makeRankedEntryForBugfix(
  rank: number,
  cumulativeValue: number,
  artistName: string,
  artistType: 'boy_group' | 'girl_group' | 'solo_male' | 'solo_female' | 'mixed_group' = 'boy_group',
): RankedEntry {
  return {
    artistId: `artist-bugfix-${rank}-${artistName}`,
    artistName,
    artistType,
    generation: 4,
    logoUrl: `assets/logos/artist-${rank}.svg`,
    cumulativeValue,
    previousCumulativeValue: Math.max(0, cumulativeValue - 100),
    dailyValue: 100,
    rank,
    previousRank: rank,
    featuredRelease: { title: 'Song', releaseId: 'song' },
  };
}

/** Arbitrary for a ChartSnapshot with 2-10 entries */
const arbSnapshot: fc.Arbitrary<ChartSnapshot> = fc
  .integer({ min: 2, max: 10 })
  .chain((size) =>
    fc.tuple(
      fc.array(
        fc.tuple(
          fc.string({ minLength: 2, maxLength: 12 }),
          fc.integer({ min: 100, max: 10000 }),
          arbArtistType,
        ),
        { minLength: size, maxLength: size },
      ),
    ).map(([entries]) => {
      // Sort by cumulative value descending to assign ranks
      const sorted = [...entries].sort((a, b) => b[1] - a[1]);
      const rankedEntries = sorted.map(([name, cumVal, type], i) =>
        makeRankedEntryForBugfix(i + 1, cumVal, name, type),
      );
      return { date: '2024-06-01', entries: rankedEntries } as ChartSnapshot;
    }),
  );

describe('Bugfix 0006: Bug Condition — Initial Render Bar Sizing', () => {
  it('bars should have non-zero height and be vertically distributed on initial render (zoom 10)', () => {
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        // Fresh container per iteration to avoid accumulation
        const container = document.createElement('div');
        document.body.appendChild(container);

        const eventBus = new EventBus();
        const renderer = new ChartRaceRenderer(eventBus);
        renderer.mount(container);

        // Call update synchronously — this is the bug condition (clientHeight === 0 in jsdom)
        renderer.update(snapshot, 10);

        const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
        expect(wrappers.length).toBe(snapshot.entries.length);

        // Each bar wrapper should have a non-zero height
        for (const wrapper of wrappers) {
          const height = parseFloat((wrapper as HTMLElement).style.height);
          expect(height).toBeGreaterThan(0);
        }

        // Bar wrappers should NOT all have the same translateY (unless only 1 entry)
        if (snapshot.entries.length > 1) {
          const transforms = Array.from(wrappers).map(
            (w) => (w as HTMLElement).style.transform,
          );
          const uniqueTransforms = new Set(transforms);
          expect(uniqueTransforms.size).toBeGreaterThan(1);
        }

        renderer.destroy();
        container.remove();
      }),
      { numRuns: 50 },
    );
  });

  it('tied entries should have the same bar width', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10000 }),
        fc.string({ minLength: 2, maxLength: 4 }),
        fc.string({ minLength: 8, maxLength: 12 }),
        arbArtistType,
        (cumulativeValue, shortName, longName, artistType) => {
          // Fresh container per iteration
          const container = document.createElement('div');
          document.body.appendChild(container);

          const eventBus = new EventBus();
          const renderer = new ChartRaceRenderer(eventBus);
          renderer.mount(container);

          const snapshot: ChartSnapshot = {
            date: '2024-06-01',
            entries: [
              makeRankedEntryForBugfix(1, cumulativeValue, shortName, artistType),
              makeRankedEntryForBugfix(2, cumulativeValue, longName, artistType),
            ],
          };

          renderer.update(snapshot, 10);

          const bars = container.querySelectorAll('.chart-race__bar');
          expect(bars.length).toBe(2);

          const width1 = (bars[0] as HTMLElement).style.width;
          const width2 = (bars[1] as HTMLElement).style.width;
          expect(width1).toBe(width2);

          renderer.destroy();
          container.remove();
        },
      ),
      { numRuns: 50 },
    );
  });
});


// ============================================================
// Bugfix 0006: Preservation — Post-Layout Update Behavior
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5 (bugfix.md)**
// ============================================================

/** Arbitrary for a ChartSnapshot with 1-15 entries for preservation tests */
const arbPreservationSnapshot: fc.Arbitrary<ChartSnapshot> = fc
  .integer({ min: 1, max: 15 })
  .chain((size) =>
    fc.tuple(
      fc.array(
        fc.tuple(
          fc.string({ minLength: 2, maxLength: 10 }),
          fc.integer({ min: 100, max: 10000 }),
          arbArtistType,
        ),
        { minLength: size, maxLength: size },
      ),
    ).map(([entries]) => {
      const sorted = [...entries].sort((a, b) => b[1] - a[1]);
      const rankedEntries = sorted.map(([name, cumVal, type], i) =>
        makeRankedEntryForBugfix(i + 1, cumVal, name, type),
      );
      return { date: '2024-06-15', entries: rankedEntries } as ChartSnapshot;
    }),
  );

describe('Bugfix 0006: Preservation — Post-Layout Update Behavior', () => {
  const MOCKED_CLIENT_HEIGHT = 500;

  it('computeBarWidth is idempotent: equal inputs always produce equal outputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 1, max: 100000 }),
        (cumVal, max) => {
          const result1 = computeBarWidth(cumVal, max);
          const result2 = computeBarWidth(cumVal, max);
          expect(result1).toBe(result2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('bar width style matches computeBarWidth output after post-layout update', () => {
    fc.assert(
      fc.property(arbPreservationSnapshot, (snapshot) => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const eventBus = new EventBus();
        const renderer = new ChartRaceRenderer(eventBus);
        renderer.mount(container);

        // Mock clientHeight to simulate post-layout state
        const barsContainer = container.querySelector('.chart-race__bars')!;
        Object.defineProperty(barsContainer, 'clientHeight', {
          value: MOCKED_CLIENT_HEIGHT,
          configurable: true,
        });

        renderer.update(snapshot, 10);

        const visibleEntries = filterByZoom(snapshot.entries, 10);
        const maxCumulative = visibleEntries.reduce(
          (max, e) => Math.max(max, e.cumulativeValue),
          0,
        );

        const bars = container.querySelectorAll('.chart-race__bar');
        expect(bars.length).toBe(visibleEntries.length);

        for (let i = 0; i < visibleEntries.length; i++) {
          const entry = visibleEntries[i];
          const expectedWidth = computeBarWidth(entry.cumulativeValue, maxCumulative);
          const barStyle = (bars[i] as HTMLElement).style.width;
          expect(barStyle).toBe(`${expectedWidth}%`);
        }

        renderer.destroy();
        container.remove();
      }),
      { numRuns: 50 },
    );
  });

  it('bar position matches rank after post-layout update (zoom 10)', () => {
    fc.assert(
      fc.property(arbPreservationSnapshot, (snapshot) => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const eventBus = new EventBus();
        const renderer = new ChartRaceRenderer(eventBus);
        renderer.mount(container);

        const barsContainer = container.querySelector('.chart-race__bars')!;
        Object.defineProperty(barsContainer, 'clientHeight', {
          value: MOCKED_CLIENT_HEIGHT,
          configurable: true,
        });

        renderer.update(snapshot, 10);

        const barHeight = MOCKED_CLIENT_HEIGHT / 10;
        const visibleEntries = filterByZoom(snapshot.entries, 10);
        const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');

        for (let i = 0; i < visibleEntries.length; i++) {
          const entry = visibleEntries[i];
          const wrapper = wrappers[i] as HTMLElement;
          const expectedY = (entry.rank - 1) * barHeight;
          expect(wrapper.style.transform).toBe(`translateY(${expectedY}px)`);
          expect(wrapper.style.height).toBe(`${barHeight}px`);
        }

        renderer.destroy();
        container.remove();
      }),
      { numRuns: 50 },
    );
  });

  it('zoom "all" uses fixed height 40px and overflowY auto', () => {
    fc.assert(
      fc.property(arbPreservationSnapshot, (snapshot) => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const eventBus = new EventBus();
        const renderer = new ChartRaceRenderer(eventBus);
        renderer.mount(container);

        const barsContainer = container.querySelector('.chart-race__bars')! as HTMLElement;
        Object.defineProperty(barsContainer, 'clientHeight', {
          value: MOCKED_CLIENT_HEIGHT,
          configurable: true,
        });

        renderer.update(snapshot, 'all');

        expect(barsContainer.style.overflowY).toBe('auto');

        const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
        for (const wrapper of wrappers) {
          expect((wrapper as HTMLElement).style.height).toBe('40px');
        }

        renderer.destroy();
        container.remove();
      }),
      { numRuns: 50 },
    );
  });
});


// ============================================================
// Feature: 0010-display-behavior-enhancements
// Property 2: Bar height independence from entry count at zoom 10
// **Validates: Requirements 3.1, 3.2, 3.4**
// ============================================================

describe('Property 2: Bar height independence from entry count at zoom 10', () => {
  it('all bar wrappers have height equal to containerHeight / 10 regardless of entry count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }).chain((size) =>
          fc.tuple(
            fc.constant(size),
            fc.integer({ min: 100, max: 1000 }),
          ),
        ),
        ([entryCount, containerHeight]) => {
          const container = document.createElement('div');
          document.body.appendChild(container);

          const eventBus = new EventBus();
          const renderer = new ChartRaceRenderer(eventBus);
          renderer.mount(container);

          // Mock clientHeight to the random positive value
          const barsContainer = container.querySelector('.chart-race__bars')!;
          Object.defineProperty(barsContainer, 'clientHeight', {
            value: containerHeight,
            configurable: true,
          });

          // Build a snapshot with the given number of entries
          const entries: RankedEntry[] = Array.from({ length: entryCount }, (_, i) => ({
            artistId: `artist-prop2-${i}`,
            artistName: `Artist ${i}`,
            artistType: 'boy_group' as const,
            generation: 4,
            logoUrl: `assets/logos/artist-${i}.svg`,
            cumulativeValue: 1000 - i * 50,
            previousCumulativeValue: 900 - i * 50,
            dailyValue: 100,
            rank: i + 1,
            previousRank: i + 1,
            featuredRelease: { title: 'Song', releaseId: 'song' },
          }));

          const snapshot: ChartSnapshot = { date: '2024-06-01', entries };

          renderer.update(snapshot, 10);

          const expectedHeight = containerHeight / 10;
          const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
          expect(wrappers.length).toBe(entryCount);

          for (const wrapper of wrappers) {
            const height = parseFloat((wrapper as HTMLElement).style.height);
            expect(height).toBeCloseTo(expectedHeight, 5);
          }

          renderer.destroy();
          container.remove();
        },
      ),
      { numRuns: 100 },
    );
  });
});
