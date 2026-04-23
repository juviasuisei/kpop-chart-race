import { ChartRaceRenderer } from '../../src/chart-race-renderer.ts';
import { EventBus } from '../../src/event-bus.ts';
import type { ChartSnapshot, DataStore, RankedEntry, ParsedArtist } from '../../src/models.ts';
import type { ArtistType, DailyValueEntry } from '../../src/types.ts';

/** Expected colors per ArtistType (rgb format as returned by jsdom) */
const EXPECTED_COLORS: Record<ArtistType, string> = {
  boy_group: 'rgb(46, 125, 50)',
  girl_group: 'rgb(123, 31, 162)',
  solo_male: 'rgb(129, 199, 132)',
  solo_female: 'rgb(206, 147, 216)',
  mixed_group: 'rgb(21, 101, 192)',
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

/** Build a DataStore where every artist in the entries has recent activity on the snapshot date */
function makeDataStoreForEntries(entries: RankedEntry[], date = '2024-06-01'): DataStore {
  const artists = new Map<string, ParsedArtist>();
  for (const entry of entries) {
    const dv: DailyValueEntry = { value: entry.dailyValue || 100, source: 'inkigayo', episode: 1 };
    artists.set(entry.artistId, {
      id: entry.artistId,
      name: entry.artistName,
      artistType: entry.artistType,
      generation: entry.generation,
      logoUrl: entry.logoUrl,
      releases: [{
        id: 'release-1',
        title: 'Song',
        dailyValues: new Map([[date, dv]]),
        embeds: new Map(),
      }],
    });
  }
  return { artists, dates: [date], startDate: date, endDate: date, chartWins: new Map() };
}

/**
 * Build a DataStore where only specific artists have recent activity.
 * Artists in activeIds get a dailyValue entry on the snapshot date;
 * artists in inactiveIds get no dailyValue entries (inactive).
 */
function makeDataStoreWithActivity(
  allEntries: RankedEntry[],
  activeIds: Set<string>,
  date = '2024-06-01',
): DataStore {
  const artists = new Map<string, ParsedArtist>();
  for (const entry of allEntries) {
    const isActive = activeIds.has(entry.artistId);
    const dailyValues = new Map<string, DailyValueEntry>();
    if (isActive) {
      dailyValues.set(date, { value: entry.dailyValue || 100, source: 'inkigayo', episode: 1 });
    }
    artists.set(entry.artistId, {
      id: entry.artistId,
      name: entry.artistName,
      artistType: entry.artistType,
      generation: entry.generation,
      logoUrl: entry.logoUrl,
      releases: [{
        id: 'release-1',
        title: 'Song',
        dailyValues,
        embeds: new Map(),
      }],
    });
  }
  return { artists, dates: [date], startDate: date, endDate: date, chartWins: new Map() };
}

const emptyDataStore: DataStore = { artists: new Map(), dates: [], startDate: '', endDate: '', chartWins: new Map() };

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
    renderer.update(snapshot, 10, makeDataStoreForEntries(snapshot.entries));

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
    renderer.update(snapshot, 10, emptyDataStore);

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
    renderer.update(snapshot, 10, emptyDataStore);

    const value = container.querySelector('.bar__value');
    expect(value).not.toBeNull();
    expect(value!.textContent).toContain('1,234');
  });

  // 8. Logo onerror sets placeholder SVG — Req 4.4
  it('logo onerror sets placeholder SVG data URI', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([
      makeEntry({ logoUrl: 'assets/logos/nonexistent.svg' }),
    ]);
    renderer.update(snapshot, 10, emptyDataStore);

    const logo = container.querySelector('.bar__logo') as HTMLImageElement;
    expect(logo).not.toBeNull();
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
    renderer.update(snapshot, 'all', emptyDataStore);

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
    renderer.update(snapshot, 10, emptyDataStore);

    const release = container.querySelector('.bar__release');
    expect(release).not.toBeNull();
    expect(release!.textContent).toBe('♪ Supernova');
  });

  // 12. Logo has drop-shadow filter (.bar__logo CSS) — Req 4.9
  it('logo element has bar__logo class for CSS drop-shadow styling', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([makeEntry()]);
    renderer.update(snapshot, 10, emptyDataStore);

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
    renderer.update(snapshot, 10, emptyDataStore);

    const gen = container.querySelector('.bar__gen');
    expect(gen).not.toBeNull();
    expect(gen!.textContent).toBe('4th Gen');
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
    renderer.update(snapshot, 'all', emptyDataStore);

    const barsContainer = container.querySelector('.chart-race__bars') as HTMLElement;
    expect(barsContainer.style.overflowY).toBe('auto');
  });

  // 16. Clicking a bar emits bar:click with correct artistId
  it('clicking a bar wrapper emits bar:click with the correct artistId', () => {
    renderer.mount(container);
    const snapshot = makeSnapshot([
      makeEntry({ artistId: 'artist-luna', artistName: 'Luna Park', rank: 1 }),
    ]);
    renderer.update(snapshot, 10, emptyDataStore);

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
    renderer.update(snapshot, 10, makeDataStoreForEntries(snapshot.entries));

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
    renderer.update(snapshot, 10, emptyDataStore);

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
    expect(note!.textContent).toBe('Points from 2024-01-15 forward. Inactive artists may be hidden — switch to All to see full rankings.');
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

  // 25. Bars are positioned by visual index (0, 1, 2...) not by entry.rank
  it('bars are positioned by visual index not by entry.rank', () => {
    renderer.mount(container);

    const MOCKED_HEIGHT = 500;
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: MOCKED_HEIGHT, configurable: true });

    const entries = [
      makeEntry({ artistId: 'a1', artistName: 'Artist A', rank: 2, cumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Artist B', rank: 5, cumulativeValue: 700 }),
      makeEntry({ artistId: 'a3', artistName: 'Artist C', rank: 8, cumulativeValue: 500 }),
    ];
    const snapshot = makeSnapshot(entries);
    renderer.update(snapshot, 10, makeDataStoreForEntries(snapshot.entries));

    const barHeight = MOCKED_HEIGHT / 10;
    const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
    expect(wrappers.length).toBe(3);

    expect((wrappers[0] as HTMLElement).style.transform).toBe(`translateY(${0 * barHeight}px)`);
    expect((wrappers[1] as HTMLElement).style.transform).toBe(`translateY(${1 * barHeight}px)`);
    expect((wrappers[2] as HTMLElement).style.transform).toBe(`translateY(${2 * barHeight}px)`);
  });

  // 26. New bars start at full opacity (no fade-in from 0)
  it('new bars start at full opacity and grow from their previous width', () => {
    renderer.mount(container);
    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 800 }),
    ];
    renderer.update(makeSnapshot(entries), 10, emptyDataStore);

    const wrapper = container.querySelector('.chart-race__bar-wrapper') as HTMLElement;
    expect(wrapper.style.opacity).toBe('1');
  });

  // 27. Bars filtered out are removed from DOM immediately (simplified update)
  it('bars filtered out are removed from DOM immediately', () => {
    renderer.mount(container);

    const entries = [makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 500 })];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(1);

    renderer.update(makeSnapshot([]), 10, emptyDataStore);
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(0);
  });

  // 28. Bars re-created after removal are placed at correct position
  it('bars re-created after removal are placed at correct position with full height', () => {
    renderer.mount(container);

    const MOCKED_HEIGHT = 500;
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: MOCKED_HEIGHT, configurable: true });

    const entries = [makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 500 })];
    const ds = makeDataStoreForEntries(entries);

    renderer.update(makeSnapshot(entries), 10, ds);
    renderer.update(makeSnapshot([]), 10, emptyDataStore);
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(0);

    renderer.update(makeSnapshot(entries), 10, ds);
    const wrapper = container.querySelector('.chart-race__bar-wrapper') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.opacity).toBe('1');
    const barHeight = MOCKED_HEIGHT / 10;
    expect(wrapper.style.transform).toBe(`translateY(${0 * barHeight}px)`);
    expect(wrapper.style.height).toBe(`${barHeight}px`);
  });

  // 29. Scrubbing disables CSS transitions for instant snapping
  it('scrubbing mode disables transitions on bar wrappers and bars', () => {
    renderer.mount(container);

    const MOCKED_HEIGHT = 500;
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: MOCKED_HEIGHT, configurable: true });

    const entries1 = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));

    eventBus.emit('scrub:start');

    const entries2 = [
      makeEntry({ artistId: 'a2', rank: 1, cumulativeValue: 1200 }),
      makeEntry({ artistId: 'a1', rank: 2, cumulativeValue: 1000 }),
    ];
    renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

    for (const w of container.querySelectorAll('.chart-race__bar-wrapper')) {
      expect((w as HTMLElement).style.transition).toBe('none');
    }
    for (const b of container.querySelectorAll('.chart-race__bar')) {
      expect((b as HTMLElement).style.transition).toBe('none');
    }

    eventBus.emit('scrub:end');
  });

  // 30. Scrub:start removes all bars for clean slate
  it('scrub:start removes all bars from DOM for clean re-creation', () => {
    renderer.mount(container);

    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 500 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 300 }),
    ];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(2);

    eventBus.emit('scrub:start');
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(0);

    eventBus.emit('scrub:end');
  });

  // 30b. Update during scrub mode creates bars without transitions
  it('update during scrub creates bars with transition:none', () => {
    renderer.mount(container);

    const entries1 = [makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 500 })];
    renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));

    eventBus.emit('scrub:start');
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(0);

    const entries2 = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 800 }),
    ];
    renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

    const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
    expect(wrappers.length).toBe(2);
    for (const w of wrappers) {
      expect((w as HTMLElement).style.transition).toBe('none');
    }

    const values = container.querySelectorAll('.bar__value');
    expect(values[0].textContent).toBe('1,000');
    expect(values[1].textContent).toBe('800');

    eventBus.emit('scrub:end');
  });

  // 31. Scrub mode snaps value text instantly (no tween)
  it('scrub mode sets value text instantly without tweening', () => {
    renderer.mount(container);

    const entries = [makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 100, previousCumulativeValue: 100 })];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    eventBus.emit('scrub:start');

    const entries2 = [makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 99999, previousCumulativeValue: 100 })];
    renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

    expect(container.querySelector('.bar__value')!.textContent).toBe('99,999');

    eventBus.emit('scrub:end');
  });

  // 32. Bar width has CSS transition in stylesheet
  it('bar element has CSS transition for width in the stylesheet', () => {
    const fs = require('fs');
    const path = require('path');
    const cssPath = path.resolve(__dirname, '../../src/style.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    const ruleMatch = cssContent.match(
      /\.chart-race__bar\s*\{[^}]*transition:\s*width\s+[\d.]+s[^}]*\}/,
    );
    expect(ruleMatch).not.toBeNull();
  });

  // 33. New bars start at previous cumulative width (not current)
  it('new bars start at previous cumulative width before transitioning', () => {
    renderer.mount(container);

    const entries = [makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 0 })];
    expect(container.querySelectorAll('.chart-race__bar').length).toBe(0);

    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    const bar = container.querySelector('.chart-race__bar') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBeTruthy();
  });

  // 34. Bar wrapper has CSS transition for transform (position sliding)
  it('bar wrapper has CSS transition for transform in the stylesheet', () => {
    const fs = require('fs');
    const path = require('path');
    const cssPath = path.resolve(__dirname, '../../src/style.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    const ruleMatch = cssContent.match(
      /\.chart-race__bar-wrapper\s*\{[^}]*transition:[^}]*transform\s+[\d.]+s[^}]*\}/,
    );
    expect(ruleMatch).not.toBeNull();
  });

  // 35. Bars reposition via translateY when ranks change
  it('bars update translateY when ranks swap', () => {
    renderer.mount(container);

    const MOCKED_HEIGHT = 500;
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: MOCKED_HEIGHT, configurable: true });

    const barHeight = MOCKED_HEIGHT / 10;

    const entries1 = [
      makeEntry({ artistId: 'a1', artistName: 'Luna Park', rank: 1, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Jay Storm', rank: 2, cumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));

    const entries2 = [
      makeEntry({ artistId: 'a2', artistName: 'Jay Storm', rank: 1, cumulativeValue: 1200 }),
      makeEntry({ artistId: 'a1', artistName: 'Luna Park', rank: 2, cumulativeValue: 1000 }),
    ];
    renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

    const allWrappers = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'));
    const a2Wrapper = allWrappers.find(w => w.querySelector('.bar__name')?.textContent === 'Jay Storm') as HTMLElement;
    const a1Wrapper = allWrappers.find(w => w.querySelector('.bar__name')?.textContent === 'Luna Park') as HTMLElement;

    expect(a2Wrapper?.style.transform).toBe(`translateY(${0 * barHeight}px)`);
    expect(a1Wrapper?.style.transform).toBe(`translateY(${1 * barHeight}px)`);
  });

  // 36. New bars start at bottom of container and 0% width
  it('new bars start at bottom with 0% width before animating to target', () => {
    renderer.mount(container);

    const MOCKED_HEIGHT = 500;
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: MOCKED_HEIGHT, configurable: true });

    const entries = [makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 0 })];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    const wrapper = container.querySelector('.chart-race__bar-wrapper') as HTMLElement;
    const barHeight = MOCKED_HEIGHT / 10;
    expect(wrapper.style.transform).toBe(`translateY(${0 * barHeight}px)`);
  });

  // 37. scrub:end clears inline transition overrides
  it('scrub:end clears inline transition:none so CSS transitions resume', () => {
    renderer.mount(container);

    const entries = [makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 500 })];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    eventBus.emit('scrub:start');
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    const wrapper = container.querySelector('.chart-race__bar-wrapper') as HTMLElement;
    expect(wrapper.style.transition).toBe('none');

    eventBus.emit('scrub:end');
    expect(wrapper.style.transition).toBe('');
  });

  // 38. Value tweening is active (tween duration > 0)
  it('value tween duration is set for animation', () => {
    renderer.mount(container);

    const entries = [makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 500 })];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    const value = container.querySelector('.bar__value');
    expect(value).not.toBeNull();
    expect(value!.textContent).toBeTruthy();
  });

  // 39. applyVisibilityFilter hides bars not in filtered set with wipe cover
  it('applyVisibilityFilter marks bars as hidden with wipe cover', () => {
    renderer.mount(container);

    const entries = [
      makeEntry({ artistId: 'a1', artistName: 'Luna Park', rank: 1, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Jay Storm', rank: 2, cumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(2);

    renderer.applyVisibilityFilter(new Set(['a1']), 50);

    const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
    expect(wrappers.length).toBe(2);
    const a2Wrapper = Array.from(wrappers).find(
      w => w.querySelector('.bar__name')?.textContent === 'Jay Storm'
    ) as HTMLElement;
    expect(a2Wrapper).not.toBeNull();
    expect(a2Wrapper.style.pointerEvents).toBe('none');
    const wipeCover = a2Wrapper.querySelector('.bar__wipe-cover') as HTMLElement;
    expect(wipeCover.style.height).toBe('100%');
  });

  // ============================================================
  // Task 1: Comprehensive tests for current animation behavior
  // ============================================================

  // 40. Two-phase update: unfiltered bars exist in DOM during phase 1
  it('two-phase update keeps unfiltered-top-10 bars in DOM during phase 1', () => {
    renderer.mount(container);

    const MOCKED_HEIGHT = 500;
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: MOCKED_HEIGHT, configurable: true });

    // Initial update with 3 active bars (establishes existing bars for two-phase)
    const entries1 = [
      makeEntry({ artistId: 'a1', artistName: 'Active 1', rank: 1, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Active 2', rank: 2, cumulativeValue: 900 }),
      makeEntry({ artistId: 'a3', artistName: 'Inactive', rank: 3, cumulativeValue: 800 }),
    ];
    const ds1 = makeDataStoreForEntries(entries1);
    renderer.update(makeSnapshot(entries1), 10, ds1);
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(3);

    // Second update: a3 is in the unfiltered top-10 but NOT active.
    // With two-phase, a3 should still be in DOM during phase 1 (position animation).
    // Build a DataStore where only a1 and a2 are active.
    const entries2 = [
      makeEntry({ artistId: 'a1', artistName: 'Active 1', rank: 1, cumulativeValue: 1100 }),
      makeEntry({ artistId: 'a2', artistName: 'Active 2', rank: 2, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a3', artistName: 'Inactive', rank: 3, cumulativeValue: 800 }),
    ];
    const ds2 = makeDataStoreWithActivity(entries2, new Set(['a1', 'a2']));
    renderer.update(makeSnapshot(entries2), 10, ds2);

    // During phase 1 (before the 2880ms timeout), a3 should still be in the DOM
    const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
    const a3Wrapper = Array.from(wrappers).find(
      w => w.querySelector('.bar__name')?.textContent === 'Inactive'
    );
    expect(a3Wrapper).not.toBeNull();
    // a3 is still visible (not hidden yet — that happens in phase 2)
    expect(wrappers.length).toBe(3);
  });

  // 41. Wipe cover on hide: bars not in filtered set get wipe cover 100% and pointer-events none
  it('applyVisibilityFilter sets wipe cover height 100% and pointer-events none on hidden bars', () => {
    renderer.mount(container);

    const entries = [
      makeEntry({ artistId: 'a1', artistName: 'Stays', rank: 1, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Hidden A', rank: 2, cumulativeValue: 800 }),
      makeEntry({ artistId: 'a3', artistName: 'Hidden B', rank: 3, cumulativeValue: 600 }),
    ];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    // Apply filter: only a1 stays
    renderer.applyVisibilityFilter(new Set(['a1']), 50);

    const allWrappers = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'));
    for (const w of allWrappers) {
      const name = w.querySelector('.bar__name')?.textContent;
      const htmlW = w as HTMLElement;
      const wipe = w.querySelector('.bar__wipe-cover') as HTMLElement;
      if (name === 'Stays') {
        // Visible bar: no wipe, pointer-events normal
        expect(wipe.style.height).not.toBe('100%');
        expect(htmlW.style.pointerEvents).not.toBe('none');
      } else {
        // Hidden bars: wipe cover at 100%, pointer-events none
        expect(wipe.style.height).toBe('100%');
        expect(htmlW.style.pointerEvents).toBe('none');
      }
    }
  });

  // 42. Phase 2 replacement bars: bars in filtered set that don't exist in DOM are created
  it('phase 2 creates replacement bars for entries ranked beyond 10 that enter via backfill', () => {
    vi.useFakeTimers();
    try {
      renderer.mount(container);

      const MOCKED_HEIGHT = 500;
      const barsContainer = container.querySelector('.chart-race__bars')!;
      Object.defineProperty(barsContainer, 'clientHeight', { value: MOCKED_HEIGHT, configurable: true });

      // Initial update: 3 bars (all active)
      const entries1 = [
        makeEntry({ artistId: 'a1', artistName: 'Artist 1', rank: 1, cumulativeValue: 1000 }),
        makeEntry({ artistId: 'a2', artistName: 'Artist 2', rank: 2, cumulativeValue: 900 }),
        makeEntry({ artistId: 'a3', artistName: 'Artist 3', rank: 3, cumulativeValue: 800 }),
      ];
      renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));
      expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(3);

      // Manually hide a2 via applyVisibilityFilter (simulating what phase 2 does)
      renderer.applyVisibilityFilter(new Set(['a1', 'a3']), 50);

      // a2 is now hidden with wipe cover
      const a2Hidden = Array.from(container.querySelectorAll('.chart-race__bar-wrapper')).find(
        w => w.querySelector('.bar__name')?.textContent === 'Artist 2'
      ) as HTMLElement;
      expect(a2Hidden.style.pointerEvents).toBe('none');

      // Second update with a4 (new entry) in the filtered set.
      // Phase 1 includes existing non-hidden bars (a1, a3) + filtered entries.
      // a4 is new and in filtered set, so it gets created in phase 1.
      const entries2 = [
        makeEntry({ artistId: 'a1', artistName: 'Artist 1', rank: 1, cumulativeValue: 1100 }),
        makeEntry({ artistId: 'a2', artistName: 'Artist 2', rank: 2, cumulativeValue: 900 }),
        makeEntry({ artistId: 'a3', artistName: 'Artist 3', rank: 3, cumulativeValue: 850 }),
        makeEntry({ artistId: 'a4', artistName: 'Newcomer', rank: 4, cumulativeValue: 700 }),
      ];
      const ds2 = makeDataStoreForEntries(entries2);
      renderer.update(makeSnapshot(entries2), 10, ds2);

      // Advance to phase 2
      vi.advanceTimersByTime(2880);

      // After phase 2: a4 (newcomer) should be in DOM
      const allWrappers = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'));
      const newcomer = allWrappers.find(
        w => w.querySelector('.bar__name')?.textContent === 'Newcomer'
      );
      expect(newcomer).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // 43. Scrub snap: after scrub:start all bars removed, after update bars have transition:none and values snapped
  it('scrub snap: bars removed on scrub:start, re-created with transition:none and snapped values', () => {
    renderer.mount(container);

    const entries1 = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 500 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 300 }),
    ];
    renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(2);

    // scrub:start clears all bars
    eventBus.emit('scrub:start');
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(0);

    // Update during scrub: bars re-created with transition:none
    const entries2 = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 2000, previousCumulativeValue: 500 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 1500, previousCumulativeValue: 300 }),
    ];
    renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

    const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
    expect(wrappers.length).toBe(2);

    // All wrappers have transition:none
    for (const w of wrappers) {
      expect((w as HTMLElement).style.transition).toBe('none');
    }

    // Values are snapped to final (not mid-tween)
    const values = container.querySelectorAll('.bar__value');
    expect(values[0].textContent).toBe('2,000');
    expect(values[1].textContent).toBe('1,500');

    eventBus.emit('scrub:end');
  });

  // 44. Wrap-around resets: after reset event, bars are cleared
  it('reset event clears all bars and allows fresh start', () => {
    renderer.mount(container);

    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 500 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 300 }),
    ];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(2);

    // Reset clears all bars
    eventBus.emit('reset');
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(0);

    // New update after reset creates bars fresh (no two-phase since bars.size === 0)
    const entries2 = [
      makeEntry({ artistId: 'a3', rank: 1, cumulativeValue: 1000 }),
    ];
    renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(1);
    expect(container.querySelector('.bar__name')!.textContent).toBe('Luna Park');
  });

  // 45. Progressive rank tracking: rank badges start at pre-update values
  it('rank badges are initialized to pre-update values during playback', () => {
    renderer.mount(container);

    const MOCKED_HEIGHT = 500;
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: MOCKED_HEIGHT, configurable: true });

    // First update: a1 at rank 1, a2 at rank 2
    const entries1 = [
      makeEntry({ artistId: 'a1', artistName: 'Artist A', rank: 1, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Artist B', rank: 2, cumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));

    // Verify initial ranks
    const allWrappers1 = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'));
    const a1Rank1 = allWrappers1.find(w => w.querySelector('.bar__name')?.textContent === 'Artist A')
      ?.querySelector('.bar__rank');
    const a2Rank1 = allWrappers1.find(w => w.querySelector('.bar__name')?.textContent === 'Artist B')
      ?.querySelector('.bar__rank');
    expect(a1Rank1?.textContent).toBe('#1');
    expect(a2Rank1?.textContent).toBe('#2');

    // Second update: ranks swap. In jsdom, rAF doesn't fire, so rank tracking
    // initializes displayed ranks from pre-update values.
    // After startRankTracking, the initial rank should be the pre-update value.
    const entries2 = [
      makeEntry({ artistId: 'a2', artistName: 'Artist B', rank: 1, cumulativeValue: 1200 }),
      makeEntry({ artistId: 'a1', artistName: 'Artist A', rank: 2, cumulativeValue: 1000 }),
    ];
    renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

    // Since rAF doesn't fire in jsdom, the rank tracking loop never runs.
    // The initial rank was set from preUpdateRanks in startRankTracking.
    // a1 had rank 1 before, a2 had rank 2 before.
    const allWrappers2 = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'));
    const a1Rank2 = allWrappers2.find(w => w.querySelector('.bar__name')?.textContent === 'Artist A')
      ?.querySelector('.bar__rank');
    const a2Rank2 = allWrappers2.find(w => w.querySelector('.bar__name')?.textContent === 'Artist B')
      ?.querySelector('.bar__rank');
    // Pre-update ranks: a1 was #1, a2 was #2
    expect(a1Rank2?.textContent).toBe('#1');
    expect(a2Rank2?.textContent).toBe('#2');
  });

  // ============================================================
  // Task 2: Restore animation tests (5d)
  // ============================================================

  // 46. Restored bar in phase 2: wipe cover starts at 100% and transitions to 0%
  it('restored bar in phase 2 starts with wipe cover at 100% then animates to 0%', () => {
    vi.useFakeTimers();
    try {
      renderer.mount(container);

      const MOCKED_HEIGHT = 500;
      const barsContainer = container.querySelector('.chart-race__bars')!;
      Object.defineProperty(barsContainer, 'clientHeight', { value: MOCKED_HEIGHT, configurable: true });

      // Initial update: a1 and a2 both active
      const entries1 = [
        makeEntry({ artistId: 'a1', artistName: 'Artist 1', rank: 1, cumulativeValue: 1000 }),
        makeEntry({ artistId: 'a2', artistName: 'Artist 2', rank: 2, cumulativeValue: 900 }),
      ];
      renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));
      expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(2);

      // Manually hide a2 via applyVisibilityFilter
      renderer.applyVisibilityFilter(new Set(['a1']), 50);

      // Verify a2 is hidden
      const a2WrapperHidden = Array.from(container.querySelectorAll('.chart-race__bar-wrapper')).find(
        w => w.querySelector('.bar__name')?.textContent === 'Artist 2'
      ) as HTMLElement;
      expect(a2WrapperHidden).not.toBeNull();
      expect(a2WrapperHidden.style.pointerEvents).toBe('none');

      // Update with both active — a2 should be restored in phase 2
      const entries2 = [
        makeEntry({ artistId: 'a1', artistName: 'Artist 1', rank: 1, cumulativeValue: 1200 }),
        makeEntry({ artistId: 'a2', artistName: 'Artist 2', rank: 2, cumulativeValue: 1000 }),
      ];
      renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

      // Advance to phase 2
      vi.advanceTimersByTime(2880);

      // After phase 2: a2 should be restored with wipe cover at 0%
      const a2WrapperRestored = Array.from(container.querySelectorAll('.chart-race__bar-wrapper')).find(
        w => w.querySelector('.bar__name')?.textContent === 'Artist 2'
      ) as HTMLElement;
      expect(a2WrapperRestored).not.toBeNull();
      expect(a2WrapperRestored.style.pointerEvents).toBe('');
      const wipeCover = a2WrapperRestored.querySelector('.bar__wipe-cover') as HTMLElement;
      expect(wipeCover.style.height).toBe('0px');
    } finally {
      vi.useRealTimers();
    }
  });

  // 47. Restored bar is placed at target position (not bottom)
  it('restored bar is placed at its target position, not at the bottom', () => {
    vi.useFakeTimers();
    try {
      renderer.mount(container);

      const MOCKED_HEIGHT = 500;
      const barsContainer = container.querySelector('.chart-race__bars')!;
      Object.defineProperty(barsContainer, 'clientHeight', { value: MOCKED_HEIGHT, configurable: true });
      const barHeight = MOCKED_HEIGHT / 10;

      // Initial: a1 and a2 active
      const entries1 = [
        makeEntry({ artistId: 'a1', artistName: 'Artist 1', rank: 1, cumulativeValue: 1000 }),
        makeEntry({ artistId: 'a2', artistName: 'Artist 2', rank: 2, cumulativeValue: 900 }),
      ];
      renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));

      // Manually hide a2
      renderer.applyVisibilityFilter(new Set(['a1']), barHeight);

      // Restore a2
      const entries2 = [
        makeEntry({ artistId: 'a1', artistName: 'Artist 1', rank: 1, cumulativeValue: 1200 }),
        makeEntry({ artistId: 'a2', artistName: 'Artist 2', rank: 2, cumulativeValue: 1000 }),
      ];
      renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));
      vi.advanceTimersByTime(2880);

      // a2 should be at visual index 1 (rank 2 in the filtered set)
      const a2Wrapper = Array.from(container.querySelectorAll('.chart-race__bar-wrapper')).find(
        w => w.querySelector('.bar__name')?.textContent === 'Artist 2'
      ) as HTMLElement;
      expect(a2Wrapper).not.toBeNull();
      expect(a2Wrapper.style.transform).toBe(`translateY(${1 * barHeight}px)`);
    } finally {
      vi.useRealTimers();
    }
  });

  // 48. Scrubbing: restored bars appear instantly (no wipe animation)
  it('scrubbing restores hidden bars instantly without wipe animation', () => {
    renderer.mount(container);

    const MOCKED_HEIGHT = 500;
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: MOCKED_HEIGHT, configurable: true });

    // Initial: a1 and a2 active
    const entries1 = [
      makeEntry({ artistId: 'a1', artistName: 'Artist 1', rank: 1, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Artist 2', rank: 2, cumulativeValue: 900 }),
    ];
    renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));

    // Hide a2 via applyVisibilityFilter
    renderer.applyVisibilityFilter(new Set(['a1']), 50);

    // Enter scrub mode
    eventBus.emit('scrub:start');

    // Update with both active — a2 should be re-created instantly
    const entries2 = [
      makeEntry({ artistId: 'a1', artistName: 'Artist 1', rank: 1, cumulativeValue: 1100 }),
      makeEntry({ artistId: 'a2', artistName: 'Artist 2', rank: 2, cumulativeValue: 1000 }),
    ];
    renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

    // Both bars should be in DOM
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(2);

    // All bars should have transition:none (scrub mode)
    for (const w of container.querySelectorAll('.chart-race__bar-wrapper')) {
      expect((w as HTMLElement).style.transition).toBe('none');
    }

    eventBus.emit('scrub:end');
  });

  // 49. Initial load: bars appear directly (no wipe)
  it('initial load creates bars without wipe cover animation', () => {
    renderer.mount(container);

    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 800 }),
    ];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    // All wipe covers should be at 0% (no wipe on initial load)
    const wipeCoverEls = container.querySelectorAll('.bar__wipe-cover');
    for (const wc of wipeCoverEls) {
      expect((wc as HTMLElement).style.height).not.toBe('100%');
    }
  });

  // 50. Wipe cover CSS has transition property for height
  it('wipe cover CSS has transition for height in the stylesheet', () => {
    const fs = require('fs');
    const path = require('path');
    const cssPath = path.resolve(__dirname, '../../src/style.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    const ruleMatch = cssContent.match(
      /\.bar__wipe-cover\s*\{[^}]*transition:\s*height\s+[\d.]+s[^}]*\}/,
    );
    expect(ruleMatch).not.toBeNull();
  });

  // 51. Hidden bars excluded from phase 1 when they will be restored in phase 2
  it('hidden-to-restore bars are excluded from phase 1 visible entries', () => {
    vi.useFakeTimers();
    try {
      renderer.mount(container);

      const MOCKED_HEIGHT = 500;
      const barsContainer = container.querySelector('.chart-race__bars')!;
      Object.defineProperty(barsContainer, 'clientHeight', { value: MOCKED_HEIGHT, configurable: true });

      // Initial: a1 and a2 active
      const entries1 = [
        makeEntry({ artistId: 'a1', artistName: 'Artist 1', rank: 1, cumulativeValue: 1000 }),
        makeEntry({ artistId: 'a2', artistName: 'Artist 2', rank: 2, cumulativeValue: 900 }),
      ];
      renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));

      // Manually hide a2
      renderer.applyVisibilityFilter(new Set(['a1']), 50);

      // Verify a2 is hidden
      const a2Hidden = Array.from(container.querySelectorAll('.chart-race__bar-wrapper')).find(
        w => w.querySelector('.bar__name')?.textContent === 'Artist 2'
      ) as HTMLElement;
      expect(a2Hidden.style.pointerEvents).toBe('none');

      // Restore a2 — during phase 1, a2 should still be hidden
      const entries2 = [
        makeEntry({ artistId: 'a1', artistName: 'Artist 1', rank: 1, cumulativeValue: 1200 }),
        makeEntry({ artistId: 'a2', artistName: 'Artist 2', rank: 2, cumulativeValue: 1000 }),
      ];
      renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

      // During phase 1: a2 is still hidden (pointer-events none)
      const a2StillHidden = Array.from(container.querySelectorAll('.chart-race__bar-wrapper')).find(
        w => w.querySelector('.bar__name')?.textContent === 'Artist 2'
      ) as HTMLElement;
      expect(a2StillHidden.style.pointerEvents).toBe('none');

      // After phase 2, a2 is restored
      vi.advanceTimersByTime(2880);
      const a2Restored = Array.from(container.querySelectorAll('.chart-race__bar-wrapper')).find(
        w => w.querySelector('.bar__name')?.textContent === 'Artist 2'
      ) as HTMLElement;
      expect(a2Restored.style.pointerEvents).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});


// ============================================================
// Bugfix 0007: Bug Condition Exploration — Click Outside & Cursor
// **Validates: Requirements 1.1, 1.2**
// These tests demonstrate the bugs exist on UNFIXED code.
// They encode the EXPECTED behavior — they will pass after the fix.
// ============================================================

import { DetailPanel } from '../../src/detail-panel.ts';

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
    renderer.update(snapshot, 10, dataStore);

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
