// Feature: ui-overhaul-songs-filters-toolbar, Property 5: Co-artist name formatting preserves order
// Feature: ui-overhaul-songs-filters-toolbar, Property 6: Artist resolution preserves order and completeness
// **Validates: Requirements 2.3, 5.1, 5.2, 5.3, 5.4**

import fc from 'fast-check';
import { resolveArtists, formatCoArtistLabel } from '../../src/co-artist-resolver.ts';
import type { ResolvedArtist } from '../../src/co-artist-resolver.ts';
import type { ArtistType } from '../../src/types.ts';
import type { ParsedArtist, DataStore } from '../../src/models.ts';

// --- Shared Arbitraries ---

const ARTIST_TYPES: ArtistType[] = [
  'boy_group',
  'girl_group',
  'solo_male',
  'solo_female',
  'mixed_group',
];

/** Generate a valid artist ID string */
const arbArtistId: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9_]{2,15}$/)
  .filter((s) => s.length >= 3);

/** Generate a ParsedArtist with the given ID */
function arbParsedArtistWithId(id: string): fc.Arbitrary<ParsedArtist> {
  return fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.constantFrom(...ARTIST_TYPES),
      fc.integer({ min: 1, max: 5 }),
    )
    .map(([name, artistType, generation]) => ({
      id,
      name,
      artistType,
      generation,
      logoUrl: `assets/logos/${id}.svg`,
      releases: [],
      albumReleases: [],
    }));
}

/** Generate a small DataStore with 1–10 artists */
const arbDataStore: fc.Arbitrary<{ dataStore: DataStore; artistIds: string[] }> = fc
  .uniqueArray(arbArtistId, { minLength: 1, maxLength: 10 })
  .chain((ids) =>
    fc
      .tuple(...ids.map((id) => arbParsedArtistWithId(id)))
      .map((artists) => {
        const artistMap = new Map<string, ParsedArtist>();
        for (const artist of artists) {
          artistMap.set(artist.id, artist);
        }
        const dataStore: DataStore = {
          artists: artistMap,
          dates: ['2024-01-01'],
          startDate: '2024-01-01',
          endDate: '2024-01-01',
          firstAppearance: new Map(),
          chartWins: new Map(),
        };
        return { dataStore, artistIds: ids };
      }),
  );

/** Generate a parent ParsedArtist (used as fallback for missing IDs) */
const arbParentArtist: fc.Arbitrary<ParsedArtist> = fc
  .tuple(
    arbArtistId,
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.constantFrom(...ARTIST_TYPES),
    fc.integer({ min: 1, max: 5 }),
  )
  .map(([id, name, artistType, generation]) => ({
    id,
    name,
    artistType,
    generation,
    logoUrl: `assets/logos/${id}.svg`,
    releases: [],
    albumReleases: [],
  }));

/**
 * Generate an array of 1–20 artist IDs, mixing valid (present in DataStore)
 * and invalid (not present) IDs to exercise fallback behavior.
 */
function arbArtistIdArray(validIds: string[]): fc.Arbitrary<string[]> {
  const arbValidId = validIds.length > 0
    ? fc.constantFrom(...validIds)
    : fc.constant('missing-id');
  const arbInvalidId = fc
    .stringMatching(/^[a-z][a-z0-9_]{2,15}$/)
    .filter((s) => s.length >= 3 && !validIds.includes(s));

  return fc.array(
    fc.oneof(
      { weight: 3, arbitrary: arbValidId },
      { weight: 1, arbitrary: arbInvalidId },
    ),
    { minLength: 1, maxLength: 20 },
  );
}

// ============================================================
// Property 6: Artist resolution preserves order and completeness
// **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
// ============================================================

