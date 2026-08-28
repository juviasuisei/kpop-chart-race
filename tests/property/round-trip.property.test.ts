// Feature: airtable-data-layer, Property 11: Round-trip equivalence with JSON loader
// **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5**
//
// For any valid set of artist data representable both as a JSON ArtistEntry
// file and as equivalent Airtable records (Artists + Releases + Rankings +
// Episodes), the Data_Adapter SHALL produce a ParsedArtist whose id, name,
// koreanName, artistType, generation, debut, logoUrl are value-equal to those
// produced by toParseArtist(), and whose dailyValues and embeds Maps contain
// entries with identical keys and values (embeds compared as sets per date key,
// ignoring intra-date ordering).

import fc from 'fast-check';
import { test } from '@fast-check/vitest';
import type { ArtistEntry, ArtistType, ChartSource, DailyValueEntry, ReleaseEntry } from '../../src/types.ts';
import { toParseArtist } from '../../src/data-loader.ts';

// --- Type mappings (reverse tables from task strategy) ---

const ARTIST_TYPE_PAIRS: Array<[ArtistType, string]> = [
  ['boy_group', 'Boy Group'],
  ['girl_group', 'Girl Group'],
  ['solo_male', 'Solo Male'],
  ['solo_female', 'Solo Female'],
  ['mixed_group', 'Mixed Group'],
  ['solo_non_binary', 'Solo Non-Binary'],
];

const SOURCE_PAIRS: Array<[ChartSource, string]> = [
  ['inkigayo', 'Inkigayo'],
  ['the_show', 'The Show'],
  ['show_champion', 'Show Champion'],
  ['music_bank', 'Music Bank'],
  ['m_countdown', 'M Countdown'],
  ['show_music_core', 'Show! Music Core'],
];

// --- Arbitraries ---

/** Generate a logo_name that is a valid slug (lowercase alpha + underscore, no leading/trailing separators) */
const logoNameArb = fc.string({ minLength: 2, maxLength: 15, unit: fc.constantFrom(
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  '_',
) }).filter(s => !s.startsWith('_') && !s.endsWith('_') && s.length >= 2);

/** Generate a valid artist name that slugifies to a predictable value */
const artistNameArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0);

/** Generate artist type (JSON value + Airtable value) */
const artistTypePairArb = fc.constantFrom(...ARTIST_TYPE_PAIRS);

/** Generate generation number 1-5 */
const generationArb = fc.integer({ min: 1, max: 5 });

/** Generate optional korean name */
const koreanNameArb = fc.oneof(
  fc.constant(undefined as string | undefined),
  fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
);

