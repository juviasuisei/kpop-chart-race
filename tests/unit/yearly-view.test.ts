/**
 * Unit tests for the YearlyView component.
 * Tests: year extraction, per-year data computation, global scale,
 * bar rendering, overflow handling, and mount/unmount lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { YearlyView } from '../../src/yearly-view.ts';
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

  it('shows win count when artist has wins', () => {
    const dataStore = createDataStore([
      createArtist('artist-a', 'Artist A', { '2025-06-01': { value: 5000, source: 'inkigayo', episode: 1 } }),
    ]);
    // Add a chart win
    dataStore.chartWins.set('2025-06-01', new Map([
      ['inkigayo', { artistIds: ['artist-a'], crownLevels: new Map([['artist-a', 1]]) }],
    ]));
    view.mount(container, dataStore);

    const stats = container.querySelector('.yearly-view__stats');
    expect(stats?.textContent).toContain('1 win');
  });

  it('shows plural wins correctly', () => {
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
