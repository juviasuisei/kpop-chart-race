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
  it('bar width is proportional: (cumulativeValue / maxCumulativeValue) * 100', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 1, max: 100000 }),
        (cumulative, max) => {
          const result = computeBarWidth(cumulative, max);
          const expected = (cumulative / max) * 100;
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
