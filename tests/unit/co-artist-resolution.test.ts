/**
 * Unit tests for co-artist resolution logic.
 * Tests the resolveArtists function that maps artist IDs to full artist data.
 * Tests the formatCoArtistLabel function that formats artist names with type indicators.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 2.3
 */

import { resolveArtists, formatCoArtistLabel } from '../../src/co-artist-resolver.ts';
import type { ResolvedArtist } from '../../src/models.ts';
import type { DataStore, ParsedArtist } from '../../src/models.ts';
import type { ArtistType } from '../../src/types.ts';

// --- Test Helpers ---

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

const artistA = makeArtist({
  id: 'aespa',
  name: 'aespa',
  artistType: 'girl_group',
  generation: 4,
  logoUrl: 'assets/logos/aespa.svg',
});

const artistB = makeArtist({
  id: 'ive',
  name: 'IVE',
  artistType: 'girl_group',
  generation: 4,
  logoUrl: 'assets/logos/ive.svg',
});

const artistC = makeArtist({
  id: 'bts',
  name: 'BTS',
  artistType: 'boy_group',
  generation: 3,
  logoUrl: 'assets/logos/bts.svg',
});

const parentArtist = makeArtist({
  id: 'parent-artist',
  name: 'Parent Artist',
  artistType: 'solo_female',
  generation: 5,
  logoUrl: 'assets/logos/parent.svg',
});

const dataStore = makeDataStore([artistA, artistB, artistC, parentArtist]);

// ============================================================
// ParsedRelease with single artistId resolves to parent artist data
// ============================================================

describe('resolveArtists — single artist resolution', () => {
  it('resolves a single artistId to the correct artist data', () => {
    const result = resolveArtists(['aespa'], dataStore, parentArtist);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('aespa');
    expect(result[0].name).toBe('aespa');
    expect(result[0].logoUrl).toBe('assets/logos/aespa.svg');
    expect(result[0].artistType).toBe('girl_group');
    expect(result[0].generation).toBe(4);
  });

  it('resolves a single parentArtistId when artistIds contains only parent', () => {
    const result = resolveArtists(['parent-artist'], dataStore, parentArtist);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('parent-artist');
    expect(result[0].name).toBe('Parent Artist');
    expect(result[0].logoUrl).toBe('assets/logos/parent.svg');
    expect(result[0].artistType).toBe('solo_female');
    expect(result[0].generation).toBe(5);
  });
});

// ============================================================
// ParsedRelease with multiple artistIds resolves each in order
// ============================================================

describe('resolveArtists — multiple artists resolution', () => {
  it('resolves multiple artistIds in the correct order', () => {
    const result = resolveArtists(['aespa', 'ive', 'bts'], dataStore, parentArtist);

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('aespa');
    expect(result[1].id).toBe('ive');
    expect(result[2].id).toBe('bts');
  });

  it('preserves array order even when IDs are in different order than DataStore insertion', () => {
    const result = resolveArtists(['bts', 'aespa'], dataStore, parentArtist);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('bts');
    expect(result[0].name).toBe('BTS');
    expect(result[1].id).toBe('aespa');
    expect(result[1].name).toBe('aespa');
  });
});

// ============================================================
// Missing artistId falls back to parent artist data
// Requirement 5.3: use the release's parent artist data as fallback
// ============================================================

