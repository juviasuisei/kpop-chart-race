/**
 * Unit tests for computeSnapshotSongs — Songs mode snapshot computation.
 * This function produces one RankedEntry per release with cumulative values,
 * source filtering, co-artist resolution, and contiguous ranking.
 *
 * Requirements: 1.3, 7.3, 7.5
 */

import { describe, it, expect } from 'vitest';
import { computeSnapshotSongs } from '../../src/chart-engine.ts';
import type { DataStore, ParsedArtist, ParsedRelease, ChartSnapshot } from '../../src/models.ts';
import type { FilterState, DailyValueEntry } from '../../src/types.ts';

// --- Test Helpers ---

function makeDailyValue(value: number, source: string = 'inkigayo', episode: number = 1): DailyValueEntry {
  return { value, source, episode };
}

function makeRelease(id: string, title: string, dailyValues: Map<string, DailyValueEntry>, artistIds?: string[]): ParsedRelease {
  return {
    id,
    title,
    dailyValues,
    embeds: new Map(),
    artistIds: artistIds ?? [],
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

function makeDataStore(artists: ParsedArtist[], dates: string[]): DataStore {
  const artistsMap = new Map<string, ParsedArtist>();
  for (const artist of artists) {
    artistsMap.set(artist.id, artist);
  }
  return {
    artists: artistsMap,
    dates: [...dates].sort(),
    startDate: dates.length > 0 ? [...dates].sort()[0] : '',
    endDate: dates.length > 0 ? [...dates].sort()[dates.length - 1] : '',
    firstAppearance: new Map(),
    chartWins: new Map(),
  };
}

function makeFilterState(overrides: Partial<FilterState> = {}): FilterState {
  return {
    displayMode: 'songs',
    generation: 'all',
    source: 'all',
    zoom: 10,
    view: 'race',
    metric: 'points',
    ...overrides,
  };
}

// --- Test Data ---

// Artist A: 2 releases with known daily values
const artistA = makeArtist({
  id: 'aespa',
  name: 'aespa',
  artistType: 'girl_group',
  generation: 4,
  logoUrl: 'assets/logos/aespa.svg',
  releases: [
    makeRelease('supernova', 'Supernova', new Map([
      ['2024-01-01', makeDailyValue(100, 'inkigayo')],
      ['2024-01-02', makeDailyValue(80, 'music_bank')],
      ['2024-01-03', makeDailyValue(60, 'inkigayo')],
    ]), ['aespa']),
    makeRelease('whip', 'Whip', new Map([
      ['2024-01-02', makeDailyValue(50, 'inkigayo')],
      ['2024-01-03', makeDailyValue(40, 'music_bank')],
    ]), ['aespa']),
  ],
});

// Artist B: 1 release
const artistB = makeArtist({
  id: 'ive',
  name: 'IVE',
  artistType: 'girl_group',
  generation: 4,
  logoUrl: 'assets/logos/ive.svg',
  releases: [
    makeRelease('heya', 'HEYA', new Map([
      ['2024-01-01', makeDailyValue(120, 'music_bank')],
      ['2024-01-02', makeDailyValue(90, 'inkigayo')],
    ]), ['ive']),
  ],
});

// Artist C: 1 release, multi-artist (co-artist with artistA)
const artistC = makeArtist({
  id: 'bts',
  name: 'BTS',
  artistType: 'boy_group',
  generation: 3,
  logoUrl: 'assets/logos/bts.svg',
  releases: [
    makeRelease('collab-song', 'Collab Song', new Map([
      ['2024-01-01', makeDailyValue(200, 'inkigayo')],
      ['2024-01-03', makeDailyValue(150, 'm_countdown')],
    ]), ['bts', 'aespa']),
  ],
});

const dates = ['2024-01-01', '2024-01-02', '2024-01-03'];

// ============================================================
// Produces one entry per release with correct cumulativeValue
// Requirement 1.3
// ============================================================

describe('computeSnapshotSongs — cumulative values', () => {
  it('produces one entry per release across all artists', () => {
    const dataStore = makeDataStore([artistA, artistB], dates);
    const filterState = makeFilterState({ source: 'all' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    // artistA has 2 releases, artistB has 1 release = 3 entries total
    expect(snapshot.entries).toHaveLength(3);
  });

  it('computes correct cumulative value for each release up to the given date', () => {
    const dataStore = makeDataStore([artistA, artistB], dates);
    const filterState = makeFilterState({ source: 'all' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    // Supernova: 100 + 80 + 60 = 240
    const supernova = snapshot.entries.find(e => e.releaseKey === 'aespa::supernova');
    expect(supernova).toBeDefined();
    expect(supernova!.cumulativeValue).toBe(240);

    // Whip: 50 + 40 = 90
    const whip = snapshot.entries.find(e => e.releaseKey === 'aespa::whip');
    expect(whip).toBeDefined();
    expect(whip!.cumulativeValue).toBe(90);

    // HEYA: 120 + 90 = 210
    const heya = snapshot.entries.find(e => e.releaseKey === 'ive::heya');
    expect(heya).toBeDefined();
    expect(heya!.cumulativeValue).toBe(210);
  });

  it('computes cumulative value only up to the given date (not beyond)', () => {
    const dataStore = makeDataStore([artistA], dates);
    const filterState = makeFilterState({ source: 'all' });

    // Only up to 2024-01-02: Supernova = 100 + 80 = 180
    const snapshot = computeSnapshotSongs('2024-01-02', dataStore, filterState);

    const supernova = snapshot.entries.find(e => e.releaseKey === 'aespa::supernova');
    expect(supernova!.cumulativeValue).toBe(180);

    // Whip only has data on 2024-01-02: 50
    const whip = snapshot.entries.find(e => e.releaseKey === 'aespa::whip');
    expect(whip!.cumulativeValue).toBe(50);
  });
});

// ============================================================
// Each entry has releaseKey in format `${artistId}::${releaseId}`
// ============================================================

describe('computeSnapshotSongs — releaseKey format', () => {
  it('produces releaseKey in the format artistId::releaseId', () => {
    const dataStore = makeDataStore([artistA, artistB], dates);
    const filterState = makeFilterState({ source: 'all' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    const keys = snapshot.entries.map(e => e.releaseKey);
    expect(keys).toContain('aespa::supernova');
    expect(keys).toContain('aespa::whip');
    expect(keys).toContain('ive::heya');
  });

  it('releaseKey uses the owner artist id (parent) not co-artist ids', () => {
    const dataStore = makeDataStore([artistC, artistA], dates);
    const filterState = makeFilterState({ source: 'all' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    // The collab song is owned by artistC (bts), so key is bts::collab-song
    const collab = snapshot.entries.find(e => e.releaseKey === 'bts::collab-song');
    expect(collab).toBeDefined();
  });
});

// ============================================================
// Multi-artist release shows coArtists array populated
// ============================================================

describe('computeSnapshotSongs — co-artists', () => {
  it('populates coArtists array for a multi-artist release', () => {
    const dataStore = makeDataStore([artistC, artistA], dates);
    const filterState = makeFilterState({ source: 'all' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    const collab = snapshot.entries.find(e => e.releaseKey === 'bts::collab-song');
    expect(collab).toBeDefined();
    expect(collab!.coArtists).toBeDefined();
    expect(collab!.coArtists).toHaveLength(2);
    expect(collab!.coArtists![0].id).toBe('bts');
    expect(collab!.coArtists![0].name).toBe('BTS');
    expect(collab!.coArtists![1].id).toBe('aespa');
    expect(collab!.coArtists![1].name).toBe('aespa');
  });

  it('populates coArtists for a single-artist release with one entry', () => {
    const dataStore = makeDataStore([artistB], dates);
    const filterState = makeFilterState({ source: 'all' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    const heya = snapshot.entries.find(e => e.releaseKey === 'ive::heya');
    expect(heya).toBeDefined();
    expect(heya!.coArtists).toBeDefined();
    expect(heya!.coArtists).toHaveLength(1);
    expect(heya!.coArtists![0].id).toBe('ive');
    expect(heya!.coArtists![0].name).toBe('IVE');
  });
});

// ============================================================
// Source filter limits which dailyValues are summed
// Requirement 7.3
// ============================================================

describe('computeSnapshotSongs — source filter limits values', () => {
  it('sums only daily values matching the selected source', () => {
    const dataStore = makeDataStore([artistA, artistB], dates);
    const filterState = makeFilterState({ source: 'inkigayo' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    // Supernova: inkigayo on 01-01 (100), music_bank on 01-02 (skip), inkigayo on 01-03 (60) = 160
    const supernova = snapshot.entries.find(e => e.releaseKey === 'aespa::supernova');
    expect(supernova!.cumulativeValue).toBe(160);

    // Whip: inkigayo on 01-02 (50), music_bank on 01-03 (skip) = 50
    const whip = snapshot.entries.find(e => e.releaseKey === 'aespa::whip');
    expect(whip!.cumulativeValue).toBe(50);

    // HEYA: music_bank on 01-01 (skip), inkigayo on 01-02 (90) = 90
    const heya = snapshot.entries.find(e => e.releaseKey === 'ive::heya');
    expect(heya!.cumulativeValue).toBe(90);
  });

  it('different source filter produces different totals', () => {
    const dataStore = makeDataStore([artistA, artistB], dates);
    const filterState = makeFilterState({ source: 'music_bank' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    // Supernova: music_bank on 01-02 (80) = 80
    const supernova = snapshot.entries.find(e => e.releaseKey === 'aespa::supernova');
    expect(supernova!.cumulativeValue).toBe(80);

    // Whip: music_bank on 01-03 (40) = 40
    const whip = snapshot.entries.find(e => e.releaseKey === 'aespa::whip');
    expect(whip!.cumulativeValue).toBe(40);

    // HEYA: music_bank on 01-01 (120) = 120
    const heya = snapshot.entries.find(e => e.releaseKey === 'ive::heya');
    expect(heya!.cumulativeValue).toBe(120);
  });
});

// ============================================================
// Source filter "all" sums everything
// ============================================================

describe('computeSnapshotSongs — source "all" sums everything', () => {
  it('source "all" sums daily values from all sources', () => {
    const dataStore = makeDataStore([artistA], dates);
    const filterState = makeFilterState({ source: 'all' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    // Supernova: 100 (inkigayo) + 80 (music_bank) + 60 (inkigayo) = 240
    const supernova = snapshot.entries.find(e => e.releaseKey === 'aespa::supernova');
    expect(supernova!.cumulativeValue).toBe(240);

    // Whip: 50 (inkigayo) + 40 (music_bank) = 90
    const whip = snapshot.entries.find(e => e.releaseKey === 'aespa::whip');
    expect(whip!.cumulativeValue).toBe(90);
  });
});

// ============================================================
// Entry with zero matching source values still appears with value 0
// Requirement 7.5
// ============================================================

describe('computeSnapshotSongs — zero-value entries still appear', () => {
  it('entry with zero matching values for a source still appears with cumulativeValue 0', () => {
    // Create an artist with a release that only has 'inkigayo' data
    const artistOnlyInkigayo = makeArtist({
      id: 'solo',
      name: 'Solo Artist',
      artistType: 'solo_female',
      generation: 5,
      logoUrl: 'assets/logos/solo.svg',
      releases: [
        makeRelease('only-inkigayo', 'Only Inkigayo Song', new Map([
          ['2024-01-01', makeDailyValue(100, 'inkigayo')],
          ['2024-01-02', makeDailyValue(50, 'inkigayo')],
        ]), ['solo']),
      ],
    });

    const dataStore = makeDataStore([artistOnlyInkigayo], dates);
    // Filter to a source with no matching data
    const filterState = makeFilterState({ source: 'music_bank' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    // The entry should still appear but with 0 cumulative value
    const entry = snapshot.entries.find(e => e.releaseKey === 'solo::only-inkigayo');
    expect(entry).toBeDefined();
    expect(entry!.cumulativeValue).toBe(0);
  });

  it('entries with no data on selected source coexist with entries that have data', () => {
    const dataStore = makeDataStore([artistA, artistB], dates);
    // Filter to m_countdown — none of the test data uses m_countdown
    const filterState = makeFilterState({ source: 'm_countdown' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    // All 3 releases should still appear
    expect(snapshot.entries).toHaveLength(3);

    // All should have cumulativeValue = 0
    for (const entry of snapshot.entries) {
      expect(entry.cumulativeValue).toBe(0);
    }
  });
});

// ============================================================
// Entries are ranked by descending cumulativeValue with contiguous ranks
// ============================================================

describe('computeSnapshotSongs — ranking', () => {
  it('ranks entries by descending cumulativeValue', () => {
    const dataStore = makeDataStore([artistA, artistB], dates);
    const filterState = makeFilterState({ source: 'all' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    // Expected order: Supernova (240) > HEYA (210) > Whip (90)
    expect(snapshot.entries[0].releaseKey).toBe('aespa::supernova');
    expect(snapshot.entries[0].cumulativeValue).toBe(240);
    expect(snapshot.entries[1].releaseKey).toBe('ive::heya');
    expect(snapshot.entries[1].cumulativeValue).toBe(210);
    expect(snapshot.entries[2].releaseKey).toBe('aespa::whip');
    expect(snapshot.entries[2].cumulativeValue).toBe(90);
  });

  it('assigns contiguous 1-based ranks', () => {
    const dataStore = makeDataStore([artistA, artistB], dates);
    const filterState = makeFilterState({ source: 'all' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    expect(snapshot.entries[0].rank).toBe(1);
    expect(snapshot.entries[1].rank).toBe(2);
    expect(snapshot.entries[2].rank).toBe(3);
  });

  it('ranks are contiguous even when some entries have zero value', () => {
    const dataStore = makeDataStore([artistA, artistB], dates);
    // Use m_countdown which has no data, so all are 0
    const filterState = makeFilterState({ source: 'm_countdown' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    // All entries should have contiguous ranks starting at 1
    const ranks = snapshot.entries.map(e => e.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3]);
  });

  it('snapshot date matches the requested date', () => {
    const dataStore = makeDataStore([artistA], dates);
    const filterState = makeFilterState({ source: 'all' });

    const snapshot = computeSnapshotSongs('2024-01-02', dataStore, filterState);

    expect(snapshot.date).toBe('2024-01-02');
  });
});

// ============================================================
// Mode field is set to "songs"
// ============================================================

describe('computeSnapshotSongs — mode field', () => {
  it('each entry has mode set to "songs"', () => {
    const dataStore = makeDataStore([artistA], dates);
    const filterState = makeFilterState({ source: 'all' });

    const snapshot = computeSnapshotSongs('2024-01-03', dataStore, filterState);

    for (const entry of snapshot.entries) {
      expect((entry as any).mode).toBe('songs');
    }
  });
});
