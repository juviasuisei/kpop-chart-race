import { DetailPanel } from '../../src/detail-panel.ts';
import { EventBus } from '../../src/event-bus.ts';
import type { DataStore, ParsedArtist, ParsedRelease } from '../../src/models.ts';

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

/**
 * Build a test DataStore with one artist that has releases with daily values,
 * embeds, and chart wins (including crown levels).
 */
function createTestDataStore(): DataStore {
  const release1: ParsedRelease = {
    id: 'supernova',
    title: 'Supernova',
    dailyValues: new Map([
      ['2024-05-13', { value: 850, source: 'inkigayo', episode: 1254 }],
      ['2024-05-14', { value: 920, source: 'music_bank', episode: 480 }],
      ['2024-05-15', { value: 780, source: 'show_champion', episode: 512 }],
    ]),
    embeds: new Map([
      [
        '2024-05-13',
        [
          {
            eventType: 'mv',
            links: [
              { url: 'https://www.youtube.com/watch?v=abc123', description: 'Official MV' },
            ],
          },
        ],
      ],
      [
        '2024-05-14',
        [
          {
            eventType: 'live_performance',
            links: [
              { url: 'https://www.youtube.com/watch?v=def456', description: 'Comeback stage' },
              { url: 'https://www.instagram.com/p/example1/' },
            ],
          },
          {
            eventType: 'promotion',
            links: [
              { url: 'https://www.instagram.com/p/example2/', description: 'Behind the scenes' },
            ],
          },
        ],
      ],
    ]),
  };

  const artist: ParsedArtist = {
    id: 'test-artist',
    name: 'Test Artist',
    artistType: 'girl_group',
    generation: 4,
    logoUrl: 'assets/logos/test.svg',
    koreanName: '테스트 아티스트',
    debut: '2020-03-15',
    releases: [release1],
  };

  // Chart wins: artist wins on 2024-05-13 inkigayo (crown level 1),
  // and on 2024-05-14 music_bank with crown level 3 (Triple Crown)
  const chartWins: DataStore['chartWins'] = new Map([
    [
      '2024-05-13',
      new Map([
        [
          'inkigayo',
          {
            artistIds: ['test-artist'],
            crownLevels: new Map([['test-artist', 1]]),
          },
        ],
      ]),
    ],
    [
      '2024-05-14',
      new Map([
        [
          'music_bank',
          {
            artistIds: ['test-artist'],
            crownLevels: new Map([['test-artist', 3]]),
          },
        ],
      ]),
    ],
  ]);

  return {
    artists: new Map([['test-artist', artist]]),
    dates: ['2024-05-13', '2024-05-14', '2024-05-15'],
    startDate: '2024-05-13',
    endDate: '2024-05-15',
    chartWins,
  };
}