describe('Property 6: Artist resolution preserves order and completeness', () => {
  it('resolveArtists returns same-length array with correct order', () => {
    fc.assert(
      fc.property(
        arbDataStore.chain(({ dataStore, artistIds: validIds }) =>
          fc.tuple(
            fc.constant(dataStore),
            arbArtistIdArray(validIds),
            arbParentArtist,
          ),
        ),
        ([dataStore, inputIds, parentArtist]) => {
          const result = resolveArtists(inputIds, dataStore, parentArtist);

          // Property: Result array has same length as input
          expect(result.length).toBe(inputIds.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('each result[i] corresponds to artistIds[i] preserving order', () => {
    fc.assert(
      fc.property(
        arbDataStore.chain(({ dataStore, artistIds: validIds }) =>
          fc.tuple(
            fc.constant(dataStore),
            arbArtistIdArray(validIds),
            arbParentArtist,
          ),
        ),
        ([dataStore, inputIds, parentArtist]) => {
          const result = resolveArtists(inputIds, dataStore, parentArtist);

          // Property: Each resolved artist at index i has the correct id
          for (let i = 0; i < inputIds.length; i++) {
            const id = inputIds[i];
            const storedArtist = dataStore.artists.get(id);

            if (storedArtist) {
              // For IDs present in DataStore, resolved id matches the input id
              expect(result[i].id).toBe(id);
            } else {
              // For IDs NOT in DataStore, resolved data comes from parent artist
              expect(result[i].id).toBe(parentArtist.id);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for IDs present in DataStore, resolved data matches stored artist', () => {
    fc.assert(
      fc.property(
        arbDataStore.chain(({ dataStore, artistIds: validIds }) =>
          fc.tuple(
            fc.constant(dataStore),
            arbArtistIdArray(validIds),
            arbParentArtist,
          ),
        ),
        ([dataStore, inputIds, parentArtist]) => {
          const result = resolveArtists(inputIds, dataStore, parentArtist);

          for (let i = 0; i < inputIds.length; i++) {
            const id = inputIds[i];
            const storedArtist = dataStore.artists.get(id);

            if (storedArtist) {
              expect(result[i].name).toBe(storedArtist.name);
              expect(result[i].logoUrl).toBe(storedArtist.logoUrl);
              expect(result[i].generation).toBe(storedArtist.generation);
              expect(result[i].artistType).toBe(storedArtist.artistType);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for IDs NOT in DataStore, resolved data matches parent artist (fallback)', () => {
    fc.assert(
      fc.property(
        arbDataStore.chain(({ dataStore, artistIds: validIds }) =>
          fc.tuple(
            fc.constant(dataStore),
            arbArtistIdArray(validIds),
            arbParentArtist,
          ),
        ),
        ([dataStore, inputIds, parentArtist]) => {
          const result = resolveArtists(inputIds, dataStore, parentArtist);

          for (let i = 0; i < inputIds.length; i++) {
            const id = inputIds[i];
            const storedArtist = dataStore.artists.get(id);

            if (!storedArtist) {
              expect(result[i].name).toBe(parentArtist.name);
              expect(result[i].logoUrl).toBe(parentArtist.logoUrl);
              expect(result[i].generation).toBe(parentArtist.generation);
              expect(result[i].artistType).toBe(parentArtist.artistType);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('every resolved artist has all required fields populated', () => {
    fc.assert(
      fc.property(
        arbDataStore.chain(({ dataStore, artistIds: validIds }) =>
          fc.tuple(
            fc.constant(dataStore),
            arbArtistIdArray(validIds),
            arbParentArtist,
          ),
        ),
        ([dataStore, inputIds, parentArtist]) => {
          const result = resolveArtists(inputIds, dataStore, parentArtist);

          for (const resolved of result) {
            // All required fields must be populated (non-empty strings, valid types)
            expect(resolved.id).toBeDefined();
            expect(typeof resolved.id).toBe('string');
            expect(resolved.id.length).toBeGreaterThan(0);

            expect(resolved.name).toBeDefined();
            expect(typeof resolved.name).toBe('string');
            expect(resolved.name.length).toBeGreaterThan(0);

            expect(resolved.logoUrl).toBeDefined();
            expect(typeof resolved.logoUrl).toBe('string');
            expect(resolved.logoUrl.length).toBeGreaterThan(0);

            expect(resolved.generation).toBeDefined();
            expect(typeof resolved.generation).toBe('number');
            expect(resolved.generation).toBeGreaterThanOrEqual(1);

            expect(resolved.artistType).toBeDefined();
            expect(ARTIST_TYPES).toContain(resolved.artistType);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 5: Co-artist name formatting preserves order
// **Validates: Requirements 2.3**
// ============================================================

/** Artist-type shape symbols that must NOT appear in labels (removed). */
const TYPE_SHAPES = ['▲', '●', '◆', '★', '■'];

/** Generate an array of 1–20 ResolvedArtist entries */
const arbResolvedArtistArray: fc.Arbitrary<ResolvedArtist[]> = fc
  .array(
    fc
      .tuple(
        arbArtistId,
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes('•') && !s.includes(' • ')),
        fc.constantFrom(...ARTIST_TYPES),
        fc.integer({ min: 1, max: 5 }),
      )
      .map(([id, name, artistType, generation]) => ({
        id,
        name,
        logoUrl: `assets/logos/${id}.svg`,
        artistType,
        generation,
      })),
    { minLength: 1, maxLength: 20 },
  );

describe('Property 5: Co-artist name formatting preserves order', () => {
  it('result contains all names in the original array order', () => {
    fc.assert(
      fc.property(arbResolvedArtistArray, (artists) => {
        const result = formatCoArtistLabel(artists);

        // Each name should appear in the result
        for (const artist of artists) {
          expect(result).toContain(artist.name);
        }

        // Names appear in the original order
        let lastIndex = -1;
        for (const artist of artists) {
          const currentIndex = result.indexOf(artist.name, lastIndex + 1);
          expect(currentIndex).toBeGreaterThan(lastIndex);
          lastIndex = currentIndex;
        }
      }),
      { numRuns: 100 },
    );
  });

  it('never contains an artist-type shape symbol', () => {
    fc.assert(
      fc.property(arbResolvedArtistArray, (artists) => {
        const result = formatCoArtistLabel(artists);
        for (const shape of TYPE_SHAPES) {
          expect(result).not.toContain(shape);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('names are separated by " • "', () => {
    fc.assert(
      fc.property(
        arbResolvedArtistArray.filter((arr) => arr.length >= 2),
        (artists) => {
          const result = formatCoArtistLabel(artists);

          // The result should contain " • " between consecutive artist entries
          const parts = result.split(' • ');
          expect(parts.length).toBe(artists.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for a single artist, there is no separator', () => {
    fc.assert(
      fc.property(
        arbResolvedArtistArray.filter((arr) => arr.length === 1),
        (artists) => {
          const result = formatCoArtistLabel(artists);

          expect(result).not.toContain(' • ');
          expect(result).toBe(artists[0].name);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('the number of " • " separators is exactly (array length - 1)', () => {
    fc.assert(
      fc.property(arbResolvedArtistArray, (artists) => {
        const result = formatCoArtistLabel(artists);

        const separatorCount = (result.match(/ • /g) || []).length;
        expect(separatorCount).toBe(artists.length - 1);
      }),
      { numRuns: 100 },
    );
  });
});
