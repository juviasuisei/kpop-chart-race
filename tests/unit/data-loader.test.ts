import { validateArtistEntry, slugify, serialize, deserialize } from '../../src/data-loader.ts';
import type { ArtistEntry } from '../../src/types.ts';

/** A minimal valid ArtistEntry for reuse across tests */
function validEntry(overrides: Partial<ArtistEntry> = {}): ArtistEntry {
  return {
    name: 'Stellar Nova',
    artistType: 'girl_group',
    generation: 4,
    logo: 'assets/logos/stellar-nova.svg',
    releases: [
      {
        title: 'Supernova',
        dailyValues: {
          '2024-05-13': { value: 850, source: 'inkigayo', episode: 1254 },
        },
        embeds: {},
      },
    ],
    ...overrides,
  };
}

describe('slugify', () => {
  it('converts spaces to hyphens and lowercases', () => {
    expect(slugify('Stellar Nova')).toBe('stellar-nova');
  });

  it('trims leading and trailing non-alphanumeric characters', () => {
    expect(slugify('  Hello World!  ')).toBe('hello-world');
  });

  it('collapses multiple non-alphanumeric characters into a single hyphen', () => {
    expect(slugify('Jay---Storm')).toBe('jay-storm');
  });

  it('handles already-lowercase single words', () => {
    expect(slugify('aespa')).toBe('aespa');
  });
});

describe('validateArtistEntry', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true for a valid entry', () => {
    expect(validateArtistEntry(validEntry(), 'stellar-nova.json')).toBe(true);
  });

  it('returns false for missing name', () => {
    const entry = validEntry({ name: '' });
    expect(validateArtistEntry(entry, 'bad.json')).toBe(false);
  });

  it('returns false for invalid artistType', () => {
    const entry = validEntry({ artistType: 'duo' as any });
    expect(validateArtistEntry(entry, 'bad.json')).toBe(false);
  });

  it('returns false for generation = 0', () => {
    const entry = validEntry({ generation: 0 });
    expect(validateArtistEntry(entry, 'bad.json')).toBe(false);
  });

  it('returns false for generation = -1', () => {
    const entry = validEntry({ generation: -1 });
    expect(validateArtistEntry(entry, 'bad.json')).toBe(false);
  });

  it('returns false for non-integer generation (e.g., 2.5)', () => {
    const entry = validEntry({ generation: 2.5 });
    expect(validateArtistEntry(entry, 'bad.json')).toBe(false);
  });

  it('returns false for empty releases array', () => {
    const entry = validEntry({ releases: [] });
    expect(validateArtistEntry(entry, 'bad.json')).toBe(false);
  });

  it('returns false for releases with no daily values', () => {
    const entry = validEntry({
      releases: [{ title: 'Empty', dailyValues: {}, embeds: {} }],
    });
    expect(validateArtistEntry(entry, 'bad.json')).toBe(false);
  });

  it('logs warning for unknown ChartSource but returns true', () => {
    const entry = validEntry({
      releases: [
        {
          title: 'Test Song',
          dailyValues: {
            '2024-06-01': { value: 500, source: 'unknown_show', episode: 1 },
          },
          embeds: {},
        },
      ],
    });

    const result = validateArtistEntry(entry, 'test.json');

    expect(result).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unknown ChartSource "unknown_show"'),
    );
  });
});

describe('serialize', () => {
  it('produces pretty-printed JSON', () => {
    const entry = validEntry();
    const json = serialize(entry);

    // Pretty-printed JSON has newlines and indentation
    expect(json).toContain('\n');
    expect(json).toContain('  ');
    // Parses back correctly
    expect(JSON.parse(json)).toEqual(entry);
  });
});

describe('deserialize', () => {
  it('parses JSON back to ArtistEntry', () => {
    const entry = validEntry();
    const json = JSON.stringify(entry);
    const result = deserialize(json);

    expect(result).toEqual(entry);
  });
});
