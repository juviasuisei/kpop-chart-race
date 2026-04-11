// Feature: 0001-kpop-chart-race, Property 1: Serialization Round Trip
// **Validates: Requirements 1.10, 1.11**

import fc from 'fast-check';
import { serialize, deserialize, validateArtistEntry } from '../../src/data-loader.ts';
import type {
  ArtistEntry,
  ArtistType,
  ChartSource,
  EventType,
  DailyValueEntry,
  EmbedLink,
  EmbedDateEntry,
  ReleaseEntry,
} from '../../src/types.ts';

/** Valid ArtistType values */
const ARTIST_TYPES: ArtistType[] = [
  'boy_group',
  'girl_group',
  'solo_male',
  'solo_female',
  'mixed_group',
];

/** Known ChartSource values */
const CHART_SOURCES: ChartSource[] = [
  'inkigayo',
  'the_show',
  'show_champion',
  'music_bank',
];

/** Known EventType values */
const EVENT_TYPES: EventType[] = [
  'trailer',
  'mv',
  'live_performance',
  'release_date',
  'chart_performance',
  'promotion',
  'behind_the_scenes',
  'dance_practice',
  'variety_show',
  'fan_event',
];

// --- Arbitraries ---

const arbArtistType: fc.Arbitrary<ArtistType> = fc.constantFrom(...ARTIST_TYPES);

const arbChartSource: fc.Arbitrary<ChartSource> = fc.constantFrom(...CHART_SOURCES);

const arbEventType: fc.Arbitrary<EventType> = fc.constantFrom(...EVENT_TYPES);

/** YYYY-MM-DD date string */
const arbDateStr: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

const arbDailyValueEntry: fc.Arbitrary<DailyValueEntry> = fc.record({
  value: fc.integer({ min: 0, max: 10000 }),
  source: arbChartSource as fc.Arbitrary<ChartSource | string>,
  episode: fc.integer({ min: 1, max: 2000 }),
});

const arbEmbedLink: fc.Arbitrary<EmbedLink> = fc.record({
  url: fc.webUrl(),
  description: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

const arbEmbedDateEntry: fc.Arbitrary<EmbedDateEntry> = fc.record({
  eventType: arbEventType,
  links: fc.array(arbEmbedLink, { minLength: 1, maxLength: 3 }),
});

const arbDailyValuesRecord: fc.Arbitrary<Record<string, DailyValueEntry>> = fc
  .array(fc.tuple(arbDateStr, arbDailyValueEntry), { minLength: 1, maxLength: 5 })
  .map((pairs) => Object.fromEntries(pairs));

const arbEmbedsRecord: fc.Arbitrary<Record<string, EmbedDateEntry[]>> = fc
  .array(
    fc.tuple(arbDateStr, fc.array(arbEmbedDateEntry, { minLength: 1, maxLength: 2 })),
    { minLength: 0, maxLength: 3 },
  )
  .map((pairs) => Object.fromEntries(pairs));

const arbReleaseEntry: fc.Arbitrary<ReleaseEntry> = fc.record({
  title: fc.string({ minLength: 1, maxLength: 30 }),
  dailyValues: arbDailyValuesRecord,
  embeds: arbEmbedsRecord,
});

const arbArtistEntry: fc.Arbitrary<ArtistEntry> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 30 }),
  artistType: arbArtistType,
  generation: fc.integer({ min: 1, max: 10 }),
  releases: fc.array(arbReleaseEntry, { minLength: 1, maxLength: 3 }),
});

// --- Property Test ---

describe('Property 1: Serialization Round Trip', () => {
  it('deserialize(serialize(entry)) deep-equals entry for any valid ArtistEntry', () => {
    fc.assert(
      fc.property(arbArtistEntry, (entry: ArtistEntry) => {
        const roundTripped = deserialize(serialize(entry));
        expect(roundTripped).toEqual(entry);
      }),
    );
  });
});

// Feature: 0001-kpop-chart-race, Property 2: Validation Rejects Invalid Entries
// **Validates: Requirements 1.4, 1.7, 1.8**

/**
 * Helper: build a valid base ArtistEntry to selectively invalidate.
 */
const arbValidBase: fc.Arbitrary<ArtistEntry> = arbArtistEntry;