describe('resolveArtists — missing ID fallback', () => {
  it('falls back to parent artist data when artistId is not in DataStore', () => {
    const result = resolveArtists(['unknown-artist'], dataStore, parentArtist);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(parentArtist.id);
    expect(result[0].name).toBe(parentArtist.name);
    expect(result[0].logoUrl).toBe(parentArtist.logoUrl);
    expect(result[0].artistType).toBe(parentArtist.artistType);
    expect(result[0].generation).toBe(parentArtist.generation);
  });

  it('resolves known IDs normally and falls back for missing ones', () => {
    const result = resolveArtists(['aespa', 'missing-id', 'bts'], dataStore, parentArtist);

    expect(result).toHaveLength(3);

    // First resolved from DataStore
    expect(result[0].id).toBe('aespa');
    expect(result[0].name).toBe('aespa');

    // Second falls back to parent artist data entirely
    expect(result[1].id).toBe(parentArtist.id);
    expect(result[1].name).toBe(parentArtist.name);
    expect(result[1].logoUrl).toBe(parentArtist.logoUrl);

    // Third resolved from DataStore
    expect(result[2].id).toBe('bts');
    expect(result[2].name).toBe('BTS');
  });

  it('falls back for all IDs when none exist in DataStore', () => {
    const result = resolveArtists(['x', 'y', 'z'], dataStore, parentArtist);

    expect(result).toHaveLength(3);
    for (const resolved of result) {
      expect(resolved.id).toBe(parentArtist.id);
      expect(resolved.name).toBe(parentArtist.name);
      expect(resolved.logoUrl).toBe(parentArtist.logoUrl);
      expect(resolved.artistType).toBe(parentArtist.artistType);
      expect(resolved.generation).toBe(parentArtist.generation);
    }
  });
});

// ============================================================
// Empty artistIds array defaults to [parentArtistId]
// ============================================================

describe('resolveArtists — empty array defaults to parent', () => {
  it('returns parent artist data when artistIds is empty', () => {
    const result = resolveArtists([], dataStore, parentArtist);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(parentArtist.id);
    expect(result[0].name).toBe(parentArtist.name);
    expect(result[0].logoUrl).toBe(parentArtist.logoUrl);
    expect(result[0].artistType).toBe(parentArtist.artistType);
    expect(result[0].generation).toBe(parentArtist.generation);
  });
});

// ============================================================
// Resolution preserves name, logoUrl, generation, artistType
// ============================================================

describe('resolveArtists — field completeness', () => {
  it('each resolved artist has all required fields populated', () => {
    const result = resolveArtists(['aespa', 'ive', 'bts'], dataStore, parentArtist);

    for (const resolved of result) {
      expect(resolved).toHaveProperty('id');
      expect(resolved).toHaveProperty('name');
      expect(resolved).toHaveProperty('logoUrl');
      expect(resolved).toHaveProperty('artistType');
      expect(resolved).toHaveProperty('generation');

      expect(typeof resolved.id).toBe('string');
      expect(typeof resolved.name).toBe('string');
      expect(typeof resolved.logoUrl).toBe('string');
      expect(typeof resolved.artistType).toBe('string');
      expect(typeof resolved.generation).toBe('number');
    }
  });

  it('preserves correct field values for each specific artist', () => {
    const result = resolveArtists(['aespa', 'bts'], dataStore, parentArtist);

    // aespa
    expect(result[0].name).toBe('aespa');
    expect(result[0].logoUrl).toBe('assets/logos/aespa.svg');
    expect(result[0].artistType).toBe('girl_group');
    expect(result[0].generation).toBe(4);

    // BTS
    expect(result[1].name).toBe('BTS');
    expect(result[1].logoUrl).toBe('assets/logos/bts.svg');
    expect(result[1].artistType).toBe('boy_group');
    expect(result[1].generation).toBe(3);
  });

  it('fallback entries use parent artist data including parent ID', () => {
    const result = resolveArtists(['nonexistent'], dataStore, parentArtist);

    expect(result[0].id).toBe(parentArtist.id);
    expect(result[0].name).toBe(parentArtist.name);
    expect(result[0].logoUrl).toBe(parentArtist.logoUrl);
    expect(result[0].artistType).toBe(parentArtist.artistType);
    expect(result[0].generation).toBe(parentArtist.generation);
  });
});

// ============================================================
// formatCoArtistLabel — co-artist name formatting
// Requirement 2.3: artist names joined by bullet separator with type indicators
// ============================================================

