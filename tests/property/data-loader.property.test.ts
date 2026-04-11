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
  logo: fc.string({ minLength: 1, maxLength: 50 }),
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
