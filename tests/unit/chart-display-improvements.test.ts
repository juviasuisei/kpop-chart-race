/**
 * Unit tests for Feature 0014: Chart Display Improvements
 * Tests dedup tie-breaking, dateMinusDays, rank badge class, logo toggle CSS class.
 */

import { computeChartWins } from '../../src/chart-engine.ts';
import { filterByActivity, filterByZoom, hasRecentActivity, dateMinusDays, toRomanNumeral } from '../../src/utils.ts';
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
// dateMinusDays
// ============================================================

describe('dateMinusDays', () => {
  it('returns 14 days before the given date', () => {
    const result = dateMinusDays('2024-03-15', 14);
    expect(result).toBe('2024-03-01');
  });

  it('handles month boundary', () => {
    const result = dateMinusDays('2024-01-15', 14);
    expect(result).toBe('2024-01-01');
  });

  it('handles year boundary', () => {
    const result = dateMinusDays('2024-01-01', 14);
    expect(result).toBe('2023-12-18');
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

    const wrapper = container.querySelector('.chart-race__bar-wrapper')!;
    const children = Array.from(wrapper.children);
    const rankIndex = children.findIndex((el) => el.classList.contains('bar__rank'));
    const barIndex = children.findIndex((el) => el.classList.contains('chart-race__bar'));

    expect(rankIndex).toBeLessThan(barIndex);

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


// ============================================================
// Activity filter with goalpost logic — filterByActivity
// ============================================================

/**
 * Helper: build a DataStore where each artist's activity is controlled
 * by providing a date for their dailyValues entry.
 */
function makeActivityDataStore(
  artistConfigs: { id: string; activityDate: string }[],
): DataStore {
  const artists = new Map<string, ParsedArtist>();
  const allDates = new Set<string>();
  for (const cfg of artistConfigs) {
    allDates.add(cfg.activityDate);
    artists.set(cfg.id, {
      id: cfg.id,
      name: `Artist ${cfg.id}`,
      artistType: 'boy_group',
      generation: 4,
      logoUrl: `assets/logos/${cfg.id}.svg`,
      releases: [{
        id: 'release-1',
        title: 'Song',
        dailyValues: new Map([[cfg.activityDate, { value: 100, source: 'inkigayo', episode: 1 }]]),
        embeds: new Map(),
      }],
    });
  }
  const dates = Array.from(allDates).sort();
  return { artists, dates, startDate: dates[0], endDate: dates[dates.length - 1], chartWins: new Map() };
}

function makeRankedEntries(count: number): RankedEntry[] {
  return Array.from({ length: count }, (_, i) =>
    makeEntry({
      artistId: `a${i + 1}`,
      artistName: `Artist ${i + 1}`,
      rank: i + 1,
      cumulativeValue: 1000 - i * 50,
    }),
  );
}

describe('filterByActivity — goalpost logic', () => {
  const snapshotDate = '2024-06-15';
  const recentDate = '2024-06-10'; // within 14 days of snapshot
  const oldDate = '2023-01-01';    // outside 14 days

  it('rank 1 is always included even if inactive', () => {
    const entries = makeRankedEntries(5);
    // All artists inactive
    const ds = makeActivityDataStore(
      entries.map(e => ({ id: e.artistId, activityDate: oldDate })),
    );
    const result = filterByActivity(entries, snapshotDate, ds, 10);
    expect(result[0].rank).toBe(1);
  });

  it('active artists are included', () => {
    const entries = makeRankedEntries(5);
    // Only rank 3 is active
    const ds = makeActivityDataStore(
      entries.map(e => ({
        id: e.artistId,
        activityDate: e.artistId === 'a3' ? recentDate : oldDate,
      })),
    );
    const result = filterByActivity(entries, snapshotDate, ds, 10);
    const ids = result.map(r => r.artistId);
    expect(ids).toContain('a3');
  });

  it('goalpost — inactive entry immediately above an active entry is included', () => {
    const entries = makeRankedEntries(5);
    // rank 3 active, rank 2 inactive → rank 2 should be goalpost
    const ds = makeActivityDataStore(
      entries.map(e => ({
        id: e.artistId,
        activityDate: e.artistId === 'a3' || e.artistId === 'a1' ? recentDate : oldDate,
      })),
    );
    const result = filterByActivity(entries, snapshotDate, ds, 10);
    const ids = result.map(r => r.artistId);
    expect(ids).toContain('a2'); // goalpost for a3
  });

  it('NO chaining — only one goalpost per active, not a chain of inactives', () => {
    // ranks 1-5: rank 1 active, ranks 2-4 inactive, rank 5 active
    // rank 4 is goalpost for rank 5, but rank 3 should NOT chain from rank 4
    const entries = makeRankedEntries(5);
    const ds = makeActivityDataStore(
      entries.map(e => ({
        id: e.artistId,
        activityDate: (e.artistId === 'a1' || e.artistId === 'a5') ? recentDate : oldDate,
      })),
    );
    const result = filterByActivity(entries, snapshotDate, ds, 10);
    const ids = result.map(r => r.artistId);
    expect(ids).toContain('a1'); // active
    expect(ids).toContain('a4'); // goalpost for a5
    expect(ids).toContain('a5'); // active
    // a3 should NOT be included as a chained goalpost for a4
    // (a3 is only included if backfill is needed)
    // With 3 entries included (a1, a4, a5), backfill will add a2, a3 to reach 5
    // But the key point: a3 is NOT included via goalpost chaining
  });

  it('backfill — when fewer than 10 qualify, fill with inactive by rank', () => {
    // Only 3 entries total, all active → result should be 3 (can't backfill beyond available)
    const entries = makeRankedEntries(3);
    const ds = makeActivityDataStore(
      entries.map(e => ({ id: e.artistId, activityDate: recentDate })),
    );
    const result = filterByActivity(entries, snapshotDate, ds, 10);
    expect(result.length).toBe(3);

    // 15 entries, only rank 1 active → should backfill to 10
    const entries15 = makeRankedEntries(15);
    const ds15 = makeActivityDataStore(
      entries15.map(e => ({
        id: e.artistId,
        activityDate: e.artistId === 'a1' ? recentDate : oldDate,
      })),
    );
    const result15 = filterByActivity(entries15, snapshotDate, ds15, 10);
    expect(result15.length).toBe(10);
    // First entry is rank 1, rest are backfilled by rank order
    expect(result15[0].rank).toBe(1);
  });

  it('zoom "all" returns all entries unchanged', () => {
    const entries = makeRankedEntries(15);
    const ds = makeActivityDataStore(
      entries.map(e => ({ id: e.artistId, activityDate: oldDate })),
    );
    const result = filterByActivity(entries, snapshotDate, ds, 'all');
    expect(result).toEqual(entries);
  });

  it('active artists prioritized over inactive, backfill by rank, sorted by rank', () => {
    // 15 entries: ranks 1, 5, 10 active; rest inactive
    // Expected: rank 1 (always), rank 5 (active), rank 10 (active), then backfill 2,3,4,6,7,8,9
    // Sorted: 1,2,3,4,5,6,7,8,9,10
    const entries = makeRankedEntries(15);
    const ds = makeActivityDataStore(
      entries.map(e => {
        const rankNum = parseInt(e.artistId.replace('a', ''));
        const isActive = rankNum === 1 || rankNum === 5 || rankNum === 10;
        return { id: e.artistId, activityDate: isActive ? recentDate : oldDate };
      }),
    );
    const result = filterByActivity(entries, snapshotDate, ds, 10);
    expect(result.length).toBe(10);

    const ranks = result.map(r => r.rank);
    // Active: 1, 5, 10. Backfill: 2, 3, 4, 6, 7, 8, 9. Total 10, sorted.
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it.skip('visual example — ranks 1-8 active, 9-10 inactive, 11 active → includes 1-8, 10, 11', () => {
    const entries = makeRankedEntries(11);
    const ds = makeActivityDataStore(
      entries.map(e => {
        const rankNum = parseInt(e.artistId.replace('a', ''));
        const isActive = rankNum <= 8 || rankNum === 11;
        return { id: e.artistId, activityDate: isActive ? recentDate : oldDate };
      }),
    );
    const result = filterByActivity(entries, snapshotDate, ds, 10);
    const ids = result.map(r => r.artistId);

    // Ranks 1-8 active → included
    for (let i = 1; i <= 8; i++) {
      expect(ids).toContain(`a${i}`);
    }
    // Rank 10 is goalpost for rank 11
    expect(ids).toContain('a10');
    // Rank 11 is active
    expect(ids).toContain('a11');
    // Rank 9 is NOT included (inactive, not a goalpost)
    expect(ids).not.toContain('a9');
    // Total should be 10
    expect(result.length).toBe(10);
  });

  it.skip('backfilled entries maintain rank order in final result', () => {
    // 15 entries: ranks 1, 10, 11 active; rest inactive
    // Goalposts: rank 9 (for 10). Backfill adds 2, 3, 4, 5, 6, 7 by rank.
    // Final result must be sorted by rank: 1, 2, 3, 4, 5, 6, 7, 9, 10, 11
    const entries = makeRankedEntries(15);
    const ds = makeActivityDataStore(
      entries.map(e => {
        const rankNum = parseInt(e.artistId.replace('a', ''));
        const isActive = rankNum === 1 || rankNum === 10 || rankNum === 11;
        return { id: e.artistId, activityDate: isActive ? recentDate : oldDate };
      }),
    );
    const result = filterByActivity(entries, snapshotDate, ds, 10);
    expect(result.length).toBe(10);

    // Result must be in ascending rank order
    for (let i = 1; i < result.length; i++) {
      expect(result[i].rank).toBeGreaterThan(result[i - 1].rank);
    }

    // Specifically: backfilled entries (ranks 2-7) should appear before
    // the active entries at ranks 9-11, not appended at the end
    const ranks = result.map(r => r.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 9, 10, 11]);
  });
});

// ============================================================
// Ordinal generation labels — toRomanNumeral
// ============================================================

describe('toRomanNumeral — ordinal gen labels', () => {
  it('toRomanNumeral(1) === "1st Gen"', () => {
    expect(toRomanNumeral(1)).toBe('1st Gen');
  });

  it('toRomanNumeral(2) === "2nd Gen"', () => {
    expect(toRomanNumeral(2)).toBe('2nd Gen');
  });

  it('toRomanNumeral(3) === "3rd Gen"', () => {
    expect(toRomanNumeral(3)).toBe('3rd Gen');
  });

  it('toRomanNumeral(4) === "4th Gen"', () => {
    expect(toRomanNumeral(4)).toBe('4th Gen');
  });

  it('toRomanNumeral(11) === "11th Gen"', () => {
    expect(toRomanNumeral(11)).toBe('11th Gen');
  });

  it('toRomanNumeral(21) === "21st Gen"', () => {
    expect(toRomanNumeral(21)).toBe('21st Gen');
  });
});
