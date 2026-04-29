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
            type: 'mv',
            url: 'https://www.youtube.com/watch?v=abc123',
          },
        ],
      ],
      [
        '2024-05-14',
        [
          {
            type: 'live_performance',
            url: 'https://www.youtube.com/watch?v=def456',
          },
          {
            type: 'promotion',
            url: 'https://www.instagram.com/p/example2/',
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

  // 6. Timeline entries use single-column layout (no left/right alternation) — Req 2.1, 2.2
  it('renders timeline entries without left/right alternation', () => {
    panel.open('test-artist', dataStore);
    const entries = document.body.querySelectorAll('.timeline-entry');
    expect(entries.length).toBeGreaterThan(1);

    entries.forEach((entry) => {
      expect(entry.classList.contains('timeline-entry--left')).toBe(false);
      expect(entry.classList.contains('timeline-entry--right')).toBe(false);
    });
  });

  // 7. Timeline shows date headings inside cards — Req 7.5
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
    // Episode numbers are now in separate .timeline-entry__episode elements
    const episodeEls = document.body.querySelectorAll('.timeline-entry__episode');
    expect(episodeEls.length).toBeGreaterThan(0);

    const allEpisodeText = Array.from(episodeEls).map((el) => el.textContent).join(' ');
    expect(allEpisodeText).toContain('Ep 1254');
    expect(allEpisodeText).toContain('Ep 480');
  });

  // 9. Timeline entries show performance values with pts suffix — Req 7.5
  it('shows performance values with pts suffix in timeline entries', () => {
    panel.open('test-artist', dataStore);
    const valueEls = document.body.querySelectorAll('.timeline-entry__value');
    expect(valueEls.length).toBeGreaterThan(0);

    const values = Array.from(valueEls).map((el) => el.textContent);
    expect(values).toContain('850 pts');
    expect(values).toContain('920 pts');
    expect(values).toContain('780 pts');
  });

  // 10. Crown icons displayed for chart wins — Req 7.11
  it('displays SVG-based crown icons for chart wins', () => {
    panel.open('test-artist', dataStore);
    const crownEls = document.body.querySelectorAll('.timeline-entry__crown');
    expect(crownEls.length).toBe(2); // wins on 2024-05-13 and 2024-05-14

    // Reverse chronological: 2024-05-14 (crown level 3) comes first
    const crown3 = crownEls[0];
    const crown3Img = crown3.querySelector('.crown__icon img') as HTMLImageElement;
    expect(crown3Img).not.toBeNull();
    expect(crown3Img!.src).toContain('crown-3.svg');
    const crown3Label = crown3.querySelector('.crown__label');
    expect(crown3Label).not.toBeNull();
    expect(crown3Label!.textContent).toBe('Triple Crown');
    expect(crown3.getAttribute('title')).toBe('Triple Crown');

    // 2024-05-13 (crown level 1) comes second
    const crown1 = crownEls[1];
    const crown1Img = crown1.querySelector('.crown__icon img') as HTMLImageElement;
    expect(crown1Img).not.toBeNull();
    expect(crown1Img!.src).toContain('crown-1.svg');
    const crown1Label = crown1.querySelector('.crown__label');
    expect(crown1Label).not.toBeNull();
    expect(crown1Label!.textContent).toBe('Win');
  });

  // 11. Embed placeholders created for lazy loading — Req 12.8
  it('creates embed placeholders for lazy loading', () => {
    panel.open('test-artist', dataStore);
    const placeholders = document.body.querySelectorAll('.detail-panel__embed-placeholder');
    // We have embeds on 2024-05-13 (1 entry) and 2024-05-14 (2 entries)
    expect(placeholders.length).toBe(3);

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
    expect(metaEl!.textContent).toContain('Gen');
  });
});


// ============================================================
// Same-date card merging — buildDateGroups
// ============================================================