describe('DetailPanel', () => {
  let eventBus: EventBus;
  let panel: DetailPanel;
  let dataStore: DataStore;

  beforeEach(() => {
    eventBus = new EventBus();
    panel = new DetailPanel(eventBus);
    dataStore = createTestDataStore();
  });

  afterEach(() => {
    panel.destroy();
    // Clean up any leftover panel elements
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  // 1. Open creates .detail-panel element in document.body — Req 7.1
  it('creates a .detail-panel element in document.body on open', () => {
    panel.open('test-artist', dataStore);
    const el = document.body.querySelector('.detail-panel');
    expect(el).not.toBeNull();
    expect(document.body.contains(el)).toBe(true);
  });

  // 2. Open shows artist name in header — Req 7.1
  it('shows artist name with Korean name in the panel header', () => {
    panel.open('test-artist', dataStore);
    const nameEl = document.body.querySelector('.detail-panel__artist-name');
    expect(nameEl).not.toBeNull();
    expect(nameEl!.textContent).toBe('Test Artist (테스트 아티스트)');
  });

  // 3. Close removes panel from DOM — Req 7.8
  it('removes panel from DOM on close', () => {
    panel.open('test-artist', dataStore);
    expect(document.body.querySelector('.detail-panel')).not.toBeNull();
    panel.close();
    expect(document.body.querySelector('.detail-panel')).toBeNull();
  });

  // 4. Close emits panel:close event — Req 7.8
  it('emits panel:close event on close', () => {
    const closeSpy = vi.fn();
    eventBus.on('panel:close', closeSpy);

    panel.open('test-artist', dataStore);
    panel.close();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  // 5. isOpen returns correct state
  it('returns correct isOpen state', () => {
    expect(panel.isOpen()).toBe(false);
    panel.open('test-artist', dataStore);
    expect(panel.isOpen()).toBe(true);
    panel.close();
    expect(panel.isOpen()).toBe(false);
  });

  // 6. Timeline entries alternate left/right — Req 7.4
  it('alternates timeline entries left and right', () => {
    panel.open('test-artist', dataStore);
    const entries = document.body.querySelectorAll('.timeline-entry');
    expect(entries.length).toBeGreaterThan(1);

    entries.forEach((entry, index) => {
      const side = index % 2 === 0 ? 'left' : 'right';
      expect(entry.classList.contains(`timeline-entry--${side}`)).toBe(true);
    });
  });

  // 7. Timeline entries show date headings — Req 7.5
  it('shows date headings in timeline entries', () => {
    panel.open('test-artist', dataStore);
    const dateEls = document.body.querySelectorAll('.timeline-entry__date');
    expect(dateEls.length).toBeGreaterThan(0);

    const dateTexts = Array.from(dateEls).map((el) => el.textContent);
    expect(dateTexts).toContain('2024-05-13');
    expect(dateTexts).toContain('2024-05-14');
    expect(dateTexts).toContain('2024-05-15');
  });

  // 8. Timeline entries show chart source info — Req 7.5
  it('shows chart source info with episode number', () => {
    panel.open('test-artist', dataStore);
    const sourceEls = document.body.querySelectorAll('.timeline-entry__source');
    expect(sourceEls.length).toBeGreaterThan(0);

    // Check that at least one source element contains an episode reference
    const allSourceText = Array.from(sourceEls).map((el) => el.textContent).join(' ');
    expect(allSourceText).toContain('Ep 1254');
    expect(allSourceText).toContain('Ep 480');
  });

  // 9. Timeline entries show performance values — Req 7.5
  it('shows performance values in timeline entries', () => {
    panel.open('test-artist', dataStore);
    const valueEls = document.body.querySelectorAll('.timeline-entry__value');
    expect(valueEls.length).toBeGreaterThan(0);

    const values = Array.from(valueEls).map((el) => el.textContent);
    expect(values).toContain('850');
    expect(values).toContain('920');
    expect(values).toContain('780');
  });

  // 10. Crown icons displayed for chart wins — Req 7.11
  it('displays SVG-based crown icons for chart wins', () => {
    panel.open('test-artist', dataStore);
    const crownEls = document.body.querySelectorAll('.timeline-entry__crown');
    expect(crownEls.length).toBe(2); // wins on 2024-05-13 and 2024-05-14

    // Crown level 1 should have an img pointing to crown-1.svg and "Win" label
    const crown1 = crownEls[0];
    const crown1Img = crown1.querySelector('.crown__icon img') as HTMLImageElement;
    expect(crown1Img).not.toBeNull();
    expect(crown1Img!.src).toContain('crown-1.svg');
    const crown1Label = crown1.querySelector('.crown__label');
    expect(crown1Label).not.toBeNull();
    expect(crown1Label!.textContent).toBe('Win');

    // Crown level 3 should have an img pointing to crown-3.svg and "3x Win (Triple Crown)" label
    const crown3 = crownEls[1];
    const crown3Img = crown3.querySelector('.crown__icon img') as HTMLImageElement;
    expect(crown3Img).not.toBeNull();
    expect(crown3Img!.src).toContain('crown-3.svg');
    const crown3Label = crown3.querySelector('.crown__label');
    expect(crown3Label).not.toBeNull();
    expect(crown3Label!.textContent).toBe('3x Win (Triple Crown)');
    expect(crown3.getAttribute('title')).toBe('Triple Crown');
  });

  // 11. Embed placeholders created for lazy loading — Req 12.8
  it('creates embed placeholders for lazy loading', () => {
    panel.open('test-artist', dataStore);
    const placeholders = document.body.querySelectorAll('.detail-panel__embed-placeholder');
    // We have embeds on 2024-05-13 (1 link) and 2024-05-14 (3 links across 2 groups)
    expect(placeholders.length).toBe(4);

    // Verify data attributes are set for lazy loading
    const firstPlaceholder = placeholders[0] as HTMLElement;
    expect(firstPlaceholder.dataset.embedUrl).toBeDefined();
  });

  // 12. Close button has aria-label "Close detail panel" — Req 11.4
  it('close button has aria-label "Close detail panel"', () => {
    panel.open('test-artist', dataStore);
    const closeBtn = document.body.querySelector('.detail-panel__close-btn');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn!.getAttribute('aria-label')).toBe('Close detail panel');
  });

  // 13. Panel has role="dialog" and aria-modal="true" — Req 11.4
  it('panel has role="dialog" and aria-modal="true"', () => {
    panel.open('test-artist', dataStore);
    const panelEl = document.body.querySelector('.detail-panel');
    expect(panelEl).not.toBeNull();
    expect(panelEl!.getAttribute('role')).toBe('dialog');
    expect(panelEl!.getAttribute('aria-modal')).toBe('true');
  });

  // 14. Destroy cleans up panel
  it('destroy removes panel and cleans up', () => {
    panel.open('test-artist', dataStore);
    expect(document.body.querySelector('.detail-panel')).not.toBeNull();

    panel.destroy();
    expect(document.body.querySelector('.detail-panel')).toBeNull();
    expect(panel.isOpen()).toBe(false);
  });

  // 15. Timeline inner wrapper exists and contains entries — Bug 0003 fix
  it('creates timeline inner wrapper that contains all timeline entries', () => {
    panel.open('test-artist', dataStore);
    const inner = document.body.querySelector('.detail-panel__timeline-inner');
    expect(inner).not.toBeNull();

    // Inner wrapper should be a child of the timeline container
    const timeline = document.body.querySelector('.detail-panel__timeline');
    expect(timeline).not.toBeNull();
    expect(timeline!.contains(inner)).toBe(true);

    // All timeline entries should be inside the inner wrapper
    const entriesInInner = inner!.querySelectorAll('.timeline-entry');
    const entriesTotal = document.body.querySelectorAll('.timeline-entry');
    expect(entriesInInner.length).toBe(entriesTotal.length);
    expect(entriesInInner.length).toBeGreaterThan(0);
  });

  // 16. Header shows Korean name in parentheses when koreanName is defined — Req 2.1
  it('shows Korean name in parentheses when koreanName is defined', () => {
    panel.open('test-artist', dataStore);
    const nameEl = document.body.querySelector('.detail-panel__artist-name');
    expect(nameEl).not.toBeNull();
    expect(nameEl!.textContent).toContain('(테스트 아티스트)');
  });

  // 17. Header shows only English name when koreanName is undefined — Req 2.2
  it('shows only English name when koreanName is undefined', () => {
    const artist = dataStore.artists.get('test-artist')!;
    const noKorean: ParsedArtist = { ...artist, koreanName: undefined };
    const store: DataStore = {
      ...dataStore,
      artists: new Map([['test-artist', noKorean]]),
    };
    panel.open('test-artist', store);
    const nameEl = document.body.querySelector('.detail-panel__artist-name');
    expect(nameEl).not.toBeNull();
    expect(nameEl!.textContent).toBe('Test Artist');
    expect(nameEl!.textContent).not.toContain('(');
  });

  // 18. Meta shows debut when debut is defined — Req 4.1
  it('shows debut date in meta when debut is defined', () => {
    panel.open('test-artist', dataStore);
    const metaEl = document.body.querySelector('.detail-panel__artist-meta');
    expect(metaEl).not.toBeNull();
    expect(metaEl!.textContent).toContain('(debut: 2020-03-15)');
  });

  // 19. Meta shows only type and generation when debut is undefined — Req 4.2
  it('shows only type and generation when debut is undefined', () => {
    const artist = dataStore.artists.get('test-artist')!;
    const noDebut: ParsedArtist = { ...artist, debut: undefined };
    const store: DataStore = {
      ...dataStore,
      artists: new Map([['test-artist', noDebut]]),
    };
    panel.open('test-artist', store);
    const metaEl = document.body.querySelector('.detail-panel__artist-meta');
    expect(metaEl).not.toBeNull();
    expect(metaEl!.textContent).not.toContain('debut');
    expect(metaEl!.textContent).toContain('Girl Group');
  });
});
