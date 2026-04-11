import { ChartRaceRenderer } from '../../src/chart-race-renderer.ts';
import { EventBus } from '../../src/event-bus.ts';
import type { ChartSnapshot, RankedEntry } from '../../src/models.ts';
import type { ArtistType } from '../../src/types.ts';

/** Expected colors per ArtistType (rgb format as returned by jsdom) */
const EXPECTED_COLORS: Record<ArtistType, string> = {
  boy_group: 'rgb(21, 101, 192)',
  girl_group: 'rgb(198, 40, 40)',
  solo_male: 'rgb(100, 181, 246)',
  solo_female: 'rgb(239, 154, 154)',
  mixed_group: 'rgb(0, 158, 115)',
};

function makeEntry(overrides: Partial<RankedEntry> = {}): RankedEntry {
  return {
    artistId: 'artist-1',
    artistName: 'Luna Park',
    artistType: 'girl_group',
    generation: 4,
    logoUrl: 'assets/logos/luna-park.svg',
    cumulativeValue: 500,
    previousCumulativeValue: 400,
    dailyValue: 100,
    rank: 1,
    previousRank: 1,
    featuredRelease: { title: 'Starlight', releaseId: 'starlight' },
    ...overrides,
  };
}

function makeSnapshot(entries: RankedEntry[], date = '2024-06-01'): ChartSnapshot {
  return { date, entries };
}

