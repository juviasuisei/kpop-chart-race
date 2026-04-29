// Feature: 0013-detail-panel-overhaul — Property-based tests
// Tests for detail panel overhaul: single-column layout, date grouping,
// reverse chronological order, chart perf before embeds, larger logos,
// pts suffix, crown above points, crown height tiers, header color, cumulative value.

import fc from 'fast-check';
import { DetailPanel, getCrownHeight } from '../../src/detail-panel.ts';
import { EventBus } from '../../src/event-bus.ts';
import { ARTIST_TYPE_COLORS } from '../../src/colors.ts';
import { computeCumulativeValue } from '../../src/chart-engine.ts';
import type { DataStore, ParsedArtist, ParsedRelease } from '../../src/models.ts';
import type { ArtistType, ChartSource } from '../../src/types.ts';

// Polyfill IntersectionObserver for jsdom
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
  constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
}
globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

const ARTIST_TYPES: ArtistType[] = ['boy_group', 'girl_group', 'solo_male', 'solo_female', 'mixed_group'];
const SOURCES: ChartSource[] = ['inkigayo', 'music_bank', 'show_champion', 'm_countdown', 'the_show', 'show_music_core'];

/** Arbitrary for a date string in YYYY-MM-DD format */
const arbDate = fc.integer({ min: 0, max: 2000 }).map((offset) => {
  const base = new Date('2020-01-01');
  base.setDate(base.getDate() + offset);
  return base.toISOString().slice(0, 10);
});

/** Arbitrary for artist type */
const arbArtistType = fc.constantFrom(...ARTIST_TYPES);

/** Arbitrary for chart source */
const arbSource = fc.constantFrom(...SOURCES);

/** Arbitrary for a release with 1-5 daily values and optional embeds */
function arbRelease(dates: string[]): fc.Arbitrary<ParsedRelease> {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
    title: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  }).chain(({ id, title }) => {
    // Pick a subset of dates for daily values
    const arbDailyValues = fc.subarray(dates, { minLength: 1 }).chain((selectedDates) =>
      fc.tuple(
        ...selectedDates.map((date) =>
          fc.tuple(
            fc.constant(date),
            fc.record({
              value: fc.integer({ min: 1, max: 10000 }),
              source: arbSource,
              episode: fc.integer({ min: 1, max: 2000 }),
            }),
          ),
        ),
      ).map((entries) => new Map(entries)),
    );

    // Optionally add embeds on some dates
    const arbEmbeds = fc.subarray(dates, { minLength: 0, maxLength: 2 }).map((selectedDates) => {
      const embedMap = new Map<string, Array<{ type: string; url: string }>>();
      for (const date of selectedDates) {
        embedMap.set(date, [
          { type: 'mv', url: `https://youtube.com/watch?v=${date}` },
        ]);
      }
      return embedMap;
    });

    return fc.tuple(arbDailyValues, arbEmbeds).map(([dailyValues, embeds]) => ({
      id,
      title,
      dailyValues,
      embeds,
    }));
  });
}

/** Build a DataStore from an artist */
function buildDataStore(artist: ParsedArtist, dates: string[]): DataStore {
  return {
    artists: new Map([[artist.id, artist]]),
    dates: [...dates].sort(),
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    chartWins: new Map(),
  };
}

/** Build a DataStore with chart wins for testing crown display */
function buildDataStoreWithWins(artist: ParsedArtist, dates: string[]): DataStore {
  const sortedDates = [...dates].sort();
  const chartWins: DataStore['chartWins'] = new Map();

  // Create wins for each daily value entry
  for (const release of artist.releases) {
    for (const [date, dv] of release.dailyValues) {
      if (!chartWins.has(date)) {
        chartWins.set(date, new Map());
      }
      const dateMap = chartWins.get(date)!;
      if (!dateMap.has(dv.source)) {
        dateMap.set(dv.source, {
          artistIds: [artist.id],
          crownLevels: new Map([[artist.id, 1]]),
        });
      }
    }
  }

  return {
    artists: new Map([[artist.id, artist]]),
    dates: sortedDates,
    startDate: sortedDates[0],
    endDate: sortedDates[sortedDates.length - 1],
    chartWins,
  };
}