/** Generate optional debut date in ISO format */
const debutArb = fc.oneof(
  fc.constant(undefined as string | undefined),
  fc.tuple(
    fc.integer({ min: 2015, max: 2024 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  ).map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
);

/** Generate a source pair (JSON chartSource + Airtable show name) */
const sourcePairArb = fc.constantFrom(...SOURCE_PAIRS);

/** Generate a date string in YYYY-MM-DD format */
const dateArb = fc.tuple(
  fc.integer({ min: 2020, max: 2025 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 }),
).map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

/** Generate a daily value entry: { date, value, source, episode } */
interface GeneratedDailyValue {
  date: string;
  value: number;
  sourcePair: [ChartSource, string]; // [json source, airtable show]
  episode: number;
}

const dailyValueArb: fc.Arbitrary<GeneratedDailyValue> = fc.record({
  date: dateArb,
  value: fc.integer({ min: 1, max: 50000 }),
  sourcePair: sourcePairArb,
  episode: fc.integer({ min: 1, max: 999 }),
});

/** Generate a release with unique daily values (unique dates) */
interface GeneratedRelease {
  title: string;
  releaseDate: string;
  appleMusicUrl: string | undefined;
  mvUrl: string | undefined;
  dailyValues: GeneratedDailyValue[];
}

const releaseArb: fc.Arbitrary<GeneratedRelease> = fc.record({
  title: fc.string({ minLength: 1, maxLength: 25 }).filter(s => s.trim().length > 0),
  releaseDate: dateArb,
  appleMusicUrl: fc.oneof(
    fc.constant(undefined as string | undefined),
    fc.webUrl(),
  ),
  mvUrl: fc.oneof(
    fc.constant(undefined as string | undefined),
    fc.webUrl(),
  ),
  dailyValues: fc.array(dailyValueArb, { minLength: 1, maxLength: 3 }),
}).map(release => {
  // Deduplicate dailyValues by date (keep first occurrence)
  const seen = new Set<string>();
  const uniqueDvs: GeneratedDailyValue[] = [];
  for (const dv of release.dailyValues) {
    if (!seen.has(dv.date)) {
      seen.add(dv.date);
      uniqueDvs.push(dv);
    }
  }
  return { ...release, dailyValues: uniqueDvs.length > 0 ? uniqueDvs : [release.dailyValues[0]] };
});

/** Generate the full test data */
interface GeneratedArtistData {
  logoName: string;
  name: string;
  typePair: [ArtistType, string];
  generation: number;
  koreanName: string | undefined;
  debut: string | undefined;
  releases: GeneratedRelease[];
}

const artistDataArb: fc.Arbitrary<GeneratedArtistData> = fc.record({
  logoName: logoNameArb,
  name: artistNameArb,
  typePair: artistTypePairArb,
  generation: generationArb,
  koreanName: koreanNameArb,
  debut: debutArb,
  releases: fc.array(releaseArb, { minLength: 1, maxLength: 3 }),
});

// --- Helpers ---

/**
 * Build the JSON ArtistEntry from the generated data.
 * The JSON loader uses toParseArtist(entry, filename) where filename = `${logoName}.json`.
 */
function buildJsonEntry(data: GeneratedArtistData): ArtistEntry {
  const releases: ReleaseEntry[] = data.releases.map(release => {
    const dailyValues: Record<string, DailyValueEntry> = {};
    for (const dv of release.dailyValues) {
      dailyValues[dv.date] = {
        value: dv.value,
        source: dv.sourcePair[0],
        episode: dv.episode,
      };
    }

    // Build embeds matching what Airtable produces:
    // - mv embed if release has Date + MV URL
    // - live_performance embeds are from Rankings with Performance URLs (not generated here for JSON side)
    // NOTE: Apple Music URLs now go into albumReleases, NOT embeds
    const embeds: Record<string, Array<{ type: string; url: string }>> = {};
    if (release.mvUrl) {
      const entries: Array<{ type: string; url: string }> = [];
      if (release.mvUrl) {
        entries.push({ type: 'mv', url: release.mvUrl });
      }
      embeds[release.releaseDate] = entries;
    }

    return {
      title: release.title,
      dailyValues,
      embeds,
    };
  });

  return {
    name: data.name,
    artistType: data.typePair[0],
    generation: data.generation,
    korean_name: data.koreanName,
    debut: data.debut,
    releases,
  };
}

/**
 * Build Airtable mock fetch responses from the generated data.
 * Creates Artist, Releases, Episodes, and Rankings records that are equivalent.
 *
 * Key mappings for equivalence:
 * - JSON uses slugify(entry.name) for artist id; Airtable uses logo_name directly.
 *   For equivalence, we set logo_name = slugify(name) so both produce the same id.
 *   Actually wait — looking at the code:
 *     - JSON: toParseArtist sets id = slugify(entry.name) and logoUrl = assets/logos/${filename_slug}.svg
 *     - Airtable: sets id = logo_name and logoUrl = assets/logos/${logo_name}.svg
 *   So for id to match: logo_name must equal slugify(entry.name)
 *   For logoUrl to match: logo_name must equal the filename slug (filename.replace(/\.json$/, ''))
 *   In the JSON loader: slug = filename.replace(/\.json$/i, '')
 *   So if filename = `${logo_name}.json`, then slug = logo_name
 *   And we need logo_name = slugify(name) for id equality.
 *   BUT this constrains name such that slugify(name) = logo_name.
 *   Instead, let's just set logo_name = slugify(data.name) so id matches,
 *   and use filename = `${slugify(data.name)}.json` so logoUrl matches.
 */
function buildAirtableMockFetch(data: GeneratedArtistData) {
  // For round-trip equivalence, we need:
  // - Airtable logo_name = slugify(data.name) so id matches
  // - filename for JSON = `${slugify(data.name)}.json` so logoUrl matches
  const slugifiedName = slugify(data.name);

  const artistRecordId = 'recArtistRT001';
  const releaseRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const episodeRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const rankingRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];

  let releaseIdx = 0;
  let episodeIdx = 0;
  let rankingIdx = 0;
  const releaseIds: string[] = [];

  for (const release of data.releases) {
    const releaseRecordId = `recReleaseRT${String(releaseIdx).padStart(3, '0')}`;
    releaseIdx++;
    releaseIds.push(releaseRecordId);

    const rankingIds: string[] = [];

    for (const dv of release.dailyValues) {
      const episodeRecordId = `recEpisodeRT${String(episodeIdx).padStart(4, '0')}`;
      const rankingRecordId = `recRankingRT${String(rankingIdx).padStart(4, '0')}`;
      episodeIdx++;
      rankingIdx++;

      episodeRecords.push({
        id: episodeRecordId,
        fields: {
          'Date': dv.date,
          'Show': dv.sourcePair[1], // Airtable show display name
          'Episode': dv.episode,
        },
      });

      rankingRecords.push({
        id: rankingRecordId,
        fields: {
          'Score': dv.value,
          'Release': [releaseRecordId],
          'Episode': [episodeRecordId],
          // No Performance URL for round-trip (JSON embeds only have release_date and mv from Release fields)
        },
      });

      rankingIds.push(rankingRecordId);
    }

    releaseRecords.push({
      id: releaseRecordId,
      fields: {
        'Name': release.title,
        'Artist': [artistRecordId],
        'Date': release.releaseDate,
        ...(release.appleMusicUrl ? { 'Apple Music': release.appleMusicUrl } : {}),
        ...(release.mvUrl ? { 'MV': release.mvUrl } : {}),
        'Rankings': rankingIds,
      },
    });
  }

  const artistRecord = {
    id: artistRecordId,
    fields: {
      'Full Name': data.name,
      'Native Name': data.koreanName ?? '',
      'Type': data.typePair[1], // Airtable type display name
      'Gen': String(data.generation),
      'Debut': data.debut ?? '',
      'logo_name': slugifiedName,
      'Releases': releaseIds,
    },
  };

  const tableResponses = [
    { records: [artistRecord] },
    { records: releaseRecords },
    { records: episodeRecords },
    { records: rankingRecords },
  ];

  let callIndex = 0;
  return vi.fn(async () => {
    const response = tableResponses[callIndex] ?? { records: [] };
    callIndex++;
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

/**
 * Slugify a string: lowercase, replace non-alphanumeric runs with hyphens,
 * trim leading/trailing hyphens. (Matches both loaders' slugify logic)
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// --- Test ---

describe('Property 11: Round-trip equivalence with JSON loader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test.prop([artistDataArb], { numRuns: 100 })(
    'Data_Adapter produces ParsedArtist equivalent to toParseArtist for the same data',
    async (data) => {
      // Compute the slugified name that both loaders will use as the artist id
      const slugifiedName = slugify(data.name);

      // Skip if slugified name is empty (can't produce a valid artist id)
      if (slugifiedName === '') return;

      // --- JSON side: build ArtistEntry and call toParseArtist ---
      const jsonEntry = buildJsonEntry(data);
      // filename for JSON = `${slugifiedName}.json` so logoUrl = `assets/logos/${slugifiedName}.svg`
      const jsonParsed = toParseArtist(jsonEntry, `${slugifiedName}.json`);

      // --- Airtable side: mock fetch and call loadFromAirtable ---
      const mockFetch = buildAirtableMockFetch(data);
      vi.stubGlobal('fetch', mockFetch);
      vi.stubEnv('VITE_AIRTABLE_API_TOKEN', 'test_token_roundtrip');

      // Mock sessionStorage
      const mockStorage: Storage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
        length: 0,
        key: () => null,
      };
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: mockStorage,
        writable: true,
        configurable: true,
      });

      const { loadFromAirtable } = await import('../../src/airtable/data-adapter.ts');
      const dataStore = await loadFromAirtable();

      const airtableParsed = dataStore.artists.get(slugifiedName);
      expect(airtableParsed).toBeDefined();
      if (!airtableParsed) return;

      // --- Compare scalar fields ---
      // id
      expect(airtableParsed.id).toBe(jsonParsed.id);
      // name
      expect(airtableParsed.name).toBe(jsonParsed.name);
      // koreanName
      expect(airtableParsed.koreanName).toBe(jsonParsed.koreanName);
      // artistType
      expect(airtableParsed.artistType).toBe(jsonParsed.artistType);
      // generation
      expect(airtableParsed.generation).toBe(jsonParsed.generation);
      // debut
      expect(airtableParsed.debut).toBe(jsonParsed.debut);
      // logoUrl
      expect(airtableParsed.logoUrl).toBe(jsonParsed.logoUrl);

      // --- Compare releases ---
      expect(airtableParsed.releases.length).toBe(jsonParsed.releases.length);

      for (let i = 0; i < jsonParsed.releases.length; i++) {
        const jsonRelease = jsonParsed.releases[i];
        // Match by index — both loaders process releases in the same order
        const atRelease = airtableParsed.releases[i];
        expect(atRelease).toBeDefined();
        if (!atRelease) continue;

        // Titles should match
        expect(atRelease.title).toBe(jsonRelease.title);

        // --- Compare dailyValues ---
        expect(atRelease.dailyValues.size).toBe(jsonRelease.dailyValues.size);
        for (const [date, jsonDv] of jsonRelease.dailyValues) {
          const atDv = atRelease.dailyValues.get(date);
          expect(atDv).toBeDefined();
          if (!atDv) continue;
          expect(atDv.value).toBe(jsonDv.value);
          expect(atDv.source).toBe(jsonDv.source);
          expect(atDv.episode).toBe(jsonDv.episode);
        }

        // --- Compare embeds (as sets per date key, ignoring ordering) ---
        expect(atRelease.embeds.size).toBe(jsonRelease.embeds.size);
        for (const [date, jsonEmbeds] of jsonRelease.embeds) {
          const atEmbeds = atRelease.embeds.get(date);
          expect(atEmbeds).toBeDefined();
          if (!atEmbeds) continue;

          // Compare as sets (same entries, ignoring order within a date)
          const jsonSet = new Set(jsonEmbeds.map(e => `${e.type}::${e.url}`));
          const atSet = new Set(atEmbeds.map(e => `${e.type}::${e.url}`));
          expect(atSet).toEqual(jsonSet);
        }
      }

      // --- Compare albumReleases ---
      // Both sides should produce the same albumReleases entries
      const jsonAlbumReleases = data.releases
        .filter(r => r.appleMusicUrl)
        .map(r => ({ date: r.releaseDate, appleMusicUrl: r.appleMusicUrl! }));
      
      expect(airtableParsed.albumReleases.length).toBe(jsonAlbumReleases.length);
      
      // Compare as sets (order may differ)
      const atAlbumSet = new Set(
        airtableParsed.albumReleases.map(ar => `${ar.date}::${ar.appleMusicUrl}`),
      );
      const jsonAlbumSet = new Set(
        jsonAlbumReleases.map(ar => `${ar.date}::${ar.appleMusicUrl}`),
      );
      expect(atAlbumSet).toEqual(jsonAlbumSet);
    },
  );
});
