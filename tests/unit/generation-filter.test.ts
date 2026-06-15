/**
 * Unit tests for generation filtering logic.
 * Tests the applyGenerationFilter and extractGenerations functions.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.6
 */

import { applyGenerationFilter, extractGenerations } from '../../src/chart-engine.ts';
import type { DataStore, ParsedArtist, ParsedRelease, RankedEntry } from '../../src/models.ts';
import type { ArtistType, DailyValueEntry } from '../../src/types.ts';

// --- Test Helpers ---

function makeRankedEntry(overrides: Partial<RankedEntry> = {}): RankedEntry {
  return {
    artistId: 'artist-1',
    artistName: 'Default Artist',
    artistType: 'boy_group',
    generation: 4,
    logoUrl: 'assets/logos/default.svg',
    cumulativeValue: 100,
    previousCumulativeValue: 80,
    dailyValue: 20,
    rank: 1,
    previousRank: 1,
    featuredRelease: { releaseId: 'r1', title: 'Song A' },
    isGoalpost: false,
    ...overrides,
  };
}

function makeArtist(overrides: Partial<ParsedArtist> = {}): ParsedArtist {
  return {
    id: 'artist-1',
    name: 'Default Artist',
    artistType: 'boy_group',
    generation: 4,
    logoUrl: 'assets/logos/default.svg',
    releases: [],
    albumReleases: [],
    ...overrides,
  };
}

function makeDataStore(artists: ParsedArtist[]): DataStore {
  const artistsMap = new Map<string, ParsedArtist>();
  for (const artist of artists) {
    artistsMap.set(artist.id, artist);
  }
  return {
    artists: artistsMap,
    dates: [],
    startDate: '',
    endDate: '',
    firstAppearance: new Map(),
    chartWins: new Map(),
  };
}

// --- Test Data ---

const gen3Entry = makeRankedEntry({
  artistId: 'bts',
  artistName: 'BTS',
  artistType: 'boy_group',
  generation: 3,
  cumulativeValue: 500,
  rank: 1,
});

const gen4EntryA = makeRankedEntry({
  artistId: 'aespa',
  artistName: 'aespa',
  artistType: 'girl_group',
  generation: 4,
  cumulativeValue: 400,
  rank: 2,
});

const gen4EntryB = makeRankedEntry({
  artistId: 'ive',
  artistName: 'IVE',
  artistType: 'girl_group',
  generation: 4,
  cumulativeValue: 300,
  rank: 3,
});

const gen5Entry = makeRankedEntry({
  artistId: 'babymonster',
  artistName: 'BABYMONSTER',
  artistType: 'girl_group',
  generation: 5,
  cumulativeValue: 200,
  rank: 4,
});

const allEntries = [gen3Entry, gen4EntryA, gen4EntryB, gen5Entry];

// ============================================================
// applyGenerationFilter — "All" passes all entries through
// Requirement 6.1: "All" option shows all entries
// ============================================================

describe('applyGenerationFilter — "All" passes all entries through', () => {
  it('returns all entries unchanged when generation is "all"', () => {
    const result = applyGenerationFilter(allEntries, 'all');

    expect(result).toHaveLength(4);
    expect(result[0].artistId).toBe('bts');
    expect(result[1].artistId).toBe('aespa');
    expect(result[2].artistId).toBe('ive');
    expect(result[3].artistId).toBe('babymonster');
  });

  it('preserves cumulative values when generation is "all"', () => {
    const result = applyGenerationFilter(allEntries, 'all');

    expect(result[0].cumulativeValue).toBe(500);
    expect(result[1].cumulativeValue).toBe(400);
    expect(result[2].cumulativeValue).toBe(300);
    expect(result[3].cumulativeValue).toBe(200);
  });

  it('returns empty array when given empty entries with "all"', () => {
    const result = applyGenerationFilter([], 'all');
    expect(result).toHaveLength(0);
  });
});

// ============================================================
// applyGenerationFilter — Specific generation filters to only matching artists
// Requirement 6.2: Selecting a generation shows only artists of that generation
// ============================================================