describe('DetailPanel — same-date card merging', () => {
  let eventBus: EventBus;
  let panel: DetailPanel;

  beforeEach(() => {
    eventBus = new EventBus();
    panel = new DetailPanel(eventBus);
  });

  afterEach(() => {
    panel.destroy();
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  it('two chart performances on same date merge into one card (primary = highest value)', () => {
    const release1: ParsedRelease = {
      id: 'song-a',
      title: 'Song A',
      dailyValues: new Map([
        ['2024-05-13', { value: 500, source: 'inkigayo', episode: 100 }],
      ]),
      embeds: new Map(),
    };
    const release2: ParsedRelease = {
      id: 'song-b',
      title: 'Song B',
      dailyValues: new Map([
        ['2024-05-13', { value: 800, source: 'music_bank', episode: 200 }],
      ]),
      embeds: new Map(),
    };

    const artist: ParsedArtist = {
      id: 'merge-artist',
      name: 'Merge Artist',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/merge.svg',
      releases: [release1, release2],
    };

    const store: DataStore = {
      artists: new Map([['merge-artist', artist]]),
      dates: ['2024-05-13'],
      startDate: '2024-05-13',
      endDate: '2024-05-13',
      chartWins: new Map(),
    };

    panel.open('merge-artist', store);

    // Should be one date group with one card
    const dateGroups = document.body.querySelectorAll('.timeline-date-group');
    expect(dateGroups.length).toBe(1);

    // The primary release should be Song B (higher value: 800)
    const releaseEls = dateGroups[0].querySelectorAll('.timeline-entry__release');
    expect(releaseEls[0].textContent).toBe('♪ Song B');

    // Song A should appear as a sub-release
    const subReleases = dateGroups[0].querySelectorAll('.timeline-entry__sub-release');
    expect(subReleases.length).toBe(1);
    expect(subReleases[0].textContent).toContain('Song A');
    expect(subReleases[0].textContent).toContain('500');
  });

  it('embed-only item on same date as chart performance merges into same card', () => {
    const chartRelease: ParsedRelease = {
      id: 'chart-song',
      title: 'Chart Song',
      dailyValues: new Map([
        ['2024-05-13', { value: 700, source: 'inkigayo', episode: 100 }],
      ]),
      embeds: new Map(),
    };
    const embedRelease: ParsedRelease = {
      id: 'embed-song',
      title: 'Embed Song',
      dailyValues: new Map(),
      embeds: new Map([
        ['2024-05-13', [
          { type: 'mv', url: 'https://www.youtube.com/watch?v=test1' },
        ]],
      ]),
    };

    const artist: ParsedArtist = {
      id: 'embed-merge-artist',
      name: 'Embed Merge Artist',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/embed-merge.svg',
      releases: [chartRelease, embedRelease],
    };

    const store: DataStore = {
      artists: new Map([['embed-merge-artist', artist]]),
      dates: ['2024-05-13'],
      startDate: '2024-05-13',
      endDate: '2024-05-13',
      chartWins: new Map(),
    };

    panel.open('embed-merge-artist', store);

    // Should be one date group — embed-only merged into chart card
    const dateGroups = document.body.querySelectorAll('.timeline-date-group');
    expect(dateGroups.length).toBe(1);

    // The primary release is the chart song
    const entries = dateGroups[0].querySelectorAll('.timeline-entry');
    expect(entries.length).toBe(1);

    // The embed from the other release should appear under a song heading
    const releaseHeadings = entries[0].querySelectorAll('.timeline-entry__release');
    // First heading is the primary chart song, second is the merged embed song heading
    expect(releaseHeadings.length).toBe(2);
    expect(releaseHeadings[0].textContent).toBe('♪ Chart Song');
    expect(releaseHeadings[1].textContent).toBe('♪ Embed Song');
  });

  it('merged embeds from different release show under song heading', () => {
    const primaryRelease: ParsedRelease = {
      id: 'primary-song',
      title: 'Primary Song',
      dailyValues: new Map([
        ['2024-05-13', { value: 900, source: 'inkigayo', episode: 100 }],
      ]),
      embeds: new Map(),
    };
    const otherRelease: ParsedRelease = {
      id: 'other-song',
      title: 'Other Song',
      dailyValues: new Map(),
      embeds: new Map([
        ['2024-05-13', [
          { type: 'live_performance', url: 'https://www.youtube.com/watch?v=lp1' },
        ]],
      ]),
    };

    const artist: ParsedArtist = {
      id: 'heading-artist',
      name: 'Heading Artist',
      artistType: 'boy_group',
      generation: 4,
      logoUrl: 'assets/logos/heading.svg',
      releases: [primaryRelease, otherRelease],
    };

    const store: DataStore = {
      artists: new Map([['heading-artist', artist]]),
      dates: ['2024-05-13'],
      startDate: '2024-05-13',
      endDate: '2024-05-13',
      chartWins: new Map(),
    };

    panel.open('heading-artist', store);

    const entry = document.body.querySelector('.timeline-entry')!;
    const releaseHeadings = entry.querySelectorAll('.timeline-entry__release');
    // Second heading should be the other song
    expect(releaseHeadings.length).toBeGreaterThanOrEqual(2);
    expect(releaseHeadings[1].textContent).toBe('♪ Other Song');

    // The embed group should follow the song heading
    const embedGroups = entry.querySelectorAll('.timeline-entry__embed-group');
    expect(embedGroups.length).toBeGreaterThanOrEqual(1);
  });

  it('sub-releases include source info when source differs from primary', () => {
    const release1: ParsedRelease = {
      id: 'primary-rel',
      title: 'Primary Hit',
      dailyValues: new Map([
        ['2024-05-13', { value: 900, source: 'inkigayo', episode: 100 }],
      ]),
      embeds: new Map(),
    };
    const release2: ParsedRelease = {
      id: 'secondary-rel',
      title: 'Secondary Hit',
      dailyValues: new Map([
        ['2024-05-13', { value: 400, source: 'music_bank', episode: 200 }],
      ]),
      embeds: new Map(),
    };

    const artist: ParsedArtist = {
      id: 'source-diff-artist',
      name: 'Source Diff Artist',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/source-diff.svg',
      releases: [release1, release2],
    };

    const store: DataStore = {
      artists: new Map([['source-diff-artist', artist]]),
      dates: ['2024-05-13'],
      startDate: '2024-05-13',
      endDate: '2024-05-13',
      chartWins: new Map(),
    };

    panel.open('source-diff-artist', store);

    const subReleases = document.body.querySelectorAll('.timeline-entry__sub-release');
    expect(subReleases.length).toBe(1);
    // Sub-release should include source info since music_bank ≠ inkigayo
    expect(subReleases[0].textContent).toContain('music_bank');
    expect(subReleases[0].textContent).toContain('Ep 200');
  });
});

// ============================================================
// Crown label simplification — getCrownLabel (tested via rendered output)
// ============================================================

describe('DetailPanel — crown label simplification', () => {
  let eventBus: EventBus;
  let panel: DetailPanel;

  beforeEach(() => {
    eventBus = new EventBus();
    panel = new DetailPanel(eventBus);
  });

  afterEach(() => {
    panel.destroy();
    document.querySelectorAll('.detail-panel').forEach((el) => el.remove());
  });

  function createStoreWithCrownLevel(level: number): DataStore {
    const release: ParsedRelease = {
      id: 'crown-song',
      title: 'Crown Song',
      dailyValues: new Map([
        ['2024-05-13', { value: 850, source: 'inkigayo', episode: 100 }],
      ]),
      embeds: new Map(),
    };

    const artist: ParsedArtist = {
      id: 'crown-artist',
      name: 'Crown Artist',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/crown.svg',
      releases: [release],
    };

    const chartWins: DataStore['chartWins'] = new Map([
      ['2024-05-13', new Map([
        ['inkigayo', {
          artistIds: ['crown-artist'],
          crownLevels: new Map([['crown-artist', level]]),
        }],
      ])],
    ]);

    return {
      artists: new Map([['crown-artist', artist]]),
      dates: ['2024-05-13'],
      startDate: '2024-05-13',
      endDate: '2024-05-13',
      chartWins,
    };
  }

  it('crown level 3 shows "Triple Crown"', () => {
    const store = createStoreWithCrownLevel(3);
    panel.open('crown-artist', store);

    const crownLabel = document.body.querySelector('.crown__label');
    expect(crownLabel).not.toBeNull();
    expect(crownLabel!.textContent).toBe('Triple Crown');
  });

  it('crown level 6 shows "2nd Triple Crown"', () => {
    const store = createStoreWithCrownLevel(6);
    panel.open('crown-artist', store);

    const crownLabel = document.body.querySelector('.crown__label');
    expect(crownLabel).not.toBeNull();
    expect(crownLabel!.textContent).toBe('2nd Triple Crown');
  });

  it('crown level 2 shows "2nd Win"', () => {
    const store = createStoreWithCrownLevel(2);
    panel.open('crown-artist', store);

    const crownLabel = document.body.querySelector('.crown__label');
    expect(crownLabel).not.toBeNull();
    expect(crownLabel!.textContent).toBe('2nd Win');
  });
});
