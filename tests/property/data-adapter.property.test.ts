// Feature: airtable-data-layer, Property 4: Artist record field mapping
// Feature: airtable-data-layer, Property 5: Multi-artist release duplication
// Feature: airtable-data-layer, Property 6: Ranking-to-DailyValue mapping
// Feature: airtable-data-layer, Property 7: Embed generation and type ordering
// Feature: airtable-data-layer, Property 8: DataStore assembly invariants

import fc from 'fast-check';
import { test } from '@fast-check/vitest';
import { toChartSource } from '../../src/airtable/show-name-map.ts';

// ============================================================
// Property 4: Artist record field mapping
// **Validates: Requirements 4.1, 4.2, 4.4, 4.5, 4.6, 4.7**
//
// For any valid Artist Airtable record (with non-empty Full Name,
// valid Type, valid Gen, and non-empty logo_name), the produced
// ParsedArtist SHALL satisfy:
// - id equals the logo_name field value
// - name equals the Full Name field value
// - logoUrl equals assets/logos/${logo_name}.svg
// - generation equals parseInt(Gen)
// - koreanName equals the Native Name value when non-empty, otherwise undefined
// - debut equals the Debut value when non-empty, otherwise undefined
// ============================================================

const P4_VALID_TYPES = ['Boy Group', 'Girl Group', 'Solo Male', 'Solo Female', 'Mixed Group', 'Solo Non-Binary'] as const;

/** Generate a non-empty lowercase alpha/underscore string for logo_name */
const p4LogoNameArb = fc.string({ minLength: 1, maxLength: 20, unit: fc.constantFrom(
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  '_',
) });

/** Generate a non-empty Full Name */
const p4FullNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

/** Generate a valid artist type */
const p4TypeArb = fc.constantFrom(...P4_VALID_TYPES);

/** Generate a valid generation string (1-5) */
const p4GenArb = fc.integer({ min: 1, max: 5 }).map(n => String(n));

/** Generate an optional Native Name (sometimes empty, sometimes valid) */
const p4NativeNameArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
);

/** Generate an optional Debut date (sometimes empty, sometimes valid ISO date) */
const p4DebutArb = fc.oneof(
  fc.constant(''),
  fc.date({ min: new Date('1990-01-01'), max: new Date('2025-12-31') })
    .filter(d => !isNaN(d.getTime()))
    .map(d => d.toISOString().slice(0, 10)),
);

/** Composite arbitrary for Property 4 artist fields */
const p4ArtistFieldsArb = fc.record({
  logoName: p4LogoNameArb,
  fullName: p4FullNameArb,
  type: p4TypeArb,
  gen: p4GenArb,
  nativeName: p4NativeNameArb,
  debut: p4DebutArb,
});

/**
 * Build mock fetch that returns 4 table responses for a single artist with
 * one release linked to one ranking+episode (so the artist has dailyValues
 * and is included in the DataStore).
 */