describe('applyGenerationFilter — specific generation filters to matching artists', () => {
  it('filters to only generation 4 artists when generation is 4', () => {
    const result = applyGenerationFilter(allEntries, 4);

    expect(result).toHaveLength(2);
    expect(result[0].artistId).toBe('aespa');
    expect(result[1].artistId).toBe('ive');
  });

  it('filters to only generation 3 artists when generation is 3', () => {
    const result = applyGenerationFilter(allEntries, 3);

    expect(result).toHaveLength(1);
    expect(result[0].artistId).toBe('bts');
  });

  it('filters to only generation 5 artists when generation is 5', () => {
    const result = applyGenerationFilter(allEntries, 5);

    expect(result).toHaveLength(1);
    expect(result[0].artistId).toBe('babymonster');
  });

  it('returns empty array when no artists match the generation', () => {
    const result = applyGenerationFilter(allEntries, 1);

    expect(result).toHaveLength(0);
  });
});

// ============================================================
// applyGenerationFilter — Songs mode: release passes if at least one co-artist matches
// Requirement 6.3: In Songs mode, a release passes if at least one co-artist belongs to selected generation
// ============================================================

describe('applyGenerationFilter — Songs mode co-artist generation matching', () => {
  it('passes a release where one co-artist matches the selected generation', () => {
    // A song by a gen 4 artist featuring a gen 3 artist
    const songEntry = makeRankedEntry({
      artistId: 'aespa::release-1',
      artistName: 'Collaboration Song',
      generation: 4, // primary artist is gen 4
      cumulativeValue: 350,
      rank: 1,
      releaseKey: 'aespa::release-1',
      mode: 'songs',
      coArtists: [
        { id: 'aespa', name: 'aespa', logoUrl: 'logos/aespa.svg', artistType: 'girl_group', generation: 4 },
        { id: 'bts', name: 'BTS', logoUrl: 'logos/bts.svg', artistType: 'boy_group', generation: 3 },
      ],
    });

    // Filter for gen 3 — should pass because BTS (gen 3) is a co-artist
    const result = applyGenerationFilter([songEntry], 3);

    expect(result).toHaveLength(1);
    expect(result[0].artistId).toBe('aespa::release-1');
  });

  it('passes a release where the primary artist matches generation even if co-artists do not', () => {
    const songEntry = makeRankedEntry({
      artistId: 'aespa::release-2',
      artistName: 'Solo Song',
      generation: 4,
      cumulativeValue: 250,
      rank: 1,
      releaseKey: 'aespa::release-2',
      mode: 'songs',
      coArtists: [
        { id: 'aespa', name: 'aespa', logoUrl: 'logos/aespa.svg', artistType: 'girl_group', generation: 4 },
      ],
    });

    // Filter for gen 4 — should pass
    const result = applyGenerationFilter([songEntry], 4);

    expect(result).toHaveLength(1);
    expect(result[0].artistId).toBe('aespa::release-2');
  });

  it('excludes a release where no co-artist matches the selected generation', () => {
    const songEntry = makeRankedEntry({
      artistId: 'aespa::release-3',
      artistName: 'Gen 4 Only Song',
      generation: 4,
      cumulativeValue: 200,
      rank: 1,
      releaseKey: 'aespa::release-3',
      mode: 'songs',
      coArtists: [
        { id: 'aespa', name: 'aespa', logoUrl: 'logos/aespa.svg', artistType: 'girl_group', generation: 4 },
        { id: 'ive', name: 'IVE', logoUrl: 'logos/ive.svg', artistType: 'girl_group', generation: 4 },
      ],
    });

    // Filter for gen 3 — should be excluded (all co-artists are gen 4)
    const result = applyGenerationFilter([songEntry], 3);

    expect(result).toHaveLength(0);
  });

  it('handles a mix of songs with and without matching co-artists', () => {
    const songWithGen3CoArtist = makeRankedEntry({
      artistId: 'aespa::release-collab',
      artistName: 'Collab Song',
      generation: 4,
      cumulativeValue: 400,
      rank: 1,
      releaseKey: 'aespa::release-collab',
      mode: 'songs',
      coArtists: [
        { id: 'aespa', name: 'aespa', logoUrl: 'logos/aespa.svg', artistType: 'girl_group', generation: 4 },
        { id: 'bts', name: 'BTS', logoUrl: 'logos/bts.svg', artistType: 'boy_group', generation: 3 },
      ],
    });

    const songGen4Only = makeRankedEntry({
      artistId: 'ive::release-solo',
      artistName: 'IVE Solo',
      generation: 4,
      cumulativeValue: 300,
      rank: 2,
      releaseKey: 'ive::release-solo',
      mode: 'songs',
      coArtists: [
        { id: 'ive', name: 'IVE', logoUrl: 'logos/ive.svg', artistType: 'girl_group', generation: 4 },
      ],
    });

    // Filter for gen 3 — only the collab should pass
    const result = applyGenerationFilter([songWithGen3CoArtist, songGen4Only], 3);

    expect(result).toHaveLength(1);
    expect(result[0].artistId).toBe('aespa::release-collab');
  });
});