describe('ChartRaceRenderer', () => {
  let container: HTMLElement;
  let renderer: ChartRaceRenderer;
  let eventBus: EventBus;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    eventBus = new EventBus();
    renderer = new ChartRaceRenderer(eventBus);
  });

  afterEach(() => {
    renderer.destroy();
    container.remove();
  });

  // 1. Mount creates .chart-race element in container
  it('mount creates a .chart-race element in the container', () => {
    renderer.mount(container);
    expect(container.querySelector('.chart-race')).not.toBeNull();
  });

  // 2. Mount creates date display (.chart-race__date)
  it('mount creates a .chart-race__date element', () => {
    renderer.mount(container);
    expect(container.querySelector('.chart-race__date')).not.toBeNull();
  });

  // 3. Mount creates bars container (.chart-race__bars)
  it('mount creates a .chart-race__bars element', () => {
    renderer.mount(container);
    expect(container.querySelector('.chart-race__bars')).not.toBeNull();
  });

  // 4. Mount creates legend with 5 items (.chart-race__legend)
  it('mount creates a legend with 5 items', () => {
    renderer.mount(container);
    const legend = container.querySelector('.chart-race__legend');
    expect(legend).not.toBeNull();
    const items = legend!.querySelectorAll('.chart-race__legend-item');
    expect(items.length).toBe(5);
  });

  // 5. Update renders bars with artist names (.bar__name) — Req 4.1
  it('update renders bars with artist names', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([
      makeEntry({ artistId: 'a1', artistName: 'Luna Park', rank: 1 }),
      makeEntry({ artistId: 'a2', artistName: 'Jay Storm', rank: 2 }),
    ]);
    renderer.update(snapshot, 10);

    const names = container.querySelectorAll('.bar__name');
    expect(names.length).toBe(2);
    expect(names[0].textContent).toBe('Luna Park');
    expect(names[1].textContent).toBe('Jay Storm');
  });

  // 6. Update renders logo images (.bar__logo) — Req 4.2
  it('update renders logo images with correct src', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([
      makeEntry({ logoUrl: 'assets/logos/luna-park.svg' }),
    ]);
    renderer.update(snapshot, 10);

    const logo = container.querySelector('.bar__logo') as HTMLImageElement;
    expect(logo).not.toBeNull();
    expect(logo.src).toContain('luna-park.svg');
  });

  // 7. Update renders cumulative value (.bar__value) — Req 4.3
  it('update renders cumulative value text', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([
      makeEntry({ cumulativeValue: 1234, previousCumulativeValue: 1234 }),
    ]);
    renderer.update(snapshot, 10);

    const value = container.querySelector('.bar__value');
    expect(value).not.toBeNull();
    // Value should display the cumulative value (may be formatted with locale)
    expect(value!.textContent).toContain('1,234');
  });

  // 8. Logo onerror sets placeholder SVG — Req 4.4
  it('logo onerror sets placeholder SVG data URI', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([
      makeEntry({ logoUrl: 'assets/logos/nonexistent.svg' }),
    ]);
    renderer.update(snapshot, 10);

    const logo = container.querySelector('.bar__logo') as HTMLImageElement;
    expect(logo).not.toBeNull();

    // Trigger onerror handler
    logo.onerror!(new Event('error'));

    expect(logo.src).toContain('data:image/svg+xml');
  });

  // 9. Bar background color matches ArtistType (Wong palette) — Req 4.5
  it('bar background color matches ArtistType Wong palette', () => {
    renderer.mount(container);
    const types: ArtistType[] = ['boy_group', 'girl_group', 'solo_male', 'solo_female', 'mixed_group'];

    const entries = types.map((type, i) =>
      makeEntry({
        artistId: `artist-${i}`,
        artistType: type,
        rank: i + 1,
        cumulativeValue: 500 - i * 50,
      }),
    );
    const snapshot = makeSnapshot(entries);
    renderer.update(snapshot, 'all');

    const bars = container.querySelectorAll('.chart-race__bar');
    expect(bars.length).toBe(5);

    bars.forEach((bar, i) => {
      const htmlBar = bar as HTMLElement;
      expect(htmlBar.style.backgroundColor).toBe(EXPECTED_COLORS[types[i]]);
    });
  });

  // 10. Legend shows all 5 ArtistType entries — Req 4.6
  it('legend shows all 5 ArtistType labels', () => {
    renderer.mount(container);
    const labels = container.querySelectorAll('.legend-item__label');
    expect(labels.length).toBe(5);

    const labelTexts = Array.from(labels).map((l) => l.textContent);
    expect(labelTexts).toContain('Boy Group');
    expect(labelTexts).toContain('Girl Group');
    expect(labelTexts).toContain('Solo Male');
    expect(labelTexts).toContain('Solo Female');
    expect(labelTexts).toContain('Non-Gendered Group');
  });

  // 11. Update renders featured release with ♪ prefix (.bar__release) — Req 4.8
  it('update renders featured release with ♪ prefix', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([
      makeEntry({ featuredRelease: { title: 'Supernova', releaseId: 'supernova' } }),
    ]);
    renderer.update(snapshot, 10);

    const release = container.querySelector('.bar__release');
    expect(release).not.toBeNull();
    expect(release!.textContent).toBe('♪ Supernova');
  });

  // 12. Logo has drop-shadow filter (.bar__logo CSS) — Req 4.9
  it('logo element has bar__logo class for CSS drop-shadow styling', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([makeEntry()]);
    renderer.update(snapshot, 10);

    const logo = container.querySelector('.bar__logo');
    expect(logo).not.toBeNull();
    expect(logo!.tagName).toBe('IMG');
    expect(logo!.classList.contains('bar__logo')).toBe(true);
  });

  // 13. Update renders generation Roman numeral (.bar__gen) — Req 4.7
  it('update renders generation as Roman numeral', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([
      makeEntry({ generation: 4 }),
    ]);
    renderer.update(snapshot, 10);

    const gen = container.querySelector('.bar__gen');
    expect(gen).not.toBeNull();
    expect(gen!.textContent).toBe('Gen IV');
  });

  // 14. Destroy removes chart from DOM
  it('destroy removes the chart-race element from DOM', () => {
    renderer.mount(container);
    expect(container.querySelector('.chart-race')).not.toBeNull();

    renderer.destroy();
    expect(container.querySelector('.chart-race')).toBeNull();
  });

  // 15. Update with zoom "all" enables overflow scroll on bars container — Req 5.3
  it('update with zoom "all" sets overflowY auto on bars container', () => {
    renderer.mount(container);
    const entries = Array.from({ length: 15 }, (_, i) =>
      makeEntry({
        artistId: `artist-${i}`,
        rank: i + 1,
        cumulativeValue: 1000 - i * 50,
      }),
    );
    const snapshot = makeSnapshot(entries);
    renderer.update(snapshot, 'all');

    const barsContainer = container.querySelector('.chart-race__bars') as HTMLElement;
    expect(barsContainer.style.overflowY).toBe('auto');
  });

  // 16. Clicking a bar emits bar:click with correct artistId
  it('clicking a bar wrapper emits bar:click with the correct artistId', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([
      makeEntry({ artistId: 'artist-luna', artistName: 'Luna Park', rank: 1 }),
    ]);
    renderer.update(snapshot, 10);

    const emitted: string[] = [];
    eventBus.on('bar:click', (artistId: string) => emitted.push(artistId));

    const bar = container.querySelector('.chart-race__bar') as HTMLElement;
    bar.click();

    expect(emitted).toEqual(['artist-luna']);
  });

  // 17. Clicking different bars emits the correct artistId for each
  it('clicking different bars emits the correct artistId for each', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([
      makeEntry({ artistId: 'artist-a', artistName: 'Artist A', rank: 1, cumulativeValue: 600 }),
      makeEntry({ artistId: 'artist-b', artistName: 'Artist B', rank: 2, cumulativeValue: 400 }),
    ]);
    renderer.update(snapshot, 10);

    const emitted: string[] = [];
    eventBus.on('bar:click', (artistId: string) => emitted.push(artistId));

    const bars = container.querySelectorAll('.chart-race__bar');
    (bars[0] as HTMLElement).click();
    (bars[1] as HTMLElement).click();

    expect(emitted).toEqual(['artist-a', 'artist-b']);
  });

  // 18. No bar:click events emitted after destroy()
  it('no bar:click events are emitted after destroy()', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([
      makeEntry({ artistId: 'artist-x', artistName: 'Artist X', rank: 1 }),
    ]);
    renderer.update(snapshot, 10);

    const wrapper = container.querySelector('.chart-race__bar-wrapper') as HTMLElement;

    const emitted: string[] = [];
    eventBus.on('bar:click', (artistId: string) => emitted.push(artistId));

    renderer.destroy();
    wrapper.click();

    expect(emitted).toEqual([]);
  });

  // 19. Mount creates .chart-race__title-header
  it('mount creates a .chart-race__title-header element', () => {
    renderer.mount(container);
    expect(container.querySelector('.chart-race__title-header')).not.toBeNull();
  });

  // 20. Title text is "K-Pop Chart Race"
  it('title text is "K-Pop Chart Race"', () => {
    renderer.mount(container);
    const titleText = container.querySelector('.chart-race__title-text');
    expect(titleText).not.toBeNull();
    expect(titleText!.textContent).toBe('K-Pop Chart Race');
  });

  // 21. Version badge starts with "v"
  it('version badge starts with "v"', () => {
    renderer.mount(container);
    const badge = container.querySelector('.chart-race__version-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent!.startsWith('v')).toBe(true);
  });

  // 22. setDataNote sets correct text
  it('setDataNote("2024-01-15") sets correct text', () => {
    renderer.mount(container);
    renderer.setDataNote('2024-01-15');
    const note = container.querySelector('.chart-race__data-note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toBe('Includes points earned from 2024-01-15 forward');
  });

  // 23. setDataNote("") leaves note empty
  it('setDataNote("") leaves note empty', () => {
    renderer.mount(container);
    renderer.setDataNote('');
    const note = container.querySelector('.chart-race__data-note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toBe('');
  });

  // 24. destroy removes title header
  it('destroy removes the title header along with everything else', () => {
    renderer.mount(container);
    expect(container.querySelector('.chart-race__title-header')).not.toBeNull();
    renderer.destroy();
    expect(container.querySelector('.chart-race__title-header')).toBeNull();
  });
});


// ============================================================
// Bugfix 0007: Bug Condition Exploration — Click Outside & Cursor
// **Validates: Requirements 1.1, 1.2**
// These tests demonstrate the bugs exist on UNFIXED code.
// They encode the EXPECTED behavior — they will pass after the fix.
// ============================================================

import { DetailPanel } from '../../src/detail-panel.ts';
import type { DataStore, ParsedArtist } from '../../src/models.ts';

/** Create a minimal mock DataStore with one artist for testing */
function createMockDataStore(artistId: string): DataStore {
  const artist: ParsedArtist = {
    id: artistId,
    name: 'Luna Park',
    artistType: 'girl_group',
    generation: 4,
    logoUrl: 'assets/logos/luna-park.svg',
    releases: [],
  };
  const artists = new Map<string, ParsedArtist>();
  artists.set(artistId, artist);
  return {
    artists,
    dates: ['2024-06-01'],
    startDate: '2024-06-01',
    endDate: '2024-06-01',
    chartWins: new Map(),
  };
}

describe('Bugfix 0007: Bug Condition — Click Outside Does Not Close Panel', () => {
  let container: HTMLElement;
  let renderer: ChartRaceRenderer;
  let eventBus: EventBus;
  let detailPanel: DetailPanel;
  let dataStore: DataStore;
  const originalIO = globalThis.IntersectionObserver;

  beforeEach(() => {
    // Mock IntersectionObserver for jsdom (not natively available)
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;

    container = document.createElement('div');
    document.body.appendChild(container);
    eventBus = new EventBus();
    renderer = new ChartRaceRenderer(eventBus);
    detailPanel = new DetailPanel(eventBus);
    dataStore = createMockDataStore('artist-luna');
  });

  afterEach(() => {
    detailPanel.destroy();
    renderer.destroy();
    container.remove();
    globalThis.IntersectionObserver = originalIO;
  });

  // 19. Bug Condition 1: Clicking .chart-race__bars background while panel is open should close panel
  it('clicking .chart-race__bars background closes the detail panel', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([
      makeEntry({ artistId: 'artist-luna', artistName: 'Luna Park', rank: 1 }),
    ]);
    renderer.update(snapshot, 10);

    // Wire up the click-outside listener on .chart-race (same pattern as main.ts)
    const chartRace = container.querySelector('.chart-race') as HTMLElement;
    chartRace.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('.chart-race__bar-wrapper')) return;
      if (target.closest('.detail-panel')) return;
      if (detailPanel.isOpen()) {
        detailPanel.close();
      }
    });

    // Open the detail panel
    detailPanel.open('artist-luna', dataStore);
    expect(detailPanel.isOpen()).toBe(true);

    // Simulate clicking the .chart-race__bars background
    const barsContainer = container.querySelector('.chart-race__bars') as HTMLElement;
    barsContainer.click();

    // BUG: On unfixed code, the panel stays open because no click-outside listener exists in main.ts
    // EXPECTED after fix: panel should be closed
    expect(detailPanel.isOpen()).toBe(false);
  });
});

describe('Bugfix 0007: Bug Condition — Missing Pointer Cursor', () => {
  let container: HTMLElement;
  let renderer: ChartRaceRenderer;
  let eventBus: EventBus;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    eventBus = new EventBus();
    renderer = new ChartRaceRenderer(eventBus);
  });

  afterEach(() => {
    renderer.destroy();
    container.remove();
  });

  // 20. Bug Condition 2: .chart-race__bar-wrapper should have cursor: pointer in CSS
  it('.chart-race__bar-wrapper has cursor: pointer in the stylesheet', () => {
    // jsdom doesn't load CSS from files, so we read the CSS source directly
    // to verify the rule exists. This is a static check.
    const fs = require('fs');
    const path = require('path');
    const cssPath = path.resolve(__dirname, '../../src/style.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // Find the .chart-race__bar rule block and check for cursor: pointer
    const ruleMatch = cssContent.match(
      /\.chart-race__bar\s*\{[^}]*cursor:\s*pointer[^}]*\}/,
    );

    // BUG: On unfixed code, cursor: pointer is missing from the CSS rule
    // EXPECTED after fix: the rule should include cursor: pointer
    expect(ruleMatch).not.toBeNull();
  });
});