/** Arbitrary for a set of 2-5 unique sorted dates */
const arbDates = fc.uniqueArray(arbDate, { minLength: 2, maxLength: 5 }).map((dates) => dates.sort());

/** Arbitrary for a full artist with releases */
function arbArtist(dates: string[]): fc.Arbitrary<ParsedArtist> {
  return fc.tuple(
    arbArtistType,
    fc.integer({ min: 1, max: 5 }),
    fc.array(arbRelease(dates), { minLength: 1, maxLength: 3 }),
  ).map(([artistType, generation, releases]) => ({
    id: 'test-artist',
    name: 'Test Artist',
    artistType,
    generation,
    logoUrl: 'assets/logos/test.svg',
    releases,
  }));
}

// ============================================================
// Property 1: Single-column layout (no left/right alternation)
// **Validates: Requirements 2.1, 2.2**
// ============================================================

describe('Feature: 0013-detail-panel-overhaul, Property 1: Single-column layout', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  it('no timeline entry has left/right classes for any generated artist data', () => {
    fc.assert(
      fc.property(arbDates, (dates) =>
        fc.assert(
          fc.property(arbArtist(dates), (artist) => {
            const eventBus = new EventBus();
            const panel = new DetailPanel(eventBus);
            const store = buildDataStore(artist, dates);

            panel.open('test-artist', store);
            const entries = document.body.querySelectorAll('.timeline-entry');

            entries.forEach((entry) => {
              expect(entry.classList.contains('timeline-entry--left')).toBe(false);
              expect(entry.classList.contains('timeline-entry--right')).toBe(false);
            });

            panel.destroy();
          }),
          { numRuns: 10 },
        ),
      ),
      { numRuns: 10 },
    );
  });
});

// ============================================================
// Property 2: One date header per unique date
// **Validates: Requirements 3.1, 3.2, 3.3**
// ============================================================

describe('Feature: 0013-detail-panel-overhaul, Property 2: One date header per unique date', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  it('date header count equals unique date count and entries are children of date groups', () => {
    fc.assert(
      fc.property(arbDates, (dates) =>
        fc.assert(
          fc.property(arbArtist(dates), (artist) => {
            const eventBus = new EventBus();
            const panel = new DetailPanel(eventBus);
            const store = buildDataStore(artist, dates);

            panel.open('test-artist', store);

            // Collect all unique dates from the artist's data
            const uniqueDates = new Set<string>();
            for (const release of artist.releases) {
              for (const date of release.dailyValues.keys()) uniqueDates.add(date);
              for (const date of release.embeds.keys()) uniqueDates.add(date);
            }

            // Date headers are now inside cards (.timeline-entry__date), one per date group
            const dateEls = document.body.querySelectorAll('.timeline-entry__date');
            expect(dateEls.length).toBe(uniqueDates.size);

            const dateGroups = document.body.querySelectorAll('.timeline-date-group');
            expect(dateGroups.length).toBe(uniqueDates.size);

            panel.destroy();
          }),
          { numRuns: 10 },
        ),
      ),
      { numRuns: 10 },
    );
  });
});

// ============================================================
// Property 3: Reverse chronological date ordering
// **Validates: Requirements 4.1**
// ============================================================

describe('Feature: 0013-detail-panel-overhaul, Property 3: Reverse chronological date ordering', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  it('date headers appear in strictly descending order', () => {
    fc.assert(
      fc.property(arbDates, (dates) =>
        fc.assert(
          fc.property(arbArtist(dates), (artist) => {
            const eventBus = new EventBus();
            const panel = new DetailPanel(eventBus);
            const store = buildDataStore(artist, dates);

            panel.open('test-artist', store);

            const dateEls = document.body.querySelectorAll('.timeline-entry__date');
            const headerDates = Array.from(dateEls).map((el) => el.textContent!);

            for (let i = 1; i < headerDates.length; i++) {
              expect(headerDates[i - 1].localeCompare(headerDates[i])).toBeGreaterThan(0);
            }

            panel.destroy();
          }),
          { numRuns: 10 },
        ),
      ),
      { numRuns: 10 },
    );
  });
});