describe('Property 2: Validation Rejects Invalid Entries', () => {
  it('rejects entries with empty or missing name', () => {
    const arbEmptyName = arbValidBase.map((entry) => ({
      ...entry,
      name: '',
    }));

    fc.assert(
      fc.property(arbEmptyName, (entry: ArtistEntry) => {
        expect(validateArtistEntry(entry, 'test.json')).toBe(false);
      }),
    );
  });

  it('rejects entries with invalid artistType', () => {
    const arbBadType = fc
      .tuple(
        arbValidBase,
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (s) => !ARTIST_TYPES.includes(s as ArtistType),
        ),
      )
      .map(([entry, badType]) => ({
        ...entry,
        artistType: badType as ArtistType,
      }));

    fc.assert(
      fc.property(arbBadType, (entry: ArtistEntry) => {
        expect(validateArtistEntry(entry, 'test.json')).toBe(false);
      }),
    );
  });

  it('rejects entries with non-positive generation (0, negative, or non-integer)', () => {
    const arbBadGen = fc
      .tuple(
        arbValidBase,
        fc.oneof(
          fc.integer({ min: -100, max: 0 }),
          fc.double({ min: 0.1, max: 9.9, noNaN: true }).filter((n) => !Number.isInteger(n)),
        ),
      )
      .map(([entry, badGen]) => ({
        ...entry,
        generation: badGen,
      }));

    fc.assert(
      fc.property(arbBadGen, (entry: ArtistEntry) => {
        expect(validateArtistEntry(entry, 'test.json')).toBe(false);
      }),
    );
  });

  it('rejects entries with no releases or releases with no daily values', () => {
    const arbNoReleases = fc.oneof(
      // Case 1: empty releases array
      arbValidBase.map((entry) => ({
        ...entry,
        releases: [] as ReleaseEntry[],
      })),
      // Case 2: releases exist but all have empty dailyValues
      arbValidBase.map((entry) => ({
        ...entry,
        releases: entry.releases.map((r) => ({
          ...r,
          dailyValues: {} as Record<string, DailyValueEntry>,
        })),
      })),
    );

    fc.assert(
      fc.property(arbNoReleases, (entry: ArtistEntry) => {
        expect(validateArtistEntry(entry, 'test.json')).toBe(false);
      }),
    );
  });
});

// Feature: 0009-data-model-enhancements, Property 1: Optional field preservation round-trip
// **Validates: Requirements 1.2, 1.3, 3.2, 3.3**

import { toParseArtist } from '../../src/data-loader.ts';

/** Arbitrary for optional korean_name: either a non-empty string or undefined */
const arbOptionalKoreanName: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 30 }),
  fc.constant(undefined),
  fc.constant(''),
);

/** Arbitrary for optional debut: either a valid date string or undefined */
const arbOptionalDebut: fc.Arbitrary<string | undefined> = fc.oneof(
  arbDateStr,
  fc.constant(undefined),
  fc.constant(''),
);

/** Arbitrary for a valid filename slug */
const arbFilenameSlug: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,20}$/)
  .filter((s) => s.length > 0 && !s.endsWith('-'));

const arbFilename: fc.Arbitrary<string> = arbFilenameSlug.map((s) => `${s}.json`);

describe('Property 1: Optional field preservation round-trip', () => {
  it('preserves korean_name as koreanName when non-empty, sets undefined otherwise', () => {
    fc.assert(
      fc.property(
        arbArtistEntry,
        arbOptionalKoreanName,
        arbOptionalDebut,
        arbFilename,
        (entry, koreanName, debut, filename) => {
          const withOptionals: ArtistEntry = {
            ...entry,
            korean_name: koreanName,
            debut: debut,
          };
          const parsed = toParseArtist(withOptionals, filename);

          if (koreanName && koreanName.length > 0) {
            expect(parsed.koreanName).toBe(koreanName);
          } else {
            expect(parsed.koreanName).toBeUndefined();
          }

          if (debut && debut.length > 0) {
            expect(parsed.debut).toBe(debut);
          } else {
            expect(parsed.debut).toBeUndefined();
          }
        },
      ),
    );
  });
});

// Feature: 0009-data-model-enhancements, Property 2: Validation accepts optional fields
// **Validates: Requirements 1.4, 3.4**

describe('Property 2: Validation accepts optional fields', () => {
  it('validates entries regardless of korean_name and debut presence', () => {
    fc.assert(
      fc.property(
        arbArtistEntry,
        arbOptionalKoreanName,
        arbOptionalDebut,
        (entry, koreanName, debut) => {
          const withOptionals: ArtistEntry = {
            ...entry,
            korean_name: koreanName,
            debut: debut,
          };
          // Validation should pass for any valid base entry regardless of optional fields
          expect(validateArtistEntry(withOptionals, 'test.json')).toBe(true);
        },
      ),
    );
  });
});

// Feature: 0009-data-model-enhancements, Property 3: Logo URL derived from filename
// **Validates: Requirements 5.2, 5.3, 7.1, 7.2**

describe('Property 3: Logo URL derived from filename', () => {
  it('derives logoUrl as assets/logos/{slug}.png from filename', () => {
    fc.assert(
      fc.property(arbArtistEntry, arbFilename, (entry, filename) => {
        const parsed = toParseArtist(entry, filename);
        const expectedSlug = filename.replace(/\.json$/i, '');
        expect(parsed.logoUrl).toBe(`assets/logos/${expectedSlug}.png`);
      }),
    );
  });

  it('logoUrl does not depend on any ArtistEntry field', () => {
    fc.assert(
      fc.property(
        arbArtistEntry,
        arbArtistEntry,
        arbFilename,
        (entry1, entry2, filename) => {
          const parsed1 = toParseArtist(entry1, filename);
          const parsed2 = toParseArtist(entry2, filename);
          expect(parsed1.logoUrl).toBe(parsed2.logoUrl);
        },
      ),
    );
  });
});
