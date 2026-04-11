/**
 * Unit tests for Feature 0014: Chart Display Improvements
 * Tests dedup tie-breaking, dateMinus365 leap year, rank badge class, logo toggle CSS class.
 */

import { computeChartWins } from '../../src/chart-engine.ts';
import { dateMinus365, filterByActivity, filterByZoom } from '../../src/utils.ts';
import { ChartRaceRenderer } from '../../src/chart-race-renderer.ts';
import { EventBus } from '../../src/event-bus.ts';
import type { DataStore, ParsedArtist, RankedEntry, ChartSnapshot } from '../../src/models.ts';
import type { DailyValueEntry } from '../../src/types.ts';

const emptyDataStore: DataStore = { artists: new Map(), dates: [], startDate: '', endDate: '', chartWins: new Map() };

function makeEntry(overrides: Partial<RankedEntry> = {}): RankedEntry {
  return {
    artistId: 'artist-1',
    artistName: 'Test Artist',
    artistType: 'boy_group',
    generation: 4,
    logoUrl: 'assets/logos/test.svg',
    cumulativeValue: 500,
    previousCumulativeValue: 400,
    dailyValue: 100,
    rank: 1,
    previousRank: 1,
    featuredRelease: { title: 'Song', releaseId: 'song' },
    ...overrides,
  };
}

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

// ============================================================
// Dedup tie-breaking: first release encountered wins — Req 1.3
// ============================================================

describe('Dedup tie-breaking', () => {
  it('when two releases have the same value, the first encountered wins', () => {
    const date = '2024-06-01';
    const source = 'inkigayo';

    const artist: ParsedArtist = {
      id: 'tie-artist',
      name: 'Tie Artist',
      artistType: 'boy_group',
      generation: 4,
      logoUrl: 'assets/logos/tie.svg',
      releases: [
        {
          id: 'release-first',
          title: 'First Song',
          dailyValues: new Map([[date, { value: 500, source, episode: 1 }]]),
          embeds: new Map(),
        },
        {
          id: 'release-second',
          title: 'Second Song',
          dailyValues: new Map([[date, { value: 500, source, episode: 1 }]]),
          embeds: new Map(),
        },
      ],
    };

    const dataStore: DataStore = {
      artists: new Map([['tie-artist', artist]]),
      dates: [date],
      startDate: date,
      endDate: date,
      chartWins: new Map(),
    };

    const chartWins = computeChartWins(dataStore);
    const dateResult = chartWins.get(date);
    expect(dateResult).toBeDefined();

    const sourceResult = dateResult!.get(source);
    expect(sourceResult).toBeDefined();
    expect(sourceResult!.artistIds).toContain('tie-artist');
    // Crown level should be 1 (only one win, not two)
    expect(sourceResult!.crownLevels.get('tie-artist')).toBe(1);
  });
});

// ============================================================
// dateMinus365 with leap year boundary
// ============================================================

describe('dateMinus365', () => {
  it('handles leap year correctly (2024-03-01 minus 365 = 2023-03-02)', () => {
    // 2024 is a leap year, so 2024-03-01 minus 365 days = 2023-03-02
    const result = dateMinus365('2024-03-01');
    expect(result).toBe('2023-03-02');
  });

  it('handles non-leap year correctly (2023-03-01 minus 365 = 2022-03-01)', () => {
    const result = dateMinus365('2023-03-01');
    expect(result).toBe('2022-03-01');
  });

  it('handles year boundary (2024-01-01 minus 365 = 2023-01-01)', () => {
    // 2023 is not a leap year, so 365 days before 2024-01-01 = 2023-01-01
    const result = dateMinus365('2024-01-01');
    expect(result).toBe('2023-01-01');
  });
});

// ============================================================
// Rank badge CSS class is bar__rank — Req 3.3
// ============================================================

describe('Rank badge', () => {
  it('rank badge has CSS class bar__rank', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const eventBus = new EventBus();
    const renderer = new ChartRaceRenderer(eventBus);
    renderer.mount(container);

    const snapshot: ChartSnapshot = {
      date: '2024-06-01',
      entries: [makeEntry({ rank: 3 })],
    };
    renderer.update(snapshot, 10, emptyDataStore);

    const rankBadge = container.querySelector('.bar__rank');
    expect(rankBadge).not.toBeNull();
    expect(rankBadge!.className).toBe('bar__rank');
    expect(rankBadge!.textContent).toBe('#3');

    renderer.destroy();
    container.remove();
  });

  it('rank badge is positioned before the logo in the bar', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const eventBus = new EventBus();
    const renderer = new ChartRaceRenderer(eventBus);
    renderer.mount(container);

    const snapshot: ChartSnapshot = {
      date: '2024-06-01',
      entries: [makeEntry()],
    };
    renderer.update(snapshot, 10, emptyDataStore);

    const bar = container.querySelector('.chart-race__bar')!;
    const children = Array.from(bar.children);
    const rankIndex = children.findIndex((el) => el.classList.contains('bar__rank'));
    const logoIndex = children.findIndex((el) => el.classList.contains('bar__logo'));

    expect(rankIndex).toBeLessThan(logoIndex);

    renderer.destroy();
    container.remove();
  });
});

// ============================================================
// Logo toggle uses CSS class not style.display — Req 4.5
// ============================================================

describe('Logo visibility toggle', () => {
  it('uses bar__logo--hidden CSS class, not style.display', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const eventBus = new EventBus();
    const renderer = new ChartRaceRenderer(eventBus);
    renderer.mount(container);

    const entries = [makeEntry({ artistId: 'logo-test', rank: 1 })];
    const snapshot: ChartSnapshot = { date: '2024-06-01', entries };

    // Render at zoom "all" — logos should be hidden via CSS class
    renderer.update(snapshot, 'all', emptyDataStore);

    const logo = container.querySelector('.bar__logo') as HTMLElement;
    expect(logo.classList.contains('bar__logo--hidden')).toBe(true);
    // Should NOT use inline style.display
    expect(logo.style.display).toBe('');

    renderer.destroy();
    container.remove();
  });

  it('zoom 10 → all → 10 transitions toggle class correctly', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const eventBus = new EventBus();
    const renderer = new ChartRaceRenderer(eventBus);
    renderer.mount(container);

    const entries = [makeEntry({ artistId: 'toggle-test', rank: 1 })];
    const snapshot: ChartSnapshot = { date: '2024-06-01', entries };
    const ds = makeDataStoreForEntries(entries);

    // Zoom 10 — visible
    renderer.update(snapshot, 10, ds);
    let logo = container.querySelector('.bar__logo') as HTMLElement;
    expect(logo.classList.contains('bar__logo--hidden')).toBe(false);

    // Zoom "all" — hidden
    renderer.update(snapshot, 'all', ds);
    logo = container.querySelector('.bar__logo') as HTMLElement;
    expect(logo.classList.contains('bar__logo--hidden')).toBe(true);

    // Zoom 10 — visible again
    renderer.update(snapshot, 10, ds);
    logo = container.querySelector('.bar__logo') as HTMLElement;
    expect(logo.classList.contains('bar__logo--hidden')).toBe(false);

    renderer.destroy();
    container.remove();
  });
});