// ============================================================
// Property 4: Chart performances before embeds within each date group
// **Validates: Requirements 4.2**
// ============================================================

describe('Feature: 0013-detail-panel-overhaul, Property 4: Chart performances before embeds', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  it('chart performance entries precede embed-only entries within each date group', () => {
    fc.assert(
      fc.property(arbDates, (dates) =>
        fc.assert(
          fc.property(arbArtist(dates), (artist) => {
            const eventBus = new EventBus();
            const panel = new DetailPanel(eventBus);
            const store = buildDataStore(artist, dates);

            panel.open('test-artist', store);

            const dateGroups = document.body.querySelectorAll('.timeline-date-group');
            dateGroups.forEach((group) => {
              const entries = group.querySelectorAll('.timeline-entry');
              let seenEmbedOnly = false;
              entries.forEach((entry) => {
                const hasChartPerf = entry.querySelector('.timeline-entry__source') !== null;
                if (!hasChartPerf) {
                  seenEmbedOnly = true;
                }
                if (seenEmbedOnly && hasChartPerf) {
                  // Chart perf after embed-only — violation
                  expect(true).toBe(false);
                }
              });
            });

            panel.destroy();
          }),
          { numRuns: 10 },
        ),
      ),
      { numRuns: 10 },
    );
  });
});

// ============================================================
// Property 5: Source logos rendered at 80×80px
// **Validates: Requirements 5.1**
// ============================================================

describe('Feature: 0013-detail-panel-overhaul, Property 5: Source logos at 80px', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  it('all source logo images have width=80', () => {
    fc.assert(
      fc.property(arbDates, (dates) =>
        fc.assert(
          fc.property(arbArtist(dates), (artist) => {
            const eventBus = new EventBus();
            const panel = new DetailPanel(eventBus);
            const store = buildDataStore(artist, dates);

            panel.open('test-artist', store);

            const logos = document.body.querySelectorAll('.timeline-entry__source-logo') as NodeListOf<HTMLImageElement>;
            logos.forEach((logo) => {
              expect(logo.width).toBe(80);
            });

            panel.destroy();
          }),
          { numRuns: 10 },
        ),
      ),
      { numRuns: 10 },
    );
  });
});

// ============================================================
// Property 6: Points display includes "pts" suffix
// **Validates: Requirements 6.1**
// ============================================================

describe('Feature: 0013-detail-panel-overhaul, Property 6: Points display with pts suffix', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  it('all value elements end with "pts"', () => {
    fc.assert(
      fc.property(arbDates, (dates) =>
        fc.assert(
          fc.property(arbArtist(dates), (artist) => {
            const eventBus = new EventBus();
            const panel = new DetailPanel(eventBus);
            const store = buildDataStore(artist, dates);

            panel.open('test-artist', store);

            const valueEls = document.body.querySelectorAll('.timeline-entry__value');
            valueEls.forEach((el) => {
              expect(el.textContent!.endsWith('pts')).toBe(true);
            });

            panel.destroy();
          }),
          { numRuns: 10 },
        ),
      ),
      { numRuns: 10 },
    );
  });
});

// ============================================================
// Property 7: Crown icon appears above points value
// **Validates: Requirements 6.2**
// ============================================================

