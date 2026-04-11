// Feature: 0009-data-model-enhancements, Property 4: Conditional Korean name display
// **Validates: Requirements 2.1, 2.2**

import fc from 'fast-check';
import { DetailPanel } from '../../src/detail-panel.ts';
import { EventBus } from '../../src/event-bus.ts';
import type { DataStore, ParsedArtist, ParsedRelease } from '../../src/models.ts';
import type { ArtistType } from '../../src/types.ts';

// Polyfill IntersectionObserver for jsdom
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
  constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
}
globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

const ARTIST_TYPES: ArtistType[] = ['boy_group', 'girl_group', 'solo_male', 'solo_female', 'mixed_group'];

function buildDataStore(artist: ParsedArtist): DataStore {
  return {
    artists: new Map([[artist.id, artist]]),
    dates: ['2024-05-13'],
    startDate: '2024-05-13',
    endDate: '2024-05-13',
    chartWins: new Map(),
  };
}

function buildArtist(overrides: Partial<ParsedArtist> = {}): ParsedArtist {
  const release: ParsedRelease = {
    id: 'test-release',
    title: 'Test Song',
    dailyValues: new Map([['2024-05-13', { value: 100, source: 'inkigayo', episode: 1 }]]),
    embeds: new Map(),
  };
  return {
    id: 'test-artist',
    name: 'Test Artist',
    artistType: 'girl_group',
    generation: 4,
    logoUrl: 'assets/logos/test.png',
    releases: [release],
    ...overrides,
  };
}

/** Arbitrary for non-empty printable strings (safe for HTML text content checks) */
const arbNonEmptyName = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

/** Arbitrary for Korean name strings */
const arbKoreanName = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

describe('Property 4: Conditional Korean name display', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  it('shows Korean name in parentheses when koreanName is defined', () => {
    fc.assert(
      fc.property(arbNonEmptyName, arbKoreanName, (name, koreanName) => {
        const eventBus = new EventBus();
        const panel = new DetailPanel(eventBus);
        const artist = buildArtist({ name, koreanName });
        const store = buildDataStore(artist);

        panel.open('test-artist', store);
        const nameEl = document.body.querySelector('.detail-panel__artist-name');
        expect(nameEl).not.toBeNull();
        expect(nameEl!.textContent).toContain('(');
        expect(nameEl!.textContent).toContain(')');
        panel.destroy();
      }),
      { numRuns: 100 },
    );
  });

  it('does not show parentheses when koreanName is undefined', () => {
    const arbNameNoParens = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0 && !s.includes('(') && !s.includes(')'));
    fc.assert(
      fc.property(arbNameNoParens, (name) => {
        const eventBus = new EventBus();
        const panel = new DetailPanel(eventBus);
        const artist = buildArtist({ name, koreanName: undefined });
        const store = buildDataStore(artist);

        panel.open('test-artist', store);
        const nameEl = document.body.querySelector('.detail-panel__artist-name');
        expect(nameEl).not.toBeNull();
        expect(nameEl!.textContent).not.toContain('(');
        panel.destroy();
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: 0009-data-model-enhancements, Property 5: HTML escaping of user-provided strings
// **Validates: Requirements 2.3**

describe('Property 5: HTML escaping of user-provided strings', () => {
  afterEach(() => {
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  /** Arbitrary for strings containing HTML special characters */
  const arbHtmlDangerous = fc
    .stringMatching(/^[a-zA-Z<>&"']{1,20}$/)
    .filter((s) => /[<>&"']/.test(s) && s.length > 0);

  it('escapes HTML special characters in name and koreanName', () => {
    fc.assert(
      fc.property(arbHtmlDangerous, arbHtmlDangerous, (name, koreanName) => {
        const eventBus = new EventBus();
        const panel = new DetailPanel(eventBus);
        const artist = buildArtist({ name, koreanName });
        const store = buildDataStore(artist);

        panel.open('test-artist', store);
        const nameEl = document.body.querySelector('.detail-panel__artist-name');
        expect(nameEl).not.toBeNull();

        const html = nameEl!.innerHTML;
        // The raw HTML should not contain unescaped < or > within text content
        // (they should be &lt; and &gt;)
        // Check that the text content matches the original strings (browser decodes entities)
        expect(nameEl!.textContent).toContain(name);
        expect(nameEl!.textContent).toContain(koreanName);

        // Verify no raw HTML tags were injected
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        // If escaping works, there should be no child elements from injected HTML
        // The only expected structure is text nodes
        const h2Children = nameEl!.children;
        // No unexpected element children from injection
        for (let i = 0; i < h2Children.length; i++) {
          const tag = h2Children[i].tagName.toLowerCase();
          // Only expected tags are from our own rendering, not from user input
          expect(['script', 'img', 'iframe', 'object', 'embed']).not.toContain(tag);
        }

        panel.destroy();
      }),
      { numRuns: 100 },
    );
  });
});
