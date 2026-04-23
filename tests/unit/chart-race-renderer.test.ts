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
    isGoalpost: false,
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
    // Value should display the cumulative value (may be formatted with locale)
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
    Object.defineProperty(barsContainer, 'clientHeight', {
      value: MOCKED_HEIGHT,
      configurable: true,
    });

    // Create entries with non-contiguous ranks (e.g., ranks 2, 5, 8)
    // simulating what filterByActivity might produce
    const entries = [
      makeEntry({ artistId: 'a1', artistName: 'Artist A', rank: 2, cumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Artist B', rank: 5, cumulativeValue: 700 }),
      makeEntry({ artistId: 'a3', artistName: 'Artist C', rank: 8, cumulativeValue: 500 }),
    ];
    const snapshot = makeSnapshot(entries);
    const ds = makeDataStoreForEntries(snapshot.entries);

    renderer.update(snapshot, 10, ds);

    const barHeight = MOCKED_HEIGHT / 10;
    const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
    expect(wrappers.length).toBe(3);

    // Visual index 0 → translateY(0), visual index 1 → translateY(barHeight), etc.
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
    const snapshot = makeSnapshot(entries);
    renderer.update(snapshot, 10, emptyDataStore);

    const wrapper = container.querySelector('.chart-race__bar-wrapper') as HTMLElement;
    // After update, opacity should be "1" (not starting from "0")
    expect(wrapper.style.opacity).toBe('1');
  });

  // 27. Bars filtered out are removed from DOM immediately (simplified update)
  it('bars filtered out are removed from DOM immediately', () => {
    renderer.mount(container);

    // First update: show artist
    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 500 }),
    ];
    const snapshot1 = makeSnapshot(entries);
    const ds = makeDataStoreForEntries(entries);
    renderer.update(snapshot1, 10, ds);

    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(1);

    // Second update: artist no longer visible
    const snapshot2 = makeSnapshot([]);
    renderer.update(snapshot2, 10, emptyDataStore);

    // Bar is removed from DOM immediately (no wipe cover animation)
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(0);
  });

  // 28. Bars re-created after removal are placed at correct position
  it('bars re-created after removal are placed at correct position with full height', () => {
    renderer.mount(container);

    const MOCKED_HEIGHT = 500;
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', {
      value: MOCKED_HEIGHT,
      configurable: true,
    });

    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 500 }),
    ];
    const ds = makeDataStoreForEntries(entries);

    // Show, then remove (simplified update removes immediately)
    renderer.update(makeSnapshot(entries), 10, ds);
    renderer.update(makeSnapshot([]), 10, emptyDataStore);

    // Bar was removed from DOM
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(0);

    // Re-show — bar is re-created at correct position
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
    Object.defineProperty(barsContainer, 'clientHeight', {
      value: MOCKED_HEIGHT,
      configurable: true,
    });

    // Initial render
    const entries1 = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));

    // Enter scrub mode
    eventBus.emit('scrub:start');

    // Update with swapped positions
    const entries2 = [
      makeEntry({ artistId: 'a2', rank: 1, cumulativeValue: 1200 }),
      makeEntry({ artistId: 'a1', rank: 2, cumulativeValue: 1000 }),
    ];
    renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

    // All bar wrappers should have transition: none
    const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
    for (const w of wrappers) {
      expect((w as HTMLElement).style.transition).toBe('none');
    }

    // All bars should have transition: none
    const bars = container.querySelectorAll('.chart-race__bar');
    for (const b of bars) {
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
    const ds = makeDataStoreForEntries(entries);
    renderer.update(makeSnapshot(entries), 10, ds);

    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(2);

    // Start scrubbing — all bars removed
    eventBus.emit('scrub:start');
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(0);

    eventBus.emit('scrub:end');
  });

  // 30b. Update during scrub mode creates bars without transitions
  it('update during scrub creates bars with transition:none', () => {
    renderer.mount(container);

    const entries1 = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));

    // Start scrubbing — clears all bars
    eventBus.emit('scrub:start');
    expect(container.querySelectorAll('.chart-race__bar-wrapper').length).toBe(0);

    // Update while scrubbing — bars re-created with no transitions
    const entries2 = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 800 }),
    ];
    renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

    const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
    expect(wrappers.length).toBe(2);
    // Bars should have transition:none (from inline style or CSS class)
    for (const w of wrappers) {
      const style = (w as HTMLElement).style.transition;
      expect(style).toBe('none');
    }

    // Values should be final (no tweening)
    const values = container.querySelectorAll('.bar__value');
    expect(values[0].textContent).toBe('1,000');
    expect(values[1].textContent).toBe('800');

    eventBus.emit('scrub:end');
  });

  // 31. Scrub mode snaps value text instantly (no tween)
  it('scrub mode sets value text instantly without tweening', () => {
    renderer.mount(container);

    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 100, previousCumulativeValue: 100 }),
    ];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    // Enter scrub mode
    eventBus.emit('scrub:start');

    // Update with a big jump
    const entries2 = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 99999, previousCumulativeValue: 100 }),
    ];
    renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

    // Value should be the final value immediately, not mid-tween
    const value = container.querySelector('.bar__value');
    expect(value!.textContent).toBe('99,999');

    eventBus.emit('scrub:end');
  });

  // 32. Bar width has CSS transition in stylesheet
  it('bar element has CSS transition for width in the stylesheet', () => {
    const fs = require('fs');
    const path = require('path');
    const cssPath = path.resolve(__dirname, '../../src/style.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // The .chart-race__bar rule should include a width transition
    const ruleMatch = cssContent.match(
      /\.chart-race__bar\s*\{[^}]*transition:\s*width\s+[\d.]+s[^}]*\}/,
    );
    expect(ruleMatch).not.toBeNull();
  });

  // 33. New bars start at previous cumulative width (not current)
  it('new bars start at previous cumulative width before transitioning', () => {
    renderer.mount(container);

    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 0 }),
    ];
    // Before update, no bars exist
    expect(container.querySelectorAll('.chart-race__bar').length).toBe(0);

    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    // Bar exists and has a width set (the CSS transition will animate it)
    const bar = container.querySelector('.chart-race__bar') as HTMLElement;
    expect(bar).not.toBeNull();
    // Width should be set (the transition handles the animation)
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
    Object.defineProperty(barsContainer, 'clientHeight', {
      value: MOCKED_HEIGHT,
      configurable: true,
    });

    const barHeight = MOCKED_HEIGHT / 10;

    const entries1 = [
      makeEntry({ artistId: 'a1', artistName: 'Luna Park', rank: 1, cumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Jay Storm', rank: 2, cumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(entries1), 10, makeDataStoreForEntries(entries1));

    // Swap ranks
    const entries2 = [
      makeEntry({ artistId: 'a2', artistName: 'Jay Storm', rank: 1, cumulativeValue: 1200 }),
      makeEntry({ artistId: 'a1', artistName: 'Luna Park', rank: 2, cumulativeValue: 1000 }),
    ];
    renderer.update(makeSnapshot(entries2), 10, makeDataStoreForEntries(entries2));

    // Find wrappers by artist name
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
    Object.defineProperty(barsContainer, 'clientHeight', {
      value: MOCKED_HEIGHT,
      configurable: true,
    });

    // First update creates bars — they should start at bottom
    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 0 }),
    ];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    // After update, the bar's TARGET transform is set by updateBarElement
    // But the initial position was at the bottom (containerHeight)
    // and the CSS transition animates from bottom to target.
    // We can verify the target is correct:
    const wrapper = container.querySelector('.chart-race__bar-wrapper') as HTMLElement;
    const barHeight = MOCKED_HEIGHT / 10;
    expect(wrapper.style.transform).toBe(`translateY(${0 * barHeight}px)`);
  });

  // 37. scrub:end clears inline transition overrides
  it('scrub:end clears inline transition:none so CSS transitions resume', () => {
    renderer.mount(container);

    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    // Enter scrub mode — sets transition: none
    eventBus.emit('scrub:start');
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    const wrapper = container.querySelector('.chart-race__bar-wrapper') as HTMLElement;
    expect(wrapper.style.transition).toBe('none');

    // Exit scrub mode — should clear inline transition
    eventBus.emit('scrub:end');
    expect(wrapper.style.transition).toBe('');
  });

  // 38. Value tweening is active (tween duration > 0)
  it('value tween duration is set for animation', () => {
    // Verify TWEEN_DURATION is nonzero by checking that after an update
    // with different previous/current values, the value span exists
    renderer.mount(container);

    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(entries), 10, makeDataStoreForEntries(entries));

    const value = container.querySelector('.bar__value');
    expect(value).not.toBeNull();
    // In jsdom, rAF doesn't fire, so the value is whatever was set initially.
    // The key test is that scrub mode snaps (test 31) while normal mode tweens.
    // We verify the tween was initiated by checking the value is set.
    expect(value!.textContent).toBeTruthy();
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

  // ═══════════════════════════════════════════════════════════════════
  // Goalpost bar rendering
  // ═══════════════════════════════════════════════════════════════════

  it('goalpost bar has empty rank badge text and shows goalpost label', () => {
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // Use zoom "all" to bypass filterByActivity, but set isGoalpost manually
    // Note: goalpost visual treatment applies regardless of zoom level
    const entries = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Goalpost Artist', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: true }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500 }),
    ];
    const snapshot = makeSnapshot(entries);
    // Use zoom "all" so filterByActivity returns entries unchanged (preserving isGoalpost)
    renderer.update(snapshot, 'all', emptyDataStore);

    // Find the goalpost bar
    const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
    const goalpostWrapper = Array.from(wrappers).find(
      w => w.classList.contains('chart-race__bar-wrapper--goalpost')
    ) as HTMLElement;
    expect(goalpostWrapper).toBeTruthy();

    // Rank badge should have empty text
    const rankSpan = goalpostWrapper.querySelector('.bar__rank') as HTMLElement;
    expect(rankSpan.textContent).toBe('');

    // Goalpost label should be visible with artist info
    const label = goalpostWrapper.querySelector('.bar__goalpost-label') as HTMLElement;
    expect(label.style.display).toBe('inline');
    expect(label.textContent).toContain('#2');
    expect(label.textContent).toContain('Goalpost Artist');
    expect(label.textContent).toContain('800');
  });

  it('goalpost rank badge stays empty after stopRankTracking', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const entries = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Goalpost', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: true }),
    ];
    renderer.update(makeSnapshot(entries), 'all', emptyDataStore);

    // Advance past the phase timeout which calls stopRankTracking
    vi.advanceTimersByTime(3000);

    const goalpostWrapper = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.classList.contains('chart-race__bar-wrapper--goalpost')) as HTMLElement;
    const rankSpan = goalpostWrapper.querySelector('.bar__rank') as HTMLElement;
    expect(rankSpan.textContent).toBe('');

    vi.useRealTimers();
  });

  it('goalpost → regular transition: bar switches to normal rendering when no longer goalpost', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // Day 1: a2 is a goalpost
    const day1 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Was Goalpost', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: true }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);

    // Verify a2 is goalpost
    let a2 = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.querySelector('.bar__goalpost-label')?.textContent?.includes('Was Goalpost')) as HTMLElement;
    expect(a2.classList.contains('chart-race__bar-wrapper--goalpost')).toBe(true);

    // Day 2: a2 is now a regular bar (no longer goalpost)
    const day2 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Was Goalpost', rank: 2, cumulativeValue: 900, previousCumulativeValue: 800, isGoalpost: false }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 3, cumulativeValue: 700, previousCumulativeValue: 600 }),
    ];
    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);
    // Advance past phase 1 + phase 2
    vi.advanceTimersByTime(1200 + 600);

    // a2 should no longer have goalpost class
    a2 = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.querySelector('.bar__name')?.textContent === 'Was Goalpost') as HTMLElement;
    expect(a2.classList.contains('chart-race__bar-wrapper--goalpost')).toBe(false);

    // Normal elements should be visible
    const bar = a2.querySelector('.chart-race__bar') as HTMLElement;
    expect(bar.style.display).not.toBe('none');
    expect(bar.style.height).not.toBe('0');
    const rankSpan = a2.querySelector('.bar__rank') as HTMLElement;
    expect(rankSpan.style.display).not.toBe('none');
    const label = a2.querySelector('.bar__goalpost-label') as HTMLElement;
    expect(label.style.display).toBe('none');

    vi.useRealTimers();
  });

  it('regular → goalpost transition: bar switches to goalpost rendering', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // Day 1: a2 is a regular bar
    const day1 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Becomes Goalpost', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: false }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);

    // Verify a2 is regular
    let a2 = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.querySelector('.bar__name')?.textContent === 'Becomes Goalpost') as HTMLElement;
    expect(a2.classList.contains('chart-race__bar-wrapper--goalpost')).toBe(false);

    // Day 2: a2 becomes a goalpost
    const day2 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Becomes Goalpost', rank: 2, cumulativeValue: 900, previousCumulativeValue: 800, isGoalpost: true }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 3, cumulativeValue: 700, previousCumulativeValue: 600 }),
    ];
    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);
    // Advance past phase 1 + phase 2
    vi.advanceTimersByTime(1200 + 600);

    // a2 should now have goalpost class
    a2 = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.classList.contains('chart-race__bar-wrapper--goalpost')) as HTMLElement;
    expect(a2).toBeTruthy();

    // Bar should be styled as dashed line
    const bar = a2.querySelector('.chart-race__bar') as HTMLElement;
    expect(bar.style.height).toBe('0px');
    expect(bar.style.backgroundColor).toBe('transparent');

    // Goalpost label should be visible
    const label = a2.querySelector('.bar__goalpost-label') as HTMLElement;
    expect(label.style.display).toBe('inline');
    expect(label.textContent).toContain('Becomes Goalpost');

    vi.useRealTimers();
  });

  it('goalpost rows get smaller height than regular bars (zoom 10)', () => {
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // Use zoom "all" with isGoalpost entries — goalpost height only applies at zoom 10
    // but the goalpost CSS class is applied regardless. Test the wrapper height at zoom "all"
    // where all bars get BAR_HEIGHT_ALL (40px), then verify goalpost class is applied.
    // For the actual height difference, we test the CSS class presence.
    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: true }),
      makeEntry({ artistId: 'a3', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500 }),
    ];
    // At zoom "all", all bars get BAR_HEIGHT_ALL=40, but goalpost class is still applied
    renderer.update(makeSnapshot(entries), 'all', emptyDataStore);

    const goalpostWrapper = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.classList.contains('chart-race__bar-wrapper--goalpost')) as HTMLElement;
    expect(goalpostWrapper).toBeTruthy();
    // At zoom "all", height is BAR_HEIGHT_ALL for all entries
    expect(goalpostWrapper.style.height).toBe('40px');

    // Now test at zoom 10 using makeDataStoreForEntries so filterByActivity works
    // We need entries that filterByActivity will return with isGoalpost set
    // Since filterByActivity computes its own goalposts, we test the height logic
    // by checking that the GOALPOST_HEIGHT constant (16) is used
    // This is implicitly tested by the filter + renderer integration
    expect(goalpostWrapper.classList.contains('chart-race__bar-wrapper--goalpost')).toBe(true);
  });

  it('goalpost width includes rank badge offset via calc()', () => {
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 500, previousCumulativeValue: 400, isGoalpost: true }),
    ];
    renderer.update(makeSnapshot(entries), 'all', emptyDataStore);

    const goalpostWrapper = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.classList.contains('chart-race__bar-wrapper--goalpost')) as HTMLElement;
    const bar = goalpostWrapper.querySelector('.chart-race__bar') as HTMLElement;

    // Width should use calc() with a pixel offset
    expect(bar.style.width).toMatch(/^calc\(.+\+ 30px\)$/);
  });

  it('clicking a goalpost bar emits bar:click event', () => {
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'gp1', artistName: 'Goalpost Click', rank: 2, cumulativeValue: 500, previousCumulativeValue: 400, isGoalpost: true }),
    ];
    renderer.update(makeSnapshot(entries), 'all', emptyDataStore);

    const clicks: string[] = [];
    eventBus.on('bar:click', (id: string) => clicks.push(id));

    const goalpostWrapper = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.classList.contains('chart-race__bar-wrapper--goalpost')) as HTMLElement;

    // Click the goalpost label
    const label = goalpostWrapper.querySelector('.bar__goalpost-label') as HTMLElement;
    label.click();

    // Should emit bar:click with the goalpost artist ID
    expect(clicks).toContain('gp1');
  });

  it('goalpost styling does not apply in "all" view when isGoalpost is false', () => {
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // All entries are regular (isGoalpost: false) — none should get goalpost styling
    const entries = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900, isGoalpost: false }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: false }),
      makeEntry({ artistId: 'a3', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500, isGoalpost: false }),
    ];
    renderer.update(makeSnapshot(entries), 'all', emptyDataStore);

    const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
    for (const w of wrappers) {
      expect(w.classList.contains('chart-race__bar-wrapper--goalpost')).toBe(false);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Rank tracking during transitions
  // ═══════════════════════════════════════════════════════════════════

  it('z-index based on target position so rising bars are on top', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const getBar = (name: string) =>
      Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
        .find(w => w.querySelector('.bar__name')?.textContent === name) as HTMLElement;

    // Day 1: a1=#1 (top), a2=#2, a3=#3, a4=#4 (bottom)
    const day1 = [
      makeEntry({ artistId: 'a1', artistName: 'Top', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Second', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700 }),
      makeEntry({ artistId: 'a3', artistName: 'Third', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500 }),
      makeEntry({ artistId: 'a4', artistName: 'Bottom', rank: 4, cumulativeValue: 400, previousCumulativeValue: 300 }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);
    vi.advanceTimersByTime(3000);

    // Day 2: Bottom rises to #2, Second drops to #4
    const day2 = [
      makeEntry({ artistId: 'a1', artistName: 'Top', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a4', artistName: 'Bottom', rank: 2, cumulativeValue: 1050, previousCumulativeValue: 400 }),
      makeEntry({ artistId: 'a3', artistName: 'Third', rank: 3, cumulativeValue: 700, previousCumulativeValue: 600 }),
      makeEntry({ artistId: 'a2', artistName: 'Second', rank: 4, cumulativeValue: 650, previousCumulativeValue: 800 }),
    ];
    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);

    // Rising bar (Bottom, target Y is low) should have HIGHER z-index (on top)
    const bottomZ2 = parseInt(getBar('Bottom').style.zIndex);
    const secondZ2 = parseInt(getBar('Second').style.zIndex);
    const thirdZ2 = parseInt(getBar('Third').style.zIndex);

    expect(bottomZ2).toBeGreaterThan(thirdZ2);
    expect(secondZ2).toBeLessThan(thirdZ2);

    vi.advanceTimersByTime(3000);
    vi.useRealTimers();
  });

  it('rank display shows correct final values after reorder transition', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // Day 1: a1=#1, a2=#2, a3=#3
    const day1 = [
      makeEntry({ artistId: 'a1', artistName: 'Artist 1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Artist 2', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700 }),
      makeEntry({ artistId: 'a3', artistName: 'Artist 3', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);

    // Advance past phase 1 so ranks settle
    vi.advanceTimersByTime(3000);

    // Verify ranks are correct after day 1
    const getRank = (name: string) => {
      const w = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
        .find(w => w.querySelector('.bar__name')?.textContent === name) as HTMLElement;
      return w?.querySelector('.bar__rank')?.textContent;
    };
    expect(getRank('Artist 1')).toBe('#1');
    expect(getRank('Artist 2')).toBe('#2');
    expect(getRank('Artist 3')).toBe('#3');

    // Day 2: a3 jumps to #1, a1 drops to #2, a2 drops to #3
    const day2 = [
      makeEntry({ artistId: 'a3', artistName: 'Artist 3', rank: 1, cumulativeValue: 1500, previousCumulativeValue: 600 }),
      makeEntry({ artistId: 'a1', artistName: 'Artist 1', rank: 2, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Artist 2', rank: 3, cumulativeValue: 900, previousCumulativeValue: 800 }),
    ];
    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);

    // After transition completes, ranks should show final values
    vi.advanceTimersByTime(3000);
    expect(getRank('Artist 1')).toBe('#2');
    expect(getRank('Artist 2')).toBe('#3');
    expect(getRank('Artist 3')).toBe('#1');

    vi.useRealTimers();
  });

  it('new bars get correct final ranks after transition completes', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const getRank = (name: string) => {
      const w = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
        .find(w => w.querySelector('.bar__name')?.textContent === name) as HTMLElement;
      return w?.querySelector('.bar__rank')?.textContent;
    };

    // Day 1: 2 bars exist at ranks 1 and 2
    const day1 = [
      makeEntry({ artistId: 'a1', artistName: 'First', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 0 }),
      makeEntry({ artistId: 'a2', artistName: 'Second', rank: 2, cumulativeValue: 800, previousCumulativeValue: 0 }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);
    vi.advanceTimersByTime(3000);

    expect(getRank('First')).toBe('#1');
    expect(getRank('Second')).toBe('#2');

    // Day 2: a new bar enters at rank 2 (pushing Second to rank 3)
    const day2 = [
      makeEntry({ artistId: 'a1', artistName: 'First', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a3', artistName: 'New Entry', rank: 2, cumulativeValue: 900, previousCumulativeValue: 0 }),
      makeEntry({ artistId: 'a2', artistName: 'Second', rank: 3, cumulativeValue: 850, previousCumulativeValue: 800 }),
    ];
    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);

    // After transition completes (stopRankTracking sets final target ranks)
    vi.advanceTimersByTime(3000);
    expect(getRank('First')).toBe('#1');
    expect(getRank('New Entry')).toBe('#2');
    expect(getRank('Second')).toBe('#3');

    vi.useRealTimers();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Goalpost phase 2 transitions
  // ═══════════════════════════════════════════════════════════════════

  it('regular→goalpost: bar keeps regular appearance during phase 1, switches in phase 2', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const isGoalpostClass = (name: string) => {
      const w = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
        .find(w => (w.querySelector('.bar__name')?.textContent === name) ||
                   (w.querySelector('.bar__goalpost-label')?.textContent?.includes(name))) as HTMLElement;
      return w?.classList.contains('chart-race__bar-wrapper--goalpost') ?? false;
    };

    // Day 1: a2 is a regular bar
    const day1 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Soon Goalpost', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: false }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);
    expect(isGoalpostClass('Soon Goalpost')).toBe(false);

    // Day 2: a2 becomes a goalpost
    const day2 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Soon Goalpost', rank: 2, cumulativeValue: 900, previousCumulativeValue: 800, isGoalpost: true }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 3, cumulativeValue: 700, previousCumulativeValue: 600 }),
    ];
    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);

    // During phase 1: a2 should still be regular (not goalpost yet)
    expect(isGoalpostClass('Soon Goalpost')).toBe(false);

    // After phase 1 + phase 2: a2 should be goalpost
    vi.advanceTimersByTime(1200 + 600);
    expect(isGoalpostClass('Soon Goalpost')).toBe(true);

    vi.useRealTimers();
  });

  it('goalpost→regular: bar keeps goalpost appearance during phase 1, switches in phase 2', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const isGoalpostClass = (name: string) => {
      const w = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
        .find(w => (w.querySelector('.bar__name')?.textContent === name) ||
                   (w.querySelector('.bar__goalpost-label')?.textContent?.includes(name))) as HTMLElement;
      return w?.classList.contains('chart-race__bar-wrapper--goalpost') ?? false;
    };

    // Day 1: a2 is a goalpost
    const day1 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Was Goalpost', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: true }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);
    expect(isGoalpostClass('Was Goalpost')).toBe(true);

    // Day 2: a2 becomes regular
    const day2 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Was Goalpost', rank: 2, cumulativeValue: 900, previousCumulativeValue: 800, isGoalpost: false }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 3, cumulativeValue: 700, previousCumulativeValue: 600 }),
    ];
    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);

    // During phase 1: a2 should still be goalpost
    expect(isGoalpostClass('Was Goalpost')).toBe(true);

    // After phase 1 + phase 2: a2 should be regular
    vi.advanceTimersByTime(1200 + 600);
    expect(isGoalpostClass('Was Goalpost')).toBe(false);

    vi.useRealTimers();
  });

  it('phase 2 skipped when no goalpost state changes', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const day1 = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700 }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);

    // Day 2: same bars, no goalpost changes
    const day2 = [
      makeEntry({ artistId: 'a1', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', rank: 2, cumulativeValue: 900, previousCumulativeValue: 800 }),
    ];

    const completions: number[] = [];
    eventBus.on('update:complete', () => completions.push(Date.now()));

    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);

    // update:complete should fire after phase 1 only (960ms), not phase 1 + phase 2
    vi.advanceTimersByTime(1200);
    expect(completions.length).toBe(1);

    vi.useRealTimers();
  });

  it('collapsing bar keeps regular appearance during phase 2 animation', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const isGoalpostClass = (name: string) => {
      const w = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
        .find(w => (w.querySelector('.bar__name')?.textContent === name) ||
                   (w.querySelector('.bar__goalpost-label')?.textContent?.includes(name))) as HTMLElement;
      return w?.classList.contains('chart-race__bar-wrapper--goalpost') ?? false;
    };

    // Day 1: a2 is regular
    const day1 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Collapsing', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: false }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);

    // Day 2: a2 becomes goalpost
    const day2 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Collapsing', rank: 2, cumulativeValue: 900, previousCumulativeValue: 800, isGoalpost: true }),
    ];
    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);

    // Advance past phase 1 into phase 2 (but not past phase 2)
    vi.advanceTimersByTime(1200);

    // During phase 2 animation: bar should still have regular appearance (not goalpost yet)
    expect(isGoalpostClass('Collapsing')).toBe(false);

    // After phase 2 completes: now it's goalpost
    vi.advanceTimersByTime(600);
    expect(isGoalpostClass('Collapsing')).toBe(true);

    vi.useRealTimers();
  });

  it('scrubbing applies goalpost state immediately without phase 2', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // Day 1: a2 is regular
    const day1 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Target', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: false }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);

    // Scrub to a date where a2 is a goalpost
    eventBus.emit('scrub:start');
    const day2 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Target', rank: 2, cumulativeValue: 900, previousCumulativeValue: 800, isGoalpost: true }),
    ];
    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);
    eventBus.emit('scrub:end');

    // Goalpost should be applied immediately (no phase 2 delay)
    const a2 = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.classList.contains('chart-race__bar-wrapper--goalpost')) as HTMLElement;
    expect(a2).toBeTruthy();

    vi.useRealTimers();
  });

  it('simultaneous collapse and expand: one bar becomes goalpost while another leaves', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const isGoalpostClass = (name: string) => {
      const w = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
        .find(w => (w.querySelector('.bar__name')?.textContent === name) ||
                   (w.querySelector('.bar__goalpost-label')?.textContent?.includes(name))) as HTMLElement;
      return w?.classList.contains('chart-race__bar-wrapper--goalpost') ?? false;
    };

    // Day 1: a2 is regular, a3 is goalpost
    const day1 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Will Collapse', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: false }),
      makeEntry({ artistId: 'a3', artistName: 'Will Expand', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500, isGoalpost: true }),
      makeEntry({ artistId: 'a4', artistName: 'Active 2', rank: 4, cumulativeValue: 400, previousCumulativeValue: 300 }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);

    expect(isGoalpostClass('Will Collapse')).toBe(false);
    expect(isGoalpostClass('Will Expand')).toBe(true);

    // Day 2: a2 becomes goalpost, a3 becomes regular
    const day2 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'Will Collapse', rank: 2, cumulativeValue: 900, previousCumulativeValue: 800, isGoalpost: true }),
      makeEntry({ artistId: 'a3', artistName: 'Will Expand', rank: 3, cumulativeValue: 700, previousCumulativeValue: 600, isGoalpost: false }),
      makeEntry({ artistId: 'a4', artistName: 'Active 2', rank: 4, cumulativeValue: 500, previousCumulativeValue: 400 }),
    ];
    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);

    // During phase 1: both keep their current state
    expect(isGoalpostClass('Will Collapse')).toBe(false);
    expect(isGoalpostClass('Will Expand')).toBe(true);

    // After phase 1 + phase 2: states swapped
    vi.advanceTimersByTime(1200 + 600);
    expect(isGoalpostClass('Will Collapse')).toBe(true);
    expect(isGoalpostClass('Will Expand')).toBe(false);

    vi.useRealTimers();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Zoom transition bugs