function buildP4MockFetch(fields: {
  logoName: string;
  fullName: string;
  type: string;
  gen: string;
  nativeName: string;
  debut: string;
}) {
  const artistRecordId = 'recArtistP4_001';
  const releaseRecordId = 'recReleaseP4_001';
  const episodeRecordId = 'recEpisodeP4_001';
  const rankingRecordId = 'recRankingP4_001';

  const tableResponses = [
    // Artists
    {
      records: [{
        id: artistRecordId,
        fields: {
          'Full Name': fields.fullName,
          'Native Name': fields.nativeName,
          'Type': fields.type,
          'Gen': fields.gen,
          'Debut': fields.debut,
          'logo_name': fields.logoName,
          'Releases': [releaseRecordId],
        },
      }],
    },
    // Releases
    {
      records: [{
        id: releaseRecordId,
        fields: {
          'Name': 'P4 Test Release',
          'Artist': [artistRecordId],
          'Date': '2024-03-01',
          'Rankings': [rankingRecordId],
        },
      }],
    },
    // Episodes
    {
      records: [{
        id: episodeRecordId,
        fields: {
          'Date': '2024-03-05',
          'Show': 'Inkigayo',
          'Episode': 42,
        },
      }],
    },
    // Rankings
    {
      records: [{
        id: rankingRecordId,
        fields: {
          'Score': 7500,
          'Release': [releaseRecordId],
          'Episode': [episodeRecordId],
        },
      }],
    },
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

describe('Property 4: Artist record field mapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test.prop([p4ArtistFieldsArb], { numRuns: 100 })(
    'ParsedArtist fields are correctly mapped from Airtable Artist record fields',
    async ({ logoName, fullName, type, gen, nativeName, debut }) => {
      const mockFetch = buildP4MockFetch({ logoName, fullName, type, gen, nativeName, debut });
      vi.stubGlobal('fetch', mockFetch);
      vi.stubEnv('VITE_AIRTABLE_API_TOKEN', 'test_token_p4_valid');

      // Mock sessionStorage to prevent cache interactions
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

      // The artist should be present in the DataStore keyed by logo_name
      const artist = dataStore.artists.get(logoName);
      expect(artist).toBeDefined();

      if (artist) {
        // id equals the logo_name field value
        expect(artist.id).toBe(logoName);

        // name equals the Full Name field value
        expect(artist.name).toBe(fullName);

        // logoUrl equals assets/logos/${logo_name}.svg
        expect(artist.logoUrl).toBe(`assets/logos/${logoName}.svg`);

        // generation equals parseInt(Gen)
        expect(artist.generation).toBe(parseInt(gen, 10));

        // koreanName equals the Native Name value when non-empty, otherwise undefined
        if (nativeName && nativeName.trim() !== '') {
          expect(artist.koreanName).toBe(nativeName);
        } else {
          expect(artist.koreanName).toBeUndefined();
        }

        // debut equals the Debut value when non-empty, otherwise undefined
        if (debut && debut.trim() !== '') {
          expect(artist.debut).toBe(debut);
        } else {
          expect(artist.debut).toBeUndefined();
        }
      }
    },
  );
});

// ============================================================
// Property 6: Ranking-to-DailyValue mapping
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
//
// For any Ranking record with a linked Release and a linked Episode
// (where the Episode has a Date, Show, and Episode number), the
// Data_Adapter SHALL produce a DailyValueEntry where `value` equals
// the Ranking `Score`, the Map key equals the Episode `Date`,
// `source` equals `toChartSource(Episode.Show)`, and `episode`
// equals the Episode number.
// ============================================================

/** The 6 known show display names from Airtable */
const KNOWN_SHOWS = [
  'The Show',
  'Show Champion',
  'M Countdown',
  'Music Bank',
  'Show! Music Core',
  'Inkigayo',
] as const;

/** Arbitrary for a known show name */
const showArb = fc.constantFrom(...KNOWN_SHOWS);

/** Arbitrary for a positive integer score */
const scoreArb = fc.integer({ min: 1, max: 100_000 });

/** Arbitrary for a positive integer episode number */
const episodeNumberArb = fc.integer({ min: 1, max: 9999 });

/** Arbitrary for a date string in ISO YYYY-MM-DD format */
const p6DateArb = fc.date({
  min: new Date(2020, 0, 1),
  max: new Date(2030, 11, 31),
}).map((d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
});