describe('Feature: 0013-detail-panel-overhaul, Property 7: Crown above points', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  it('crown element precedes value element in DOM order', () => {
    fc.assert(
      fc.property(arbDates, (dates) =>
        fc.assert(
          fc.property(arbArtist(dates), (artist) => {
            const eventBus = new EventBus();
            const panel = new DetailPanel(eventBus);
            const store = buildDataStoreWithWins(artist, dates);

            panel.open('test-artist', store);

            const entries = document.body.querySelectorAll('.timeline-entry');
            entries.forEach((entry) => {
              const crown = entry.querySelector('.timeline-entry__crown');
              const value = entry.querySelector('.timeline-entry__value');
              if (crown && value) {
                // Crown should come before value in DOM
                const position = crown.compareDocumentPosition(value);
                expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
              }
            });

            panel.destroy();
          }),
          { numRuns: 10 },
        ),
      ),
      { numRuns: 10 },
    );
  });
});

// ============================================================
// Property 8: Crown height tiers
// **Validates: Requirements 7.1, 7.2, 7.3**
// ============================================================

describe('Feature: 0013-detail-panel-overhaul, Property 8: Crown height tiers', () => {
  it('getCrownHeight returns correct tier height for any positive level', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (level) => {
        const height = getCrownHeight(level);
        if (level >= 1 && level <= 6) {
          expect(height).toBe(24);
        } else if (level >= 7 && level <= 9) {
          expect(height).toBe(48);
        } else {
          expect(height).toBe(72);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 9: Header background color matches artist type
// **Validates: Requirements 8.3, 10.2**
// ============================================================

/** Convert hex color (#RRGGBB) to rgb() string as returned by jsdom */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

describe('Feature: 0013-detail-panel-overhaul, Property 9: Header background color matches artist type', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  it('logo background color matches ARTIST_TYPE_COLORS for the artist type', () => {
    fc.assert(
      fc.property(arbArtistType, (artistType) => {
        const eventBus = new EventBus();
        const panel = new DetailPanel(eventBus);
        const release: ParsedRelease = {
          id: 'r1',
          title: 'Song',
          dailyValues: new Map([['2024-05-13', { value: 100, source: 'inkigayo', episode: 1 }]]),
          embeds: new Map(),
        };
        const artist: ParsedArtist = {
          id: 'test-artist',
          name: 'Test',
          artistType,
          generation: 1,
          logoUrl: 'assets/logos/test.svg',
          releases: [release],
        };
        const store = buildDataStore(artist, ['2024-05-13']);

        panel.open('test-artist', store);

        const logoBg = document.body.querySelector('.detail-panel__logo-bg') as HTMLElement;
        expect(logoBg).not.toBeNull();

        const expectedColor = ARTIST_TYPE_COLORS[artistType];
        const bgColor = logoBg.style.backgroundColor;
        // jsdom may return hex or rgb — normalize both to rgb for comparison
        const expectedRgb = hexToRgb(expectedColor);
        expect(bgColor === expectedColor || bgColor === expectedRgb).toBe(true);

        panel.destroy();
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 10: Cumulative value display matches computation
// **Validates: Requirements 8.8, 9.2, 9.3**
// ============================================================

describe('Feature: 0013-detail-panel-overhaul, Property 10: Cumulative value matches computation', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  it('displayed cumulative value equals computeCumulativeValue output', () => {
    fc.assert(
      fc.property(arbDates, (dates) =>
        fc.assert(
          fc.property(arbArtist(dates), (artist) => {
            const eventBus = new EventBus();
            const panel = new DetailPanel(eventBus);
            const sortedDates = [...dates].sort();
            const store = buildDataStore(artist, sortedDates);
            const currentDate = sortedDates[sortedDates.length - 1];

            panel.open('test-artist', store, currentDate);

            const cumulEl = document.body.querySelector('.detail-panel__stats');
            expect(cumulEl).not.toBeNull();

            const expected = computeCumulativeValue(artist, currentDate, sortedDates);
            expect(cumulEl!.textContent).toContain(`${expected.toLocaleString()} pts`);

            panel.destroy();
          }),
          { numRuns: 10 },
        ),
      ),
      { numRuns: 10 },
    );
  });
});

// ============================================================
// Existing Property 4: Conditional Korean name display (updated for new open() signature)
// **Validates: Requirements 2.1, 2.2**
// ============================================================

/** Arbitrary for non-empty printable strings (safe for HTML text content checks) */
const arbNonEmptyName = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

/** Arbitrary for Korean name strings */
const arbKoreanName = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

function buildSimpleArtist(overrides: Partial<ParsedArtist> = {}): ParsedArtist {
  const release: ParsedRelease = {
    id: 'test-release',
    title: 'Test Song',
    dailyValues: new Map([['2024-05-13', { value: 100, source: 'inkigayo', episode: 1 }]]),
    embeds: new Map(),
  };
  return {
    id: 'test-artist',
    name: 'Test Artist',
    artistType: 'girl_group',
    generation: 4,
    logoUrl: 'assets/logos/test.svg',
    releases: [release],
    ...overrides,
  };
}

function buildSimpleDataStore(artist: ParsedArtist): DataStore {
  return {
    artists: new Map([[artist.id, artist]]),
    dates: ['2024-05-13'],
    startDate: '2024-05-13',
    endDate: '2024-05-13',
    chartWins: new Map(),
  };
}

describe('Property 4: Conditional Korean name display', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  it('shows Korean name in parentheses when koreanName is defined', () => {
    fc.assert(
      fc.property(arbNonEmptyName, arbKoreanName, (name, koreanName) => {
        const eventBus = new EventBus();
        const panel = new DetailPanel(eventBus);
        const artist = buildSimpleArtist({ name, koreanName });
        const store = buildSimpleDataStore(artist);

        panel.open('test-artist', store);
        const nameEl = document.body.querySelector('.detail-panel__artist-name');
        expect(nameEl).not.toBeNull();
        expect(nameEl!.textContent).toContain('(');
        expect(nameEl!.textContent).toContain(')');
        panel.destroy();
      }),
      { numRuns: 100 },
    );
  });

  it('does not show parentheses when koreanName is undefined', () => {
    const arbNameNoParens = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0 && !s.includes('(') && !s.includes(')'));
    fc.assert(
      fc.property(arbNameNoParens, (name) => {
        const eventBus = new EventBus();
        const panel = new DetailPanel(eventBus);
        const artist = buildSimpleArtist({ name, koreanName: undefined });
        const store = buildSimpleDataStore(artist);

        panel.open('test-artist', store);
        const nameEl = document.body.querySelector('.detail-panel__artist-name');
        expect(nameEl).not.toBeNull();
        expect(nameEl!.textContent).not.toContain('(');
        panel.destroy();
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Existing Property 5: HTML escaping of user-provided strings (updated for new open() signature)
// **Validates: Requirements 2.3**
// ============================================================

describe('Property 5: HTML escaping of user-provided strings', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  const arbHtmlDangerous = fc
    .stringMatching(/^[a-zA-Z<>&"']{1,20}$/)
    .filter((s) => /[<>&"']/.test(s) && s.length > 0);

  it('escapes HTML special characters in name and koreanName', () => {
    fc.assert(
      fc.property(arbHtmlDangerous, arbHtmlDangerous, (name, koreanName) => {
        const eventBus = new EventBus();
        const panel = new DetailPanel(eventBus);
        const artist = buildSimpleArtist({ name, koreanName });
        const store = buildSimpleDataStore(artist);

        panel.open('test-artist', store);
        const nameEl = document.body.querySelector('.detail-panel__artist-name');
        expect(nameEl).not.toBeNull();

        const html = nameEl!.innerHTML;
        expect(nameEl!.textContent).toContain(name);
        expect(nameEl!.textContent).toContain(koreanName);

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const h2Children = nameEl!.children;
        for (let i = 0; i < h2Children.length; i++) {
          const tag = h2Children[i].tagName.toLowerCase();
          expect(['script', 'img', 'iframe', 'object', 'embed']).not.toContain(tag);
        }

        panel.destroy();
      }),
      { numRuns: 100 },
    );
  });
});
