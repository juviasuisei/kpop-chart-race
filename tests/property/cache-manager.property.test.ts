// Feature: 0015-airtable-data-layer, Property 9: Cache TTL expiry
// **Validates: Requirements 9.2, 9.7**

import fc from 'fast-check';
import { CacheManager } from '../../src/airtable/cache-manager.ts';
import type { DataStore } from '../../src/models.ts';

// ============================================================
// Property 9: Cache TTL expiry
//
// For any timestamp T and current time NOW, a cache entry written
// at T SHALL be considered expired if and only if
// NOW - T > 3_600_000 (1 hour in milliseconds).
// ============================================================

/** Create a minimal valid DataStore for cache testing */
function createMinimalDataStore(): DataStore {
  const release = {
    id: 'test-release',
    title: 'Test Release',
    dailyValues: new Map([
      ['2024-01-01', { value: 100, source: 'inkigayo' as const, episode: 1 }],
    ]),
    embeds: new Map(),
  };

  const artist = {
    id: 'test-artist',
    name: 'Test Artist',
    artistType: 'boy_group' as const,
    generation: 4,
    logoUrl: 'assets/logos/test-artist.svg',
    koreanName: undefined,
    debut: undefined,
    releases: [release],
  };

  return {
    artists: new Map([['test-artist', artist]]),
    dates: ['2024-01-01'],
    startDate: '2024-01-01',
    endDate: '2024-01-01',
    firstAppearance: new Map([['test-artist', '2024-01-01']]),
    chartWins: new Map(),
  };
}

/** Mock sessionStorage for jsdom environment */
function createMockSessionStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

describe('Property 9: Cache TTL expiry', () => {
  const TTL_MS = 3_600_000; // 1 hour

  beforeEach(() => {
    vi.useFakeTimers();
    // Replace sessionStorage with a mock
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: createMockSessionStorage(),
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cache entry is valid (non-null) when offset <= TTL, expired (null) when offset > TTL', () => {
    fc.assert(
      fc.property(
        // Generate a base timestamp in a reasonable range
        fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
        // Generate time offset from 0 to 2x TTL to test both sides of the boundary
        fc.integer({ min: 0, max: TTL_MS * 2 }),
        (baseTimestamp, offset) => {
          // Reset sessionStorage before each iteration
          sessionStorage.clear();

          const cache = new CacheManager();
          const store = createMinimalDataStore();

          // Set the current time to the base timestamp and write cache
          vi.setSystemTime(baseTimestamp);
          cache.set(store);

          // Advance time by the offset
          vi.setSystemTime(baseTimestamp + offset);

          const result = cache.get();

          if (offset <= TTL_MS) {
            // Cache should still be valid
            expect(result).not.toBeNull();
          } else {
            // Cache should be expired
            expect(result).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