// ============================================================
// applyGenerationFilter — Filtered entries get contiguous ranks
// Requirement 6.6: After filtering, ranks are re-assigned as 1, 2, 3, …
// ============================================================

describe('applyGenerationFilter — contiguous ranks after filtering', () => {
  it('re-assigns ranks as 1, 2, 3 after filtering to gen 4', () => {
    const result = applyGenerationFilter(allEntries, 4);

    expect(result).toHaveLength(2);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
  });

  it('assigns rank 1 to the single remaining entry after filtering', () => {
    const result = applyGenerationFilter(allEntries, 3);

    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(1);
  });

  it('assigns contiguous ranks for all entries when "all"', () => {
    const result = applyGenerationFilter(allEntries, 'all');

    for (let i = 0; i < result.length; i++) {
      expect(result[i].rank).toBe(i + 1);
    }
  });

  it('preserves descending cumulative value ordering after filtering', () => {
    // Create entries with varied values and mixed generations
    const mixedEntries = [
      makeRankedEntry({ artistId: 'a', generation: 4, cumulativeValue: 1000, rank: 1 }),
      makeRankedEntry({ artistId: 'b', generation: 3, cumulativeValue: 900, rank: 2 }),
      makeRankedEntry({ artistId: 'c', generation: 4, cumulativeValue: 800, rank: 3 }),
      makeRankedEntry({ artistId: 'd', generation: 3, cumulativeValue: 700, rank: 4 }),
      makeRankedEntry({ artistId: 'e', generation: 4, cumulativeValue: 600, rank: 5 }),
    ];

    const result = applyGenerationFilter(mixedEntries, 4);

    expect(result).toHaveLength(3);
    expect(result[0].rank).toBe(1);
    expect(result[0].cumulativeValue).toBe(1000);
    expect(result[1].rank).toBe(2);
    expect(result[1].cumulativeValue).toBe(800);
    expect(result[2].rank).toBe(3);
    expect(result[2].cumulativeValue).toBe(600);
  });
});

// ============================================================
// extractGenerations — generations derived from data are sorted descending
// Requirement 6.1: Generation dropdown populated from data in descending order
// ============================================================

describe('extractGenerations — sorted descending from data', () => {
  it('returns all unique generations sorted in descending order', () => {
    const dataStore = makeDataStore([
      makeArtist({ id: 'a1', generation: 3 }),
      makeArtist({ id: 'a2', generation: 5 }),
      makeArtist({ id: 'a3', generation: 1 }),
      makeArtist({ id: 'a4', generation: 4 }),
      makeArtist({ id: 'a5', generation: 2 }),
    ]);

    const result = extractGenerations(dataStore);

    expect(result).toEqual([5, 4, 3, 2, 1]);
  });

  it('deduplicates repeated generation values', () => {
    const dataStore = makeDataStore([
      makeArtist({ id: 'a1', generation: 4 }),
      makeArtist({ id: 'a2', generation: 4 }),
      makeArtist({ id: 'a3', generation: 3 }),
      makeArtist({ id: 'a4', generation: 3 }),
      makeArtist({ id: 'a5', generation: 5 }),
    ]);

    const result = extractGenerations(dataStore);

    expect(result).toEqual([5, 4, 3]);
  });

  it('returns a single generation when all artists have the same generation', () => {
    const dataStore = makeDataStore([
      makeArtist({ id: 'a1', generation: 4 }),
      makeArtist({ id: 'a2', generation: 4 }),
    ]);

    const result = extractGenerations(dataStore);

    expect(result).toEqual([4]);
  });

  it('returns empty array when DataStore has no artists', () => {
    const dataStore = makeDataStore([]);

    const result = extractGenerations(dataStore);

    expect(result).toEqual([]);
  });

  it('handles a DataStore with a single artist', () => {
    const dataStore = makeDataStore([
      makeArtist({ id: 'solo', generation: 2 }),
    ]);

    const result = extractGenerations(dataStore);

    expect(result).toEqual([2]);
  });
});