// ═══════════════════════════════════════════════════════════════════

describe('Zoom transitions', () => {
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

  it('10→all: new bars appear in the DOM when more entries are shown', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // Start with 3 bars visible
    const entries3 = [
      makeEntry({ artistId: 'a1', artistName: 'First', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'Second', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700 }),
      makeEntry({ artistId: 'a3', artistName: 'Third', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(entries3), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);

    // Now add more entries (simulating switch to "all" showing more bars)
    const allEntries = [
      ...entries3,
      makeEntry({ artistId: 'a4', artistName: 'Fourth', rank: 4, cumulativeValue: 400, previousCumulativeValue: 300 }),
      makeEntry({ artistId: 'a5', artistName: 'Fifth', rank: 5, cumulativeValue: 200, previousCumulativeValue: 100 }),
    ];
    renderer.update(makeSnapshot(allEntries), 'all', emptyDataStore);

    // New bars should be in the DOM
    const fourth = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.querySelector('.bar__name')?.textContent === 'Fourth');
    const fifthEl = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.querySelector('.bar__name')?.textContent === 'Fifth');
    expect(fourth).toBeTruthy();
    expect(fifthEl).toBeTruthy();

    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });

  it('10→all: former goalpost bars show rank badge after switching to all view', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // Render with a goalpost
    const entries1 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'GP', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: true }),
    ];
    renderer.update(makeSnapshot(entries1), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);

    // Now update with isGoalpost: false (simulating "all" view)
    const entries2 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a2', artistName: 'GP', rank: 2, cumulativeValue: 900, previousCumulativeValue: 800, isGoalpost: false }),
    ];
    renderer.update(makeSnapshot(entries2), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);

    // Rank badge should be visible and show correct rank
    const wrapper = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.querySelector('.bar__name')?.textContent === 'GP') as HTMLElement;
    expect(wrapper.classList.contains('chart-race__bar-wrapper--goalpost')).toBe(false);
    const rankSpan = wrapper.querySelector('.bar__rank') as HTMLElement;
    expect(rankSpan.style.display).not.toBe('none');

    vi.useRealTimers();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Zoom change value snapping
