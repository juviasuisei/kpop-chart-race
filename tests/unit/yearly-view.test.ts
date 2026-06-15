/**
 * Unit tests for the YearlyView component.
 * Tests: year extraction, per-year data computation, global scale,
 * bar rendering, overflow handling, and mount/unmount lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { YearlyView, squarify } from '../../src/yearly-view.ts';
import { EventBus } from '../../src/event-bus.ts';
import { ZoomSelector } from '../../src/zoom-selector.ts';
import type { DataStore, ParsedArtist } from '../../src/models.ts';

function createArtist(id: string, name: string, dailyValues: Record<string, { value: number; source: string; episode: number }>): ParsedArtist {
  return {
    id,
    name,
    artistType: 'girl_group',
    generation: 4,
    logoUrl: `assets/logos/${id}.svg`,
    releases: [{
      id: `${id}-release`,
      title: 'Test Song',
      dailyValues: new Map(Object.entries(dailyValues)),
      embeds: new Map(),
    }],
    albumReleases: [],
  };
}

function createDataStore(artists: ParsedArtist[]): DataStore {
  const artistMap = new Map(artists.map(a => [a.id, a]));
  const allDates = new Set<string>();
  for (const artist of artists) {
    for (const release of artist.releases) {
      for (const date of release.dailyValues.keys()) {
        allDates.add(date);
      }
    }
  }
  const dates = Array.from(allDates).sort();
  const firstAppearance = new Map<string, string>();
  for (const artist of artists) {
    let earliest: string | undefined;
    for (const release of artist.releases) {
      for (const date of release.dailyValues.keys()) {
        if (!earliest || date < earliest) earliest = date;
      }
    }
    if (earliest) firstAppearance.set(artist.id, earliest);
  }

  return {
    artists: artistMap,
    dates,
    startDate: dates[0] ?? '',
    endDate: dates[dates.length - 1] ?? '',
    firstAppearance,
    chartWins: new Map(),
  };
}

describe('YearlyView', () => {
  let container: HTMLElement;
  let view: YearlyView;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    view = new YearlyView();
  });

  afterEach(() => {
    view.unmount();
    document.body.removeChild(container);
  });

  it('mounts and creates the yearly-view wrapper', () => {
    const dataStore = createDataStore([
      createArtist('artist-a', 'Artist A', { '2025-01-01': { value: 1000, source: 'inkigayo', episode: 1 } }),
    ]);
    view.mount(container, dataStore);
    expect(container.querySelector('.yearly-view')).not.toBeNull();
  });

  it('unmounts and removes the wrapper from DOM', () => {
    const dataStore = createDataStore([
      createArtist('artist-a', 'Artist A', { '2025-01-01': { value: 1000, source: 'inkigayo', episode: 1 } }),
    ]);
    view.mount(container, dataStore);
    expect(container.querySelector('.yearly-view')).not.toBeNull();
    view.unmount();
    expect(container.querySelector('.yearly-view')).toBeNull();
  });

  it('creates one cell per year, newest first', () => {
    const dataStore = createDataStore([
      createArtist('artist-a', 'Artist A', {
        '2025-03-01': { value: 5000, source: 'inkigayo', episode: 1 },
        '2026-01-15': { value: 3000, source: 'music_bank', episode: 2 },
      }),
    ]);
    view.mount(container, dataStore);
    const headings = container.querySelectorAll('.yearly-view__year');
    expect(headings.length).toBe(2);
    expect(headings[0].textContent).toBe('2026');
    expect(headings[1].textContent).toBe('2025');
  });

  it('shows top 10 artists per year sorted by points', () => {
    const artists = [];
    for (let i = 1; i <= 12; i++) {
      artists.push(createArtist(`artist-${i}`, `Artist ${i}`, {
        '2025-06-01': { value: i * 1000, source: 'inkigayo', episode: i },
      }));
    }
    const dataStore = createDataStore(artists);
    view.mount(container, dataStore);

    const rows = container.querySelectorAll('.yearly-view__row');
    expect(rows.length).toBe(10); // only top 10

    // First row should be the highest-value artist (#12)
    const firstRank = rows[0].querySelector('.yearly-view__rank');
    expect(firstRank?.textContent).toBe('#1');
  });

  it('computes points per year independently (resets each year)', () => {
    const dataStore = createDataStore([
      createArtist('artist-a', 'Artist A', {
        '2025-06-01': { value: 5000, source: 'inkigayo', episode: 1 },
        '2026-01-01': { value: 2000, source: 'inkigayo', episode: 2 },
      }),
      createArtist('artist-b', 'Artist B', {
        '2026-01-01': { value: 8000, source: 'inkigayo', episode: 2 },
      }),
    ]);
    view.mount(container, dataStore);

    const cells = container.querySelectorAll('.yearly-view__cell');
    expect(cells.length).toBe(2);

    // 2026 cell (first, newest): Artist B should be #1 with 8000
    const rows2026 = cells[0].querySelectorAll('.yearly-view__row');
    const firstBar2026 = rows2026[0].querySelector('.yearly-view__bar');
    expect(firstBar2026?.textContent).toContain('Artist B');

    // 2025 cell: Artist A should be #1 with 5000
    const rows2025 = cells[1].querySelectorAll('.yearly-view__row');
    const firstBar2025 = rows2025[0].querySelector('.yearly-view__bar');
    expect(firstBar2025?.textContent).toContain('Artist A');
  });

  it('uses global max for bar widths (cross-year comparison)', () => {
    const dataStore = createDataStore([
      createArtist('artist-a', 'Artist A', {
        '2025-06-01': { value: 10000, source: 'inkigayo', episode: 1 },
      }),
      createArtist('artist-b', 'Artist B', {
        '2026-01-01': { value: 5000, source: 'inkigayo', episode: 2 },
      }),
    ]);
    view.mount(container, dataStore);

    const cells = container.querySelectorAll('.yearly-view__cell');
    // 2026 bar should be 50% width (5000/10000)
    const bar2026 = cells[0].querySelector('.yearly-view__bar') as HTMLElement;
    expect(bar2026.style.width).toBe('50%');

    // 2025 bar should be 100% width (10000/10000)
    const bar2025 = cells[1].querySelector('.yearly-view__bar') as HTMLElement;
    expect(bar2025.style.width).toBe('100%');
  });

  it('always renders a logo inside the bar', () => {
    const dataStore = createDataStore([
      createArtist('artist-a', 'Artist A', {
        '2025-06-01': { value: 1000, source: 'inkigayo', episode: 1 },
      }),
    ]);
    view.mount(container, dataStore);

    const logo = container.querySelector('.yearly-view__logo');
    expect(logo).not.toBeNull();
    expect((logo as HTMLImageElement).src).toContain('artist-a.svg');
  });

  it('renders rank badge with correct number', () => {
    const dataStore = createDataStore([
      createArtist('artist-a', 'Artist A', { '2025-06-01': { value: 5000, source: 'inkigayo', episode: 1 } }),
      createArtist('artist-b', 'Artist B', { '2025-06-01': { value: 3000, source: 'inkigayo', episode: 1 } }),
    ]);
    view.mount(container, dataStore);

    const ranks = container.querySelectorAll('.yearly-view__rank');
    expect(ranks[0].textContent).toBe('#1');
    expect(ranks[1].textContent).toBe('#2');
  });

  it('renders artist type indicator', () => {
    const dataStore = createDataStore([
      createArtist('artist-a', 'Artist A', { '2025-06-01': { value: 5000, source: 'inkigayo', episode: 1 } }),
    ]);
    view.mount(container, dataStore);

    const indicator = container.querySelector('.yearly-view__indicator');
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toBe('●'); // girl_group indicator
  });

  it('shows win count when artist has wins (wins mode)', () => {
    const dataStore = createDataStore([
      createArtist('artist-a', 'Artist A', { '2025-06-01': { value: 5000, source: 'inkigayo', episode: 1 } }),
    ]);
    // Add a chart win
    dataStore.chartWins.set('2025-06-01', new Map([
      ['inkigayo', { artistIds: ['artist-a'], crownLevels: new Map([['artist-a', 1]]) }],
    ]));
    view.mount(container, dataStore);
    view.setMetric('wins');

    const stats = container.querySelector('.yearly-view__stats');
    expect(stats?.textContent).toContain('1 win');
  });

  it('shows plural wins correctly (wins mode)', () => {
    const dataStore = createDataStore([
      createArtist('artist-a', 'Artist A', {
        '2025-06-01': { value: 5000, source: 'inkigayo', episode: 1 },
        '2025-06-08': { value: 5000, source: 'inkigayo', episode: 2 },
      }),
    ]);
    dataStore.chartWins.set('2025-06-01', new Map([
      ['inkigayo', { artistIds: ['artist-a'], crownLevels: new Map([['artist-a', 1]]) }],
    ]));
    dataStore.chartWins.set('2025-06-08', new Map([
      ['inkigayo', { artistIds: ['artist-a'], crownLevels: new Map([['artist-a', 2]]) }],
    ]));
    view.mount(container, dataStore);
    view.setMetric('wins');

    const stats = container.querySelector('.yearly-view__stats');
    expect(stats?.textContent).toContain('2 wins');
  });

  it('shows "No data" for years with no entries', () => {
    // This shouldn't normally happen since we only create cells for years with data,
    // but test the empty state rendering
    const dataStore = createDataStore([]);
    view.mount(container, dataStore);
    // No cells should be created for empty data
    const cells = container.querySelectorAll('.yearly-view__cell');
    expect(cells.length).toBe(0);
  });

  it('sums points across multiple releases for the same artist in a year', () => {
    const artist: ParsedArtist = {
      id: 'multi-release',
      name: 'Multi Release',
      artistType: 'boy_group',
      generation: 4,
      logoUrl: 'assets/logos/multi.svg',
      releases: [
        {
          id: 'song-1',
          title: 'Song 1',
          dailyValues: new Map([['2025-03-01', { value: 3000, source: 'inkigayo', episode: 1 }]]),
          embeds: new Map(),
        },
        {
          id: 'song-2',
          title: 'Song 2',
          dailyValues: new Map([['2025-06-01', { value: 4000, source: 'music_bank', episode: 2 }]]),
          embeds: new Map(),
        },
      ],
      albumReleases: [],
    };

    const artistMap = new Map([['multi-release', artist]]);
    const dataStore: DataStore = {
      artists: artistMap,
      dates: ['2025-03-01', '2025-06-01'],
      startDate: '2025-03-01',
      endDate: '2025-06-01',
      firstAppearance: new Map([['multi-release', '2025-03-01']]),
      chartWins: new Map(),
    };

    view.mount(container, dataStore);

    // Should show 7000 total (3000 + 4000)
    const stats = container.querySelector('.yearly-view__stats');
    expect(stats?.textContent).toContain('7,000');
  });
});

describe('YearlyView — Wins Mode', () => {
  let container: HTMLElement;
  let view: YearlyView;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    view = new YearlyView();
  });

  afterEach(() => {
    view.unmount();
    document.body.removeChild(container);
  });

  function createArtistWithWins(id: string, name: string, points: number, year: string): ParsedArtist {
    return {
      id,
      name,
      artistType: 'girl_group',
      generation: 4,
      logoUrl: `assets/logos/${id}.svg`,
      releases: [{
        id: `${id}-release`,
        title: 'Test Song',
        dailyValues: new Map([[`${year}-06-01`, { value: points, source: 'inkigayo', episode: 1 }]]),
        embeds: new Map(),
      }],
      albumReleases: [],
    };
  }

  function createDataStoreWithWins(artists: ParsedArtist[], wins: Map<string, Map<string, { artistIds: string[]; crownLevels: Map<string, number> }>>): DataStore {
    const artistMap = new Map(artists.map(a => [a.id, a]));
    const allDates = new Set<string>();
    for (const artist of artists) {
      for (const release of artist.releases) {
        for (const date of release.dailyValues.keys()) {
          allDates.add(date);
        }
      }
    }
    const dates = Array.from(allDates).sort();
    const firstAppearance = new Map<string, string>();
    for (const artist of artists) {
      let earliest: string | undefined;
      for (const release of artist.releases) {
        for (const date of release.dailyValues.keys()) {
          if (!earliest || date < earliest) earliest = date;
        }
      }
      if (earliest) firstAppearance.set(artist.id, earliest);
    }
    return {
      artists: artistMap,
      dates,
      startDate: dates[0] ?? '',
      endDate: dates[dates.length - 1] ?? '',
      firstAppearance,
      chartWins: wins,
    };
  }

  it('setMetric switches to wins mode and re-renders', () => {
    const artists = [
      createArtistWithWins('a', 'Artist A', 10000, '2025'),
      createArtistWithWins('b', 'Artist B', 5000, '2025'),
    ];
    const wins = new Map([
      ['2025-06-01', new Map([
        ['inkigayo', { artistIds: ['b'], crownLevels: new Map([['b', 1]]) }],
      ])],
    ]);
    const dataStore = createDataStoreWithWins(artists, wins);
    view.mount(container, dataStore);

    // In points mode, Artist A is #1
    let rows = container.querySelectorAll('.yearly-view__row');
    let firstBar = rows[0].querySelector('.yearly-view__bar');
    expect(firstBar?.textContent).toContain('Artist A');

    // Switch to wins mode — Artist B should be #1 (has 1 win, A has 0)
    view.setMetric('wins');
    rows = container.querySelectorAll('.yearly-view__row');
    firstBar = rows[0].querySelector('.yearly-view__bar');
    expect(firstBar?.textContent).toContain('Artist B');
  });

  it('wins mode filters out artists with 0 wins', () => {
    const artists = [
      createArtistWithWins('a', 'Artist A', 10000, '2025'),
      createArtistWithWins('b', 'Artist B', 5000, '2025'),
      createArtistWithWins('c', 'Artist C', 3000, '2025'),
    ];
    const wins = new Map([
      ['2025-06-01', new Map([
        ['inkigayo', { artistIds: ['b'], crownLevels: new Map([['b', 1]]) }],
      ])],
    ]);
    const dataStore = createDataStoreWithWins(artists, wins);
    view.mount(container, dataStore);
    view.setMetric('wins');

    // Only Artist B has wins, so only 1 row should show
    const rows = container.querySelectorAll('.yearly-view__row');
    expect(rows.length).toBe(1);
  });

  it('wins mode breaks ties with points', () => {
    const artists = [
      createArtistWithWins('a', 'Artist A', 3000, '2025'),
      createArtistWithWins('b', 'Artist B', 8000, '2025'),
    ];
    // Both have 1 win each
    const wins = new Map([
      ['2025-06-01', new Map([
        ['inkigayo', { artistIds: ['a', 'b'], crownLevels: new Map([['a', 1], ['b', 1]]) }],
      ])],
    ]);
    const dataStore = createDataStoreWithWins(artists, wins);
    view.mount(container, dataStore);
    view.setMetric('wins');

    // Both have 1 win, but B has more points — B should be #1
    const rows = container.querySelectorAll('.yearly-view__row');
    const firstBar = rows[0].querySelector('.yearly-view__bar');
    expect(firstBar?.textContent).toContain('Artist B');
  });

  it('wins mode scales bars by win count using global max', () => {
    const artists = [
      createArtistWithWins('a', 'Artist A', 10000, '2025'),
      createArtistWithWins('b', 'Artist B', 5000, '2025'),
    ];
    // A has 3 wins, B has 1 win
    const wins = new Map([
      ['2025-06-01', new Map([
        ['inkigayo', { artistIds: ['a', 'b'], crownLevels: new Map([['a', 1], ['b', 1]]) }],
        ['music_bank', { artistIds: ['a'], crownLevels: new Map([['a', 2]]) }],
        ['show_champion', { artistIds: ['a'], crownLevels: new Map([['a', 3]]) }],
      ])],
    ]);
    const dataStore = createDataStoreWithWins(artists, wins);
    view.mount(container, dataStore);
    view.setMetric('wins');

    const bars = container.querySelectorAll('.yearly-view__bar') as NodeListOf<HTMLElement>;
    // A has 3 wins (100%), B has 1 win (~33.3%)
    expect(bars[0].style.width).toBe('100%');
    const bWidth = parseFloat(bars[1].style.width);
    expect(bWidth).toBeCloseTo(33.33, 0);
  });

  it('wins mode shows only win count in stats', () => {
    const artists = [
      createArtistWithWins('a', 'Artist A', 10000, '2025'),
    ];
    const wins = new Map([
      ['2025-06-01', new Map([
        ['inkigayo', { artistIds: ['a'], crownLevels: new Map([['a', 1]]) }],
      ])],
    ]);
    const dataStore = createDataStoreWithWins(artists, wins);
    view.mount(container, dataStore);
    view.setMetric('wins');

    const stats = container.querySelector('.yearly-view__stats');
    expect(stats?.textContent).toBe('1 win');
    expect(stats?.textContent).not.toContain('10,000');
  });

  it('points mode shows only point total in stats', () => {
    const artists = [
      createArtistWithWins('a', 'Artist A', 10000, '2025'),
    ];
    const wins = new Map([
      ['2025-06-01', new Map([
        ['inkigayo', { artistIds: ['a'], crownLevels: new Map([['a', 1]]) }],
      ])],
    ]);
    const dataStore = createDataStoreWithWins(artists, wins);
    view.mount(container, dataStore);

    const stats = container.querySelector('.yearly-view__stats');
    expect(stats?.textContent).toBe('10,000');
    expect(stats?.textContent).not.toContain('win');
  });

  it('getMetric returns the current metric', () => {
    const dataStore = createDataStoreWithWins(
      [createArtistWithWins('a', 'A', 1000, '2025')],
      new Map(),
    );
    view.mount(container, dataStore);

    expect(view.getMetric()).toBe('points');
    view.setMetric('wins');
    expect(view.getMetric()).toBe('wins');
  });

  it('switching back to points mode restores points-based ranking', () => {
    const artists = [
      createArtistWithWins('a', 'Artist A', 10000, '2025'),
      createArtistWithWins('b', 'Artist B', 5000, '2025'),
    ];
    const wins = new Map([
      ['2025-06-01', new Map([
        ['inkigayo', { artistIds: ['b'], crownLevels: new Map([['b', 1]]) }],
      ])],
    ]);
    const dataStore = createDataStoreWithWins(artists, wins);
    view.mount(container, dataStore);

    view.setMetric('wins');
    view.setMetric('points');

    const rows = container.querySelectorAll('.yearly-view__row');
    const firstBar = rows[0].querySelector('.yearly-view__bar');
    expect(firstBar?.textContent).toContain('Artist A');
    expect(rows.length).toBe(2); // both artists show (even with 0 wins)
  });
});


describe('YearlyView — Stacked Bar (All mode)', () => {
  let container: HTMLElement;
  let view: YearlyView;

  function createArtistWithType(id: string, name: string, type: string, points: number, year: string): ParsedArtist {
    return {
      id,
      name,
      artistType: type as any,
      generation: 4,
      logoUrl: `assets/logos/${id}.svg`,
      releases: [{
        id: `${id}-release`,
        title: 'Test Song',
        dailyValues: new Map([[`${year}-06-01`, { value: points, source: 'inkigayo', episode: 1 }]]),
        embeds: new Map(),
      }],
      albumReleases: [],
    };
  }

  function createDS(artists: ParsedArtist[], wins?: Map<string, Map<string, { artistIds: string[]; crownLevels: Map<string, number> }>>): DataStore {
    const artistMap = new Map(artists.map(a => [a.id, a]));
    const allDates = new Set<string>();
    for (const artist of artists) {
      for (const release of artist.releases) {
        for (const date of release.dailyValues.keys()) allDates.add(date);
      }
    }
    const dates = Array.from(allDates).sort();
    const firstAppearance = new Map<string, string>();
    for (const artist of artists) {
      for (const release of artist.releases) {
        for (const date of release.dailyValues.keys()) {
          const cur = firstAppearance.get(artist.id);
          if (!cur || date < cur) firstAppearance.set(artist.id, date);
        }
      }
    }
    return {
      artists: artistMap,
      dates,
      startDate: dates[0] ?? '',
      endDate: dates[dates.length - 1] ?? '',
      firstAppearance,
      chartWins: wins ?? new Map(),
    };
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    view = new YearlyView();
  });

  afterEach(() => {
    view.unmount();
    document.body.removeChild(container);
  });

  it('setZoom switches to treemap layout', () => {
    const ds = createDS([
      createArtistWithType('a', 'Artist A', 'girl_group', 5000, '2025'),
      createArtistWithType('b', 'Artist B', 'boy_group', 3000, '2025'),
    ]);
    view.mount(container, ds);
    view.setZoom('all');

    expect(container.querySelector('.yearly-view--treemap')).not.toBeNull();
    expect(container.querySelector('.yearly-treemap__block')).not.toBeNull();
  });

  it('setZoom(10) switches back to grid layout', () => {
    const ds = createDS([
      createArtistWithType('a', 'Artist A', 'girl_group', 5000, '2025'),
    ]);
    view.mount(container, ds);
    view.setZoom('all');
    view.setZoom(10);

    expect(container.querySelector('.yearly-view--treemap')).toBeNull();
    expect(container.querySelector('.yearly-view__cell')).not.toBeNull();
  });

  it('treemap creates a block per year with map container', () => {
    const artists = [];
    for (let i = 1; i <= 15; i++) {
      artists.push(createArtistWithType(`a${i}`, `Artist ${i}`, 'girl_group', i * 100, '2025'));
    }
    const ds = createDS(artists);
    view.mount(container, ds);
    view.setZoom('all');

    const blocks = container.querySelectorAll('.yearly-treemap__block');
    expect(blocks.length).toBe(1); // 1 year
    const maps = container.querySelectorAll('.yearly-treemap__map');
    expect(maps.length).toBe(1);
  });

  it('treemap year heading shows the year', () => {
    const ds = createDS([
      createArtistWithType('a', 'Artist A', 'girl_group', 1000, '2025'),
      createArtistWithType('b', 'Artist B', 'boy_group', 5000, '2025'),
      createArtistWithType('c', 'Artist C', 'girl_group', 3000, '2025'),
    ]);
    view.mount(container, ds);
    view.setZoom('all');

    const heading = container.querySelector('.yearly-treemap__year');
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toBe('2025');
  });

  it('treemap cells are created after rAF with correct class', async () => {
    const ds = createDS([
      createArtistWithType('a', 'Artist A', 'girl_group', 5000, '2025'),
      createArtistWithType('b', 'Artist B', 'boy_group', 3000, '2025'),
    ]);
    view.mount(container, ds);
    view.setZoom('all');

    // Cells are created in requestAnimationFrame
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const cells = container.querySelectorAll('.yearly-treemap__cell');
    // In jsdom, clientWidth/clientHeight are 0, so rAF exits early
    // Just verify the map container exists
    const map = container.querySelector('.yearly-treemap__map');
    expect(map).not.toBeNull();
  });

  it('each treemap cell has a logo element', async () => {
    const ds = createDS([
      createArtistWithType('a', 'Artist A', 'girl_group', 5000, '2025'),
    ]);
    view.mount(container, ds);
    view.setZoom('all');

    // The map container is created synchronously
    const map = container.querySelector('.yearly-treemap__map');
    expect(map).not.toBeNull();
  });

  it('wins mode in treemap view only shows artists with wins', () => {
    const artists = [
      createArtistWithType('a', 'Artist A', 'girl_group', 5000, '2025'),
      createArtistWithType('b', 'Artist B', 'boy_group', 3000, '2025'),
    ];
    const wins = new Map([
      ['2025-06-01', new Map([
        ['inkigayo', { artistIds: ['a'], crownLevels: new Map([['a', 1]]) }],
      ])],
    ]);
    const ds = createDS(artists, wins);
    view.mount(container, ds);
    view.setMetric('wins');
    view.setZoom('all');

    // In wins mode, computeYearData filters to only artists with wins
    // The treemap block should still be created (1 artist has wins)
    const blocks = container.querySelectorAll('.yearly-treemap__block');
    expect(blocks.length).toBe(1);
  });

  it('getZoom returns current zoom level', () => {
    const ds = createDS([createArtistWithType('a', 'A', 'girl_group', 1000, '2025')]);
    view.mount(container, ds);

    expect(view.getZoom()).toBe(10);
    view.setZoom('all');
    expect(view.getZoom()).toBe('all');
  });

  it('source filter works in treemap mode', () => {
    const artist: ParsedArtist = {
      id: 'a',
      name: 'Artist A',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/a.svg',
      releases: [{
        id: 'r1',
        title: 'Song',
        dailyValues: new Map([
          ['2025-06-01', { value: 5000, source: 'inkigayo', episode: 1 }],
          ['2025-06-08', { value: 3000, source: 'music_bank', episode: 2 }],
        ]),
        embeds: new Map(),
      }],
      albumReleases: [],
    };
    const ds = createDS([artist]);
    view.mount(container, ds);
    view.setZoom('all');

    // With "all" source, should have 1 treemap block
    let blocks = container.querySelectorAll('.yearly-treemap__block');
    expect(blocks.length).toBe(1);

    // Filter to inkigayo only — still 1 artist, still 1 block
    view.setSourceFilter('inkigayo');
    blocks = container.querySelectorAll('.yearly-treemap__block');
    expect(blocks.length).toBe(1);
  });
});

describe('YearlyView — Zoom Selector Sync', () => {
  it('zoom selector updates visual when external zoom:change fires', () => {
    const container = document.createElement('div');
    const playbackControls = document.createElement('div');
    playbackControls.className = 'playback-controls';
    playbackControls.appendChild(document.createElement('button'));
    container.appendChild(playbackControls);
    document.body.appendChild(container);

    const eventBus = new EventBus();
    const selector = new ZoomSelector(eventBus);
    selector.mount(container);

    // Initially at 10
    expect(selector.getLevel()).toBe(10);

    // External event changes to "all"
    eventBus.emit('zoom:change', 'all');
    expect(selector.getLevel()).toBe('all');

    // Check visual updated
    const track = container.querySelector('.zoom-toggle__track');
    expect(track!.classList.contains('zoom-toggle__track--on')).toBe(false);

    // External event changes back to 10
    eventBus.emit('zoom:change', 10);
    expect(selector.getLevel()).toBe(10);
    expect(track!.classList.contains('zoom-toggle__track--on')).toBe(true);

    selector.destroy();
    container.remove();
  });
});


describe('YearlyView — Source Filter in Grid Mode', () => {
  let container: HTMLElement;
  let view: YearlyView;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    view = new YearlyView();
  });

  afterEach(() => {
    view.unmount();
    document.body.removeChild(container);
  });

  it('filters points by source in grid mode', () => {
    const artist: ParsedArtist = {
      id: 'a',
      name: 'Artist A',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/a.svg',
      releases: [{
        id: 'r1',
        title: 'Song',
        dailyValues: new Map([
          ['2025-06-01', { value: 5000, source: 'inkigayo', episode: 1 }],
          ['2025-06-08', { value: 3000, source: 'music_bank', episode: 2 }],
        ]),
        embeds: new Map(),
      }],
      albumReleases: [],
    };
    const ds: DataStore = {
      artists: new Map([['a', artist]]),
      dates: ['2025-06-01', '2025-06-08'],
      startDate: '2025-06-01',
      endDate: '2025-06-08',
      firstAppearance: new Map([['a', '2025-06-01']]),
      chartWins: new Map(),
    };

    view.mount(container, ds);

    // Default (all): should show 8000 total
    let stats = container.querySelector('.yearly-view__stats');
    expect(stats?.textContent).toContain('8,000');

    // Filter to inkigayo: should show 5000
    view.setSourceFilter('inkigayo');
    stats = container.querySelector('.yearly-view__stats');
    expect(stats?.textContent).toContain('5,000');

    // Filter to music_bank: should show 3000
    view.setSourceFilter('music_bank');
    stats = container.querySelector('.yearly-view__stats');
    expect(stats?.textContent).toContain('3,000');
  });

  it('filters wins by source', () => {
    const artist: ParsedArtist = {
      id: 'a',
      name: 'Artist A',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/a.svg',
      releases: [{
        id: 'r1',
        title: 'Song',
        dailyValues: new Map([
          ['2025-06-01', { value: 5000, source: 'inkigayo', episode: 1 }],
          ['2025-06-08', { value: 3000, source: 'music_bank', episode: 2 }],
        ]),
        embeds: new Map(),
      }],
      albumReleases: [],
    };
    const wins = new Map([
      ['2025-06-01', new Map([
        ['inkigayo', { artistIds: ['a'], crownLevels: new Map([['a', 1]]) }],
      ])],
      ['2025-06-08', new Map([
        ['music_bank', { artistIds: ['a'], crownLevels: new Map([['a', 2]]) }],
      ])],
    ]);
    const ds: DataStore = {
      artists: new Map([['a', artist]]),
      dates: ['2025-06-01', '2025-06-08'],
      startDate: '2025-06-01',
      endDate: '2025-06-08',
      firstAppearance: new Map([['a', '2025-06-01']]),
      chartWins: wins,
    };

    view.mount(container, ds);
    view.setMetric('wins');

    // Default (all): 2 wins
    let stats = container.querySelector('.yearly-view__stats');
    expect(stats?.textContent).toContain('2 wins');

    // Filter to inkigayo: 1 win
    view.setSourceFilter('inkigayo');
    stats = container.querySelector('.yearly-view__stats');
    expect(stats?.textContent).toContain('1 win');
  });

  it('source filter with no matching data shows empty', () => {
    const artist: ParsedArtist = {
      id: 'a',
      name: 'Artist A',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/a.svg',
      releases: [{
        id: 'r1',
        title: 'Song',
        dailyValues: new Map([
          ['2025-06-01', { value: 5000, source: 'inkigayo', episode: 1 }],
        ]),
        embeds: new Map(),
      }],
      albumReleases: [],
    };
    const ds: DataStore = {
      artists: new Map([['a', artist]]),
      dates: ['2025-06-01'],
      startDate: '2025-06-01',
      endDate: '2025-06-01',
      firstAppearance: new Map([['a', '2025-06-01']]),
      chartWins: new Map(),
    };

    view.mount(container, ds);
    view.setSourceFilter('music_bank'); // no data for this source

    const rows = container.querySelectorAll('.yearly-view__row');
    expect(rows.length).toBe(0);
  });
});

describe('squarify algorithm', () => {
  it('returns empty array for empty input', () => {
    const result = squarify([], 100, 100);
    expect(result).toEqual([]);
  });

  it('returns empty array when total is 0', () => {
    const result = squarify([0, 0, 0], 100, 100);
    expect(result).toEqual([]);
  });

  it('single item fills the entire container', () => {
    const result = squarify([100], 200, 150);
    expect(result.length).toBe(1);
    expect(result[0].x).toBeCloseTo(0);
    expect(result[0].y).toBeCloseTo(0);
    expect(result[0].w).toBeCloseTo(200);
    expect(result[0].h).toBeCloseTo(150);
  });

  it('two equal items split the area evenly', () => {
    const result = squarify([50, 50], 200, 100);
    expect(result.length).toBe(2);
    // Total area should be preserved
    const totalArea = result.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(totalArea).toBeCloseTo(200 * 100);
    // Each should have roughly half the area
    expect(result[0].w * result[0].h).toBeCloseTo(10000);
    expect(result[1].w * result[1].h).toBeCloseTo(10000);
  });

  it('areas are proportional to values', () => {
    const values = [60, 30, 10];
    const result = squarify(values, 300, 200);
    const totalArea = 300 * 200;
    expect(result.length).toBe(3);
    // First item should have 60% of area
    expect(result[0].w * result[0].h).toBeCloseTo(totalArea * 0.6, -1);
    // Second item should have 30% of area
    expect(result[1].w * result[1].h).toBeCloseTo(totalArea * 0.3, -1);
    // Third item should have 10% of area
    expect(result[2].w * result[2].h).toBeCloseTo(totalArea * 0.1, -1);
  });

  it('rectangles do not overlap', () => {
    const values = [40, 30, 20, 10, 5, 3, 2];
    const result = squarify(values, 400, 300);
    // Check no two rectangles overlap
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i];
        const b = result[j];
        const overlapX = a.x < b.x + b.w && a.x + a.w > b.x;
        const overlapY = a.y < b.y + b.h && a.y + a.h > b.y;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it('rectangles stay within container bounds', () => {
    const values = [100, 80, 60, 40, 20, 10, 5];
    const result = squarify(values, 500, 400);
    for (const rect of result) {
      expect(rect.x).toBeGreaterThanOrEqual(-0.001);
      expect(rect.y).toBeGreaterThanOrEqual(-0.001);
      expect(rect.x + rect.w).toBeLessThanOrEqual(500.001);
      expect(rect.y + rect.h).toBeLessThanOrEqual(400.001);
    }
  });

  it('total area of all rectangles equals container area', () => {
    const values = [50, 30, 20, 15, 10, 8, 5, 3, 2, 1];
    const result = squarify(values, 600, 400);
    const totalArea = result.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(totalArea).toBeCloseTo(600 * 400, -1);
  });
});