describe('Property 6: Ranking-to-DailyValue mapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test.prop(
    [scoreArb, showArb, episodeNumberArb, p6DateArb],
    { numRuns: 100 },
  )(
    'a Ranking with linked Release and Episode produces correct DailyValueEntry',
    async (score, show, episodeNumber, date) => {
      // Create record IDs
      const artistRecordId = 'recArtist001';
      const releaseRecordId = 'recRelease001';
      const episodeRecordId = 'recEpisode001';
      const rankingRecordId = 'recRanking001';

      // Artist record: valid artist with all required fields
      const artistRecords = [
        {
          id: artistRecordId,
          fields: {
            'Full Name': 'Test Artist',
            'Native Name': '테스트',
            Type: 'Boy Group',
            Gen: '4',
            Debut: '2020-01-15',
            logo_name: 'test_artist',
            Releases: [releaseRecordId],
          },
        },
      ];

      // Release record: linked to the artist
      const releaseRecords = [
        {
          id: releaseRecordId,
          fields: {
            Name: 'Test Song',
            Artist: [artistRecordId],
            Date: '2024-01-01',
            Rankings: [rankingRecordId],
          },
        },
      ];

      // Episode record: with generated Date, Show, and Episode number
      const episodeRecords = [
        {
          id: episodeRecordId,
          fields: {
            Date: date,
            Show: show,
            Episode: episodeNumber,
          },
        },
      ];

      // Ranking record: linked to release and episode with generated score
      const rankingRecords = [
        {
          id: rankingRecordId,
          fields: {
            Score: score,
            Release: [releaseRecordId],
            Episode: [episodeRecordId],
          },
        },
      ];

      // Build paginated responses for each table fetch
      const responses = [
        new Response(JSON.stringify({ records: artistRecords }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
        new Response(JSON.stringify({ records: releaseRecords }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
        new Response(JSON.stringify({ records: episodeRecords }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
        new Response(JSON.stringify({ records: rankingRecords }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ];

      let fetchCallIndex = 0;
      const mockFetch = vi.fn(async () => {
        const response = responses[fetchCallIndex];
        fetchCallIndex++;
        return response;
      });

      vi.stubGlobal('fetch', mockFetch);
      vi.stubEnv('VITE_AIRTABLE_API_TOKEN', 'test_token_abc123');

      // Mock sessionStorage to prevent cache interactions
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

      // Find the test artist
      const artist = dataStore.artists.get('test_artist');
      expect(artist).toBeDefined();
      expect(artist!.releases.length).toBeGreaterThanOrEqual(1);

      // Find the release
      const release = artist!.releases.find((r) => r.title === 'Test Song');
      expect(release).toBeDefined();

      // Verify dailyValues entry for the episode date
      const dailyValue = release!.dailyValues.get(date);
      expect(dailyValue).toBeDefined();

      // Property assertions:
      // value equals the Ranking Score
      expect(dailyValue!.value).toBe(score);
      // source equals toChartSource(Episode.Show)
      expect(dailyValue!.source).toBe(toChartSource(show));
      // episode equals the Episode number
      expect(dailyValue!.episode).toBe(episodeNumber);
    },
  );
});

// ============================================================
// Property 7: Embed generation and type ordering
//
// For any set of Release and Ranking records, the produced embeds
// Map SHALL:
// - Contain only entries of type release_date, mv, or live_performance
// - For each date key with multiple embeds, order them as release_date
//   first, then mv, then live_performance
// - Include a release_date entry for any Release with both a Date and
//   Apple Music URL
// - Include an mv entry for any Release with both a Date and MV URL
// - Include a live_performance entry for any Ranking with a Performance
//   URL whose linked Episode has a Date
// ============================================================

const VALID_EMBED_TYPES = ['mv', 'live_performance'] as const;
const EMBED_TYPE_ORDER: Record<string, number> = {
  mv: 0,
  live_performance: 1,
};

/** Generate a date in YYYY-MM-DD format using integer-based generation for reliability */
const isoDateArb = fc.tuple(
  fc.integer({ min: 2020, max: 2025 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 }),
).map(([year, month, day]) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
);

/** Generate a URL string */
const urlArb = fc.webUrl();

/** Generate optional URL (present or absent) */
const optionalUrlArb = fc.option(urlArb, { nil: undefined });

/** Generate a release with optional Apple Music URL, optional MV URL, and a Date */
interface GeneratedRelease {
  name: string;
  date: string;
  appleMusicUrl: string | undefined;
  mvUrl: string | undefined;
}

const releaseArb: fc.Arbitrary<GeneratedRelease> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
  date: isoDateArb,
  appleMusicUrl: optionalUrlArb,
  mvUrl: optionalUrlArb,
});

/** Generate a ranking with optional Performance URL, linked to an episode with a date */
interface GeneratedRanking {
  score: number;
  performanceUrl: string | undefined;
  episodeDate: string;
  episodeShow: string;
  episodeNumber: number;
}

const rankingArb: fc.Arbitrary<GeneratedRanking> = fc.record({
  score: fc.integer({ min: 1, max: 11000 }),
  performanceUrl: optionalUrlArb,
  episodeDate: isoDateArb,
  episodeShow: fc.constantFrom('The Show', 'Show Champion', 'M Countdown', 'Music Bank', 'Show! Music Core', 'Inkigayo'),
  episodeNumber: fc.integer({ min: 1, max: 999 }),
});

/**
 * Build mock fetch responses for our generated data.
 * We need 4 tables: Artists, Releases, Episodes, Rankings.
 * We create 1 artist, 1 release, 1 episode per ranking.
 */
function buildMockFetch(release: GeneratedRelease, rankings: GeneratedRanking[]) {
  const artistId = 'recArtist001';
  const releaseId = 'recRelease001';

  // Build episode records (one per ranking)
  const episodeRecords = rankings.map((ranking, i) => ({
    id: `recEpisode${String(i).padStart(3, '0')}`,
    fields: {
      Date: ranking.episodeDate,
      Show: ranking.episodeShow,
      Episode: ranking.episodeNumber,
    },
  }));

  // Build ranking records
  const rankingRecords = rankings.map((ranking, i) => ({
    id: `recRanking${String(i).padStart(3, '0')}`,
    fields: {
      Score: ranking.score,
      Release: [releaseId],
      Episode: [episodeRecords[i].id],
      ...(ranking.performanceUrl ? { Performance: ranking.performanceUrl } : {}),
    },
  }));

  // Build release record
  const releaseRecord = {
    id: releaseId,
    fields: {
      Name: release.name,
      Artist: [artistId],
      Date: release.date,
      ...(release.appleMusicUrl ? { 'Apple Music': release.appleMusicUrl } : {}),
      ...(release.mvUrl ? { MV: release.mvUrl } : {}),
      Rankings: rankingRecords.map((r) => r.id),
    },
  };

  // Build artist record
  const artistRecord = {
    id: artistId,
    fields: {
      'Full Name': 'Test Artist',
      'Native Name': '테스트',
      Type: 'Boy Group',
      Gen: '4',
      logo_name: 'test_artist',
      Releases: [releaseId],
    },
  };

  // The 4 table responses in sequential fetch order: Artists, Releases, Episodes, Rankings
  const tableResponses = [
    { records: [artistRecord] },
    { records: [releaseRecord] },
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

describe('Property 7: Embed generation and type ordering', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_AIRTABLE_API_TOKEN', 'test_token_valid_123');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test.prop(
    [releaseArb, fc.array(rankingArb, { minLength: 1, maxLength: 3 })],
    { numRuns: 100 },
  )(
    'embeds contain only valid types and are correctly ordered',
    async (release, rankings) => {
      // Set the first ranking's episode date to the release date so they share a date key
      const adjustedRankings = [{ ...rankings[0], episodeDate: release.date }, ...rankings.slice(1)];

      const mockFetch = buildMockFetch(release, adjustedRankings);
      vi.stubGlobal('fetch', mockFetch);

      // Mock sessionStorage to prevent cache interactions
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

      // Get the release from the artist
      const artist = dataStore.artists.get('test_artist');
      if (!artist || artist.releases.length === 0) {
        // If the artist has no dailyValues, it may be excluded.
        // This can happen if no rankings have scores or episodes.
        // In that case, there are no embeds to verify, which is fine.
        return;
      }

      const parsedRelease = artist.releases[0];
      const embeds = parsedRelease.embeds;

      // Verify 1: All embed entries are only of valid types
      for (const [, entries] of embeds) {
        for (const entry of entries) {
          expect(VALID_EMBED_TYPES).toContain(entry.type);
        }
      }

      // Verify 2: For each date key, embeds are ordered correctly
      for (const [, entries] of embeds) {
        for (let i = 1; i < entries.length; i++) {
          const prevOrder = EMBED_TYPE_ORDER[entries[i - 1].type] ?? 99;
          const currOrder = EMBED_TYPE_ORDER[entries[i].type] ?? 99;
          expect(prevOrder).toBeLessThanOrEqual(currOrder);
        }
      }

      // Verify 3: If release has Date + Apple Music URL, it should appear in albumReleases (not embeds)
      if (release.appleMusicUrl) {
        const hasAlbumRelease = artist.albumReleases.some(
          (ar) => ar.date === release.date && ar.appleMusicUrl === release.appleMusicUrl,
        );
        expect(hasAlbumRelease).toBe(true);
      }

      // Verify 4: If release has Date + MV URL, there should be an mv embed
      if (release.mvUrl) {
        const dateEntries = embeds.get(release.date);
        expect(dateEntries).toBeDefined();
        const hasMv = dateEntries!.some(
          (e) => e.type === 'mv' && e.url === release.mvUrl,
        );
        expect(hasMv).toBe(true);
      }

      // Verify 5: If a ranking has Performance URL and episode has Date,
      // there should be a live_performance embed on that episode date
      for (const ranking of adjustedRankings) {
        if (ranking.performanceUrl) {
          const dateEntries = embeds.get(ranking.episodeDate);
          expect(dateEntries).toBeDefined();
          const hasLivePerf = dateEntries!.some(
            (e) => e.type === 'live_performance' && e.url === ranking.performanceUrl,
          );
          expect(hasLivePerf).toBe(true);
        }
      }
    },
  );
});

// ============================================================
// Property 8: DataStore assembly invariants
// **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6**
//
// For any set of valid mapped artists (each having at least one
// release with at least one dailyValues entry), the assembled
// DataStore SHALL satisfy:
// - artists Map keys equal each artist's id
// - dates array contains every unique date across all dailyValues
//   Maps, is sorted lexicographically ascending, and has no duplicates
// - startDate equals dates[0] and endDate equals dates[dates.length - 1]
//   (or both empty strings if dates is empty)
// - firstAppearance.get(artistId) equals the lexicographically earliest
//   date across all of that artist's releases' dailyValues keys
// - Artists with zero dailyValues entries across all releases are
//   excluded from the artists Map
// ============================================================

/** Generate a unique lowercase alpha+underscore logo_name */
const assemblyLogoNameArb = (index: number) =>
  fc.constant(`artist_${index}`);

/** Generate 1-5 ISO dates for episode/dailyValues entries */
const assemblyDateArb = fc.tuple(
  fc.integer({ min: 2020, max: 2029 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 }),
).map(([y, m, d]) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
);

const assembleDateSetArb = fc.array(assemblyDateArb, { minLength: 1, maxLength: 5 });

/** Generate a single artist's data: logo_name, fullName, and date sets for releases */
interface GeneratedArtistData {
  logoName: string;
  fullName: string;
  releases: { name: string; dates: string[] }[];
}

const artistDataArb = (index: number): fc.Arbitrary<GeneratedArtistData> =>
  fc.record({
    logoName: assemblyLogoNameArb(index),
    fullName: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
    releases: fc.array(
      fc.record({
        name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0).map((s) => `release_${index}_${s}`),
        dates: assembleDateSetArb,
      }),
      { minLength: 1, maxLength: 3 },
    ),
  });

/** Generate 1-5 artists, each with at least one release with dailyValues */
const multiArtistArb = fc.integer({ min: 1, max: 5 }).chain((count) =>
  fc.tuple(...Array.from({ length: count }, (_, i) => artistDataArb(i))),
);

/**
 * Build Airtable mock responses from generated artist data.
 * Creates corresponding Artist, Release, Episode, and Ranking records.
 */
function buildAssemblyMockFetch(artists: GeneratedArtistData[]) {
  const artistRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const releaseRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const episodeRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const rankingRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];

  let releaseCounter = 0;
  let episodeCounter = 0;
  let rankingCounter = 0;

  for (let aIdx = 0; aIdx < artists.length; aIdx++) {
    const artist = artists[aIdx];
    const artistRecordId = `recArtist${String(aIdx).padStart(3, '0')}`;
    const releaseIds: string[] = [];

    for (const release of artist.releases) {
      const releaseRecordId = `recRelease${String(releaseCounter).padStart(3, '0')}`;
      releaseCounter++;
      releaseIds.push(releaseRecordId);

      const rankingIds: string[] = [];

      for (const date of release.dates) {
        const episodeRecordId = `recEpisode${String(episodeCounter).padStart(4, '0')}`;
        const rankingRecordId = `recRanking${String(rankingCounter).padStart(4, '0')}`;
        episodeCounter++;
        rankingCounter++;

        episodeRecords.push({
          id: episodeRecordId,
          fields: {
            Date: date,
            Show: 'Inkigayo',
            Episode: episodeCounter,
          },
        });

        rankingRecords.push({
          id: rankingRecordId,
          fields: {
            Score: 1000 + rankingCounter,
            Release: [releaseRecordId],
            Episode: [episodeRecordId],
          },
        });

        rankingIds.push(rankingRecordId);
      }

      releaseRecords.push({
        id: releaseRecordId,
        fields: {
          Name: release.name,
          Artist: [artistRecordId],
          Date: release.dates[0],
          Rankings: rankingIds,
        },
      });
    }

    artistRecords.push({
      id: artistRecordId,
      fields: {
        'Full Name': artist.fullName,
        'Native Name': '',
        Type: 'Girl Group',
        Gen: '4',
        logo_name: artist.logoName,
        Releases: releaseIds,
      },
    });
  }

  const tableResponses = [
    { records: artistRecords },
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

describe('Property 8: DataStore assembly invariants', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_AIRTABLE_API_TOKEN', 'test_token_valid_123');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test.prop([multiArtistArb], { numRuns: 100 })(
    'assembled DataStore satisfies all structural invariants',
    async (artists) => {
      const mockFetch = buildAssemblyMockFetch(artists);
      vi.stubGlobal('fetch', mockFetch);

      // Mock sessionStorage to prevent cache interactions
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

      // --- Invariant 1: artists Map keys equal each artist's id ---
      for (const [key, artist] of dataStore.artists) {
        expect(key).toBe(artist.id);
      }

      // --- Invariant 2: dates array contains every unique date, sorted, no dupes ---
      // Collect all dates from all artists' releases' dailyValues
      const allDatesSet = new Set<string>();
      for (const artist of dataStore.artists.values()) {
        for (const release of artist.releases) {
          for (const date of release.dailyValues.keys()) {
            allDatesSet.add(date);
          }
        }
      }

      // dates array should contain every unique date
      const expectedDates = Array.from(allDatesSet).sort();
      expect(dataStore.dates).toEqual(expectedDates);

      // No duplicates
      const dateSetFromArray = new Set(dataStore.dates);
      expect(dateSetFromArray.size).toBe(dataStore.dates.length);

      // Sorted lexicographically ascending
      for (let i = 1; i < dataStore.dates.length; i++) {
        expect(dataStore.dates[i - 1] <= dataStore.dates[i]).toBe(true);
      }

      // --- Invariant 3: startDate and endDate ---
      if (dataStore.dates.length > 0) {
        expect(dataStore.startDate).toBe(dataStore.dates[0]);
        expect(dataStore.endDate).toBe(dataStore.dates[dataStore.dates.length - 1]);
      } else {
        expect(dataStore.startDate).toBe('');
        expect(dataStore.endDate).toBe('');
      }

      // --- Invariant 4: firstAppearance equals earliest date for each artist ---
      for (const [artistId, artist] of dataStore.artists) {
        let earliest: string | undefined;
        for (const release of artist.releases) {
          for (const date of release.dailyValues.keys()) {
            if (!earliest || date < earliest) {
              earliest = date;
            }
          }
        }
        if (earliest) {
          expect(dataStore.firstAppearance.get(artistId)).toBe(earliest);
        }
      }

      // --- Invariant 5: Artists with zero dailyValues are excluded ---
      for (const artist of dataStore.artists.values()) {
        const hasDailyValues = artist.releases.some((r) => r.dailyValues.size > 0);
        expect(hasDailyValues).toBe(true);
      }

      // Additionally verify that all generated artists that should be in the store ARE in the store
      // (each generated artist has at least one release with at least one date)
      for (const generatedArtist of artists) {
        const hasAnyDates = generatedArtist.releases.some((r) => r.dates.length > 0);
        if (hasAnyDates) {
          expect(dataStore.artists.has(generatedArtist.logoName)).toBe(true);
        }
      }
    },
  );
});


// ============================================================
// Feature: airtable-data-layer, Property 5: Multi-artist release duplication
// **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
//
// For any Release record linking to N Artists (N ≥ 1), the
// Data_Adapter SHALL produce exactly N ParsedRelease instances
// (one in each linked artist's releases array) where each
// instance has identical title, id (slugified Name), dailyValues
// entries, and embeds entries.
// ============================================================

/** Valid artist types in Airtable for Property 5 */
const VALID_ARTIST_TYPES_P5 = ['Boy Group', 'Girl Group', 'Solo Male', 'Solo Female', 'Mixed Group', 'Solo Non-Binary'] as const;

/** Valid show names for episodes in Property 5 */
const VALID_SHOWS_P5 = ['The Show', 'Show Champion', 'M Countdown', 'Music Bank', 'Show! Music Core', 'Inkigayo'] as const;

/** Generate a valid artist record for Property 5 */
function artistRecordArbP5(index: number) {
  return fc.record({
    fullName: fc.string({ minLength: 2, maxLength: 30 }).filter((s) => s.trim().length > 0 && /[a-zA-Z0-9]/.test(s)),
    type: fc.constantFrom(...VALID_ARTIST_TYPES_P5),
    gen: fc.integer({ min: 1, max: 5 }).map(String),
  }).map((fields) => ({
    id: `recArtistP5_${index}`,
    logoName: `test_artist_p5_${index}`,
    fullName: fields.fullName,
    type: fields.type,
    gen: fields.gen,
  }));
}

/** Generate a release name that slugifies predictably for Property 5 */
const releaseNameArbP5 = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0 && /[a-zA-Z0-9]/.test(s));

/** Generate a valid date string in YYYY-MM-DD format for Property 5 */
const dateArbP5 = fc
  .integer({ min: 0, max: 2190 }) // days offset from 2020-01-01 (covers ~6 years)
  .map((daysOffset) => {
    const base = new Date('2020-01-01T00:00:00Z');
    base.setUTCDate(base.getUTCDate() + daysOffset);
    return base.toISOString().slice(0, 10);
  });

/** Generate a ranking for Property 5 */
function rankingArbP5(releaseRecordId: string, index: number) {
  return fc.record({
    score: fc.integer({ min: 1, max: 10000 }),
    show: fc.constantFrom(...VALID_SHOWS_P5),
    episodeNumber: fc.integer({ min: 1, max: 999 }),
    date: dateArbP5,
    performanceUrl: fc.oneof(
      fc.constant(undefined),
      fc.webUrl(),
    ),
  }).map((fields) => ({
    rankingId: `recRankingP5_${index}`,
    episodeId: `recEpisodeP5_${index}`,
    releaseId: releaseRecordId,
    score: fields.score,
    show: fields.show,
    episodeNumber: fields.episodeNumber,
    date: fields.date,
    performanceUrl: fields.performanceUrl,
  }));
}

/**
 * Build mock fetch responses for multi-artist release test.
 */
function buildMockFetchMultiArtist(
  artists: Array<{ id: string; logoName: string; fullName: string; type: string; gen: string }>,
  releaseName: string,
  releaseRecordId: string,
  rankings: Array<{ rankingId: string; episodeId: string; releaseId: string; score: number; show: string; episodeNumber: number; date: string; performanceUrl: string | undefined }>,
) {
  const artistRecords = artists.map((a) => ({
    id: a.id,
    fields: {
      'Full Name': a.fullName,
      'Native Name': '',
      'Type': a.type,
      'Gen': a.gen,
      'Debut': '',
      'logo_name': a.logoName,
      'Releases': [releaseRecordId],
    },
  }));

  const releaseRecord = {
    id: releaseRecordId,
    fields: {
      'Name': releaseName,
      'Artist': artists.map((a) => a.id),
      'Date': rankings[0].date,
      'Apple Music': 'https://music.apple.com/test-multi',
      'MV': 'https://youtube.com/test-mv-multi',
      'Rankings': rankings.map((r) => r.rankingId),
    },
  };

  const episodeRecords = rankings.map((r) => ({
    id: r.episodeId,
    fields: {
      'Date': r.date,
      'Show': r.show,
      'Episode': r.episodeNumber,
    },
  }));

  const rankingRecords = rankings.map((r) => ({
    id: r.rankingId,
    fields: {
      'Score': r.score,
      'Release': [r.releaseId],
      'Episode': [r.episodeId],
      ...(r.performanceUrl ? { 'Performance': r.performanceUrl } : {}),
    },
  }));

  const tableResponses = [
    { records: artistRecords },
    { records: [releaseRecord] },
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

describe('Property 5: Multi-artist release duplication', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_AIRTABLE_API_TOKEN', 'test_token_valid_123');
    // Mock sessionStorage to prevent cache interactions
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  // Generate N (1-5) valid artists, a single release linking to all, and 1-3 rankings
  const multiArtistReleaseArb = fc
    .integer({ min: 1, max: 5 })
    .chain((numArtists) =>
      fc.tuple(
        fc.tuple(...Array.from({ length: numArtists }, (_, i) => artistRecordArbP5(i))),
        releaseNameArbP5,
        fc.integer({ min: 1, max: 3 }),
      ),
    )
    .chain(([artists, releaseName, numRankings]) => {
      const releaseRecordId = 'recReleaseP5_001';
      return fc.tuple(
        fc.constant(artists),
        fc.constant(releaseName),
        fc.constant(releaseRecordId),
        fc.tuple(
          ...Array.from({ length: numRankings }, (_, i) =>
            rankingArbP5(releaseRecordId, i),
          ),
        ),
      );
    });

  test.prop([multiArtistReleaseArb], { numRuns: 100 })(
    'a release linked to N artists produces N identical ParsedRelease instances',
    async ([artists, releaseName, releaseRecordId, rankings]) => {
      const mockFetch = buildMockFetchMultiArtist(artists, releaseName, releaseRecordId, rankings);
      vi.stubGlobal('fetch', mockFetch);

      const { loadFromAirtable } = await import('../../src/airtable/data-adapter.ts');
      const dataStore = await loadFromAirtable();

      // Compute expected slugified release ID
      const expectedReleaseId = releaseName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      // Collect the ParsedRelease from each artist
      const parsedReleases = [];
      for (const artist of artists) {
        const parsedArtist = dataStore.artists.get(artist.logoName);
        expect(parsedArtist).toBeDefined();

        const matchingRelease = parsedArtist!.releases.find(
          (r) => r.id === expectedReleaseId,
        );
        expect(matchingRelease).toBeDefined();
        parsedReleases.push(matchingRelease!);
      }

      // All N artists should have a copy of the release
      expect(parsedReleases.length).toBe(artists.length);

      // All should have identical title and id
      const first = parsedReleases[0];
      for (const release of parsedReleases) {
        expect(release.title).toBe(first.title);
        expect(release.id).toBe(first.id);
      }

      // All should have identical dailyValues entries (same date keys, same values)
      for (const release of parsedReleases) {
        expect(release.dailyValues.size).toBe(first.dailyValues.size);
        for (const [dateKey, entry] of first.dailyValues) {
          const otherEntry = release.dailyValues.get(dateKey);
          expect(otherEntry).toBeDefined();
          expect(otherEntry!.value).toBe(entry.value);
          expect(otherEntry!.source).toBe(entry.source);
          expect(otherEntry!.episode).toBe(entry.episode);
        }
      }

      // All should have identical embeds entries (same date keys, same entries)
      for (const release of parsedReleases) {
        expect(release.embeds.size).toBe(first.embeds.size);
        for (const [dateKey, entries] of first.embeds) {
          const otherEntries = release.embeds.get(dateKey);
          expect(otherEntries).toBeDefined();
          expect(otherEntries!.length).toBe(entries.length);
          for (let i = 0; i < entries.length; i++) {
            expect(otherEntries![i].type).toBe(entries[i].type);
            expect(otherEntries![i].url).toBe(entries[i].url);
          }
        }
      }
    },
  );
});