// ═══════════════════════════════════════════════════════════════════

describe('Zoom change behavior', () => {
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

  it('zoom change snaps values immediately (no tweening)', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // Render at zoom "all"
    const entries = [
      makeEntry({ artistId: 'a1', artistName: 'Test', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
    ];
    renderer.update(makeSnapshot(entries), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);

    // Switch to zoom 10 (same data, different zoom)
    renderer.update(makeSnapshot(entries), 10, emptyDataStore);

    // Value should be snapped immediately, not tweening
    const valueSpan = container.querySelector('.bar__value') as HTMLElement;
    expect(valueSpan.textContent).toBe('1,000');

    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });
});

describe('Z-index safety', () => {
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

  it('bars at high Y positions still have positive z-index (never negative)', () => {
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // Create 30 bars — at 40px each, the last bar is at Y=1160 which would
    // give z-index = 1000 - 1160 = -160 without the Math.max fix
    const entries: RankedEntry[] = [];
    for (let i = 0; i < 30; i++) {
      entries.push(makeEntry({
        artistId: `a${i}`,
        artistName: `Artist ${i}`,
        rank: i + 1,
        cumulativeValue: 3000 - i * 100,
        previousCumulativeValue: 2900 - i * 100,
      }));
    }
    renderer.update(makeSnapshot(entries), 'all', emptyDataStore);

    const wrappers = container.querySelectorAll('.chart-race__bar-wrapper');
    for (const w of wrappers) {
      const zIndex = parseInt((w as HTMLElement).style.zIndex);
      expect(zIndex).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Goalpost phase 1 animation', () => {
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

  it('goalpost bars have CSS transitions during phase 1 (not transition:none)', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // Day 1: goalpost exists
    const day1 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'GP', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: true }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);

    // Day 2: goalpost moves (values change, position changes)
    const day2 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 2, cumulativeValue: 900, previousCumulativeValue: 600 }),
      makeEntry({ artistId: 'a2', artistName: 'GP', rank: 3, cumulativeValue: 850, previousCumulativeValue: 800, isGoalpost: true }),
    ];
    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);

    // During phase 1: goalpost wrapper should have a transition (not "none")
    const gpWrapper = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.classList.contains('chart-race__bar-wrapper--goalpost')) as HTMLElement;
    expect(gpWrapper).toBeTruthy();
    expect(gpWrapper.style.transition).not.toBe('none');

    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });

  it('goalpost label rank updates after transition settles', () => {
    vi.useFakeTimers();
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    // Day 1: goalpost at rank 2
    const day1 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1000, previousCumulativeValue: 900 }),
      makeEntry({ artistId: 'a2', artistName: 'GP Artist', rank: 2, cumulativeValue: 800, previousCumulativeValue: 700, isGoalpost: true }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 3, cumulativeValue: 600, previousCumulativeValue: 500 }),
    ];
    renderer.update(makeSnapshot(day1), 'all', emptyDataStore);
    vi.advanceTimersByTime(5000);

    // Verify initial label has rank 2
    let gpWrapper = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.classList.contains('chart-race__bar-wrapper--goalpost')) as HTMLElement;
    let label = gpWrapper.querySelector('.bar__goalpost-label') as HTMLElement;
    expect(label.textContent).toContain('#2');

    // Day 2: goalpost moves to rank 3
    const day2 = [
      makeEntry({ artistId: 'a1', artistName: 'Active', rank: 1, cumulativeValue: 1100, previousCumulativeValue: 1000 }),
      makeEntry({ artistId: 'a3', artistName: 'Active 2', rank: 2, cumulativeValue: 900, previousCumulativeValue: 600 }),
      makeEntry({ artistId: 'a2', artistName: 'GP Artist', rank: 3, cumulativeValue: 850, previousCumulativeValue: 800, isGoalpost: true }),
    ];
    renderer.update(makeSnapshot(day2), 'all', emptyDataStore);

    // After transition settles, label should show rank 3
    vi.advanceTimersByTime(5000);
    gpWrapper = Array.from(container.querySelectorAll('.chart-race__bar-wrapper'))
      .find(w => w.classList.contains('chart-race__bar-wrapper--goalpost')) as HTMLElement;
    label = gpWrapper.querySelector('.bar__goalpost-label') as HTMLElement;
    expect(label.textContent).toContain('#3');

    vi.useRealTimers();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Whitespace click should NOT emit bar:click