describe('formatCoArtistLabel — co-artist name formatting', () => {
  function makeResolvedArtist(overrides: Partial<ResolvedArtist> = {}): ResolvedArtist {
    return {
      id: 'test-artist',
      name: 'TestArtist',
      logoUrl: 'assets/logos/test.svg',
      artistType: 'boy_group',
      generation: 4,
      ...overrides,
    };
  }

  it('formats a single boy_group artist as "Name ▲"', () => {
    const artists: ResolvedArtist[] = [
      makeResolvedArtist({ name: 'BTS', artistType: 'boy_group' }),
    ];

    const result = formatCoArtistLabel(artists);

    expect(result).toBe('BTS ▲');
  });

  it('formats a single girl_group artist as "Name ●"', () => {
    const artists: ResolvedArtist[] = [
      makeResolvedArtist({ name: 'aespa', artistType: 'girl_group' }),
    ];

    const result = formatCoArtistLabel(artists);

    expect(result).toBe('aespa ●');
  });

  it('formats a single solo_male artist as "Name ◆"', () => {
    const artists: ResolvedArtist[] = [
      makeResolvedArtist({ name: 'Baekhyun', artistType: 'solo_male' }),
    ];

    const result = formatCoArtistLabel(artists);

    expect(result).toBe('Baekhyun ◆');
  });

  it('formats a single solo_female artist as "Name ★"', () => {
    const artists: ResolvedArtist[] = [
      makeResolvedArtist({ name: 'IU', artistType: 'solo_female' }),
    ];

    const result = formatCoArtistLabel(artists);

    expect(result).toBe('IU ★');
  });

  it('formats a single mixed_group artist as "Name ■"', () => {
    const artists: ResolvedArtist[] = [
      makeResolvedArtist({ name: 'KARD', artistType: 'mixed_group' }),
    ];

    const result = formatCoArtistLabel(artists);

    expect(result).toBe('KARD ■');
  });

  it('formats two artists with bullet separator preserving order', () => {
    const artists: ResolvedArtist[] = [
      makeResolvedArtist({ name: 'BTS', artistType: 'boy_group' }),
      makeResolvedArtist({ name: 'aespa', artistType: 'girl_group' }),
    ];

    const result = formatCoArtistLabel(artists);

    expect(result).toBe('BTS ▲ • aespa ●');
  });

  it('formats three artists with bullet separators preserving order', () => {
    const artists: ResolvedArtist[] = [
      makeResolvedArtist({ name: 'IU', artistType: 'solo_female' }),
      makeResolvedArtist({ name: 'BTS', artistType: 'boy_group' }),
      makeResolvedArtist({ name: 'KARD', artistType: 'mixed_group' }),
    ];

    const result = formatCoArtistLabel(artists);

    expect(result).toBe('IU ★ • BTS ▲ • KARD ■');
  });

  it('formats four artists preserving all type indicators and order', () => {
    const artists: ResolvedArtist[] = [
      makeResolvedArtist({ name: 'Baekhyun', artistType: 'solo_male' }),
      makeResolvedArtist({ name: 'IU', artistType: 'solo_female' }),
      makeResolvedArtist({ name: 'BTS', artistType: 'boy_group' }),
      makeResolvedArtist({ name: 'aespa', artistType: 'girl_group' }),
    ];

    const result = formatCoArtistLabel(artists);

    expect(result).toBe('Baekhyun ◆ • IU ★ • BTS ▲ • aespa ●');
  });

  it('preserves original array order regardless of artist type', () => {
    const artists: ResolvedArtist[] = [
      makeResolvedArtist({ name: 'Second', artistType: 'girl_group' }),
      makeResolvedArtist({ name: 'First', artistType: 'boy_group' }),
    ];

    const result = formatCoArtistLabel(artists);

    // Order comes from the array, not alphabetical or type-based
    expect(result).toBe('Second ● • First ▲');
  });
});