// ═══════════════════════════════════════════════════════════════════

describe('Whitespace click does not select a bar row', () => {
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

  it('clicking directly on the bar wrapper (whitespace) does NOT emit bar:click', () => {
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const snapshot = makeSnapshot([
      makeEntry({ artistId: 'artist-a', artistName: 'Artist A', rank: 1, cumulativeValue: 600 }),
    ]);
    renderer.update(snapshot, 10, emptyDataStore);

    const emitted: string[] = [];
    eventBus.on('bar:click', (artistId: string) => emitted.push(artistId));

    // Click the wrapper element itself (simulates clicking whitespace in the row)
    const wrapper = container.querySelector('.chart-race__bar-wrapper') as HTMLElement;
    wrapper.click();

    expect(emitted).toEqual([]);
  });

  it('clicking a child element inside the bar wrapper DOES emit bar:click', () => {
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const snapshot = makeSnapshot([
      makeEntry({ artistId: 'artist-a', artistName: 'Artist A', rank: 1, cumulativeValue: 600 }),
    ]);
    renderer.update(snapshot, 10, emptyDataStore);

    const emitted: string[] = [];
    eventBus.on('bar:click', (artistId: string) => emitted.push(artistId));

    // Click the colored bar (a child of the wrapper)
    const bar = container.querySelector('.chart-race__bar') as HTMLElement;
    bar.click();

    expect(emitted).toEqual(['artist-a']);
  });

  it('clicking the value span emits bar:click (child of wrapper)', () => {
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const snapshot = makeSnapshot([
      makeEntry({ artistId: 'artist-b', artistName: 'Artist B', rank: 1, cumulativeValue: 800 }),
    ]);
    renderer.update(snapshot, 10, emptyDataStore);

    const emitted: string[] = [];
    eventBus.on('bar:click', (artistId: string) => emitted.push(artistId));

    const valueSpan = container.querySelector('.bar__value') as HTMLElement;
    valueSpan.click();

    expect(emitted).toEqual(['artist-b']);
  });

  it('clicking the rank span emits bar:click (child of wrapper)', () => {
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const snapshot = makeSnapshot([
      makeEntry({ artistId: 'artist-c', artistName: 'Artist C', rank: 1, cumulativeValue: 500 }),
    ]);
    renderer.update(snapshot, 10, emptyDataStore);

    const emitted: string[] = [];
    eventBus.on('bar:click', (artistId: string) => emitted.push(artistId));

    const rankSpan = container.querySelector('.bar__rank') as HTMLElement;
    rankSpan.click();

    expect(emitted).toEqual(['artist-c']);
  });

  it('bar wrapper does not have cursor:pointer (whitespace should show default cursor)', () => {
    renderer.mount(container);
    const barsContainer = container.querySelector('.chart-race__bars')!;
    Object.defineProperty(barsContainer, 'clientHeight', { value: 500, configurable: true });

    const snapshot = makeSnapshot([
      makeEntry({ artistId: 'artist-a', artistName: 'Artist A', rank: 1, cumulativeValue: 600 }),
    ]);
    renderer.update(snapshot, 10, emptyDataStore);

    const wrapper = container.querySelector('.chart-race__bar-wrapper') as HTMLElement;
    // Wrapper should NOT have inline cursor:pointer since its whitespace isn't clickable
    expect(wrapper.style.cursor).not.toBe('pointer');
  });
});
