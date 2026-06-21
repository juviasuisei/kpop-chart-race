/** @vitest-environment jsdom */

/**
 * Unit tests for Song Mode Wins Display.
 *
 * Tests computeReleaseWins (pure function) and renderer integration
 * for wins formatting on bars and goalpost labels.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeReleaseWins, computeChartWins } from '../../src/chart-engine.ts';
import { ChartRaceRenderer } from '../../src/chart-race-renderer.ts';
import { EventBus } from '../../src/event-bus.ts';
import type { DataStore, ParsedArtist, ParsedRelease, ChartSnapshot, RankedEntry, ResolvedArtist } from '../../src/models.ts';
import type { DailyValueEntry } from '../../src/types.ts';

// --- Helpers ---

function buildPopulatedDataStore(artists: ParsedArtist[], dates: string[]): DataStore {
  const artistMap = new Map<string, ParsedArtist>();
  for (const artist of artists) {
    artistMap.set(artist.id, artist);
  }
  const dataStore: DataStore = {
    artists: artistMap,
    dates,
    startDate: dates[0] ?? '',
    endDate: dates[dates.length - 1] ?? '',
    firstAppearance: new Map(),
    chartWins: new Map(),
    releaseWinDates: new Map(),
  };
  const { chartWins, releaseWinDates } = computeChartWins(dataStore);
  dataStore.chartWins = chartWins;
  dataStore.releaseWinDates = releaseWinDates;
  return dataStore;
}

function makeResolvedArtist(overrides: Partial<ResolvedArtist> = {}): ResolvedArtist {
  return {
    id: 'artist-1',
    name: 'BTS',
    logoUrl: 'assets/logos/bts.svg',
    artistType: 'boy_group',
    generation: 3,
    ...overrides,
  };
}

function makeSongsEntry(overrides: Partial<RankedEntry> = {}): RankedEntry {
  return {
    artistId: 'artist-1::release-1',
    artistName: 'Dynamite',
    artistType: 'boy_group',
    generation: 3,
    logoUrl: 'assets/logos/bts.svg',
    cumulativeValue: 500,
    previousCumulativeValue: 400,
    dailyValue: 100,
    rank: 1,
    previousRank: 1,
    featuredRelease: { title: 'BTS ▲', releaseId: 'release-1' },
    isGoalpost: false,
    releaseKey: 'artist-1::release-1',
    mode: 'songs',
    coArtists: [makeResolvedArtist()],
    ...overrides,
  };
}

function makeDataStoreForSongsEntries(entries: RankedEntry[], date = '2024-06-01'): DataStore {
  const artists = new Map<string, ParsedArtist>();
  for (const entry of entries) {
    if (entry.coArtists) {
      for (const coArtist of entry.coArtists) {
        if (!artists.has(coArtist.id)) {
          const dv: DailyValueEntry = { value: entry.dailyValue || 100, source: 'inkigayo', episode: 1 };
          artists.set(coArtist.id, {
            id: coArtist.id,
            name: coArtist.name,
            artistType: coArtist.artistType,
            generation: coArtist.generation,
            logoUrl: coArtist.logoUrl,
            releases: [{
              id: entry.releaseKey?.split('::')[1] ?? 'release-1',
              title: entry.artistName,
              dailyValues: new Map([[date, dv]]),
              embeds: new Map(),
              artistIds: entry.coArtists.map(a => a.id),
            }],
            albumReleases: [],
          });
        }
      }
    }
    const dv: DailyValueEntry = { value: entry.dailyValue || 100, source: 'inkigayo', episode: 1 };
    if (!artists.has(entry.artistId)) {
      artists.set(entry.artistId, {
        id: entry.artistId,
        name: entry.artistName,
        artistType: entry.artistType,
        generation: entry.generation,
        logoUrl: entry.logoUrl,
        releases: [{
          id: entry.releaseKey?.split('::')[1] ?? 'release-1',
          title: entry.artistName,
          dailyValues: new Map([[date, dv]]),
          embeds: new Map(),
          artistIds: entry.coArtists?.map(a => a.id) ?? [],
        }],
        albumReleases: [],
      });
    }
  }
  return {
    artists,
    dates: [date],
    startDate: date,
    endDate: date,
    firstAppearance: new Map(),
    chartWins: new Map(),
    releaseWinDates: new Map(),
  };
}

// ============================================================
// computeReleaseWins unit tests
// ============================================================

describe('computeReleaseWins', () => {
  it('release with exactly 1 win returns 1', () => {
    const artist: ParsedArtist = {
      id: 'bts',
      name: 'BTS',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/bts.svg',
      releases: [{
        id: 'dynamite',
        title: 'Dynamite',
        dailyValues: new Map([
          ['2024-01-01', { value: 1000, source: 'inkigayo', episode: 1 }],
        ]),
        embeds: new Map(),
        artistIds: ['bts'],
      }],
      albumReleases: [],
    };

    const dataStore = buildPopulatedDataStore([artist], ['2024-01-01']);
    const wins = computeReleaseWins('bts::dynamite', '2024-01-01', dataStore);
    expect(wins).toBe(1);
  });

  it('release with 5 wins across different sources returns 5', () => {
    const dates = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];
    const sources = ['inkigayo', 'm_countdown', 'music_bank', 'show_champion', 'the_show'];
    const artist: ParsedArtist = {
      id: 'bts',
      name: 'BTS',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/bts.svg',
      releases: [{
        id: 'dynamite',
        title: 'Dynamite',
        dailyValues: new Map(
          dates.map((d, i) => [d, { value: 1000, source: sources[i], episode: i + 1 }]),
        ),
        embeds: new Map(),
        artistIds: ['bts'],
      }],
      albumReleases: [],
    };

    const dataStore = buildPopulatedDataStore([artist], dates);
    const wins = computeReleaseWins('bts::dynamite', '2024-01-05', dataStore);
    expect(wins).toBe(5);
  });

  it('release with 0 wins returns 0', () => {
    // Artist exists but loses to a competitor
    const artist: ParsedArtist = {
      id: 'bts',
      name: 'BTS',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/bts.svg',
      releases: [{
        id: 'dynamite',
        title: 'Dynamite',
        dailyValues: new Map([
          ['2024-01-01', { value: 100, source: 'inkigayo', episode: 1 }],
        ]),
        embeds: new Map(),
        artistIds: ['bts'],
      }],
      albumReleases: [],
    };

    const competitor: ParsedArtist = {
      id: 'aespa',
      name: 'aespa',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/aespa.svg',
      releases: [{
        id: 'supernova',
        title: 'Supernova',
        dailyValues: new Map([
          ['2024-01-01', { value: 5000, source: 'inkigayo', episode: 1 }],
        ]),
        embeds: new Map(),
        artistIds: ['aespa'],
      }],
      albumReleases: [],
    };

    const dataStore = buildPopulatedDataStore([artist, competitor], ['2024-01-01']);
    const wins = computeReleaseWins('bts::dynamite', '2024-01-01', dataStore);
    expect(wins).toBe(0);
  });

  it('co-artist release wins counted when secondary artist wins', () => {
    const collabRelease: ParsedRelease = {
      id: 'collab-song',
      title: 'Collab Song',
      dailyValues: new Map([
        ['2024-01-01', { value: 2000, source: 'inkigayo', episode: 1 }],
      ]),
      embeds: new Map(),
      artistIds: ['artist-a', 'artist-b'],
    };

    const artistA: ParsedArtist = {
      id: 'artist-a',
      name: 'Artist A',
      artistType: 'boy_group',
      generation: 4,
      logoUrl: 'assets/logos/artist-a.svg',
      releases: [collabRelease],
      albumReleases: [],
    };

    const artistB: ParsedArtist = {
      id: 'artist-b',
      name: 'Artist B',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/artist-b.svg',
      releases: [collabRelease],
      albumReleases: [],
    };

    const dataStore = buildPopulatedDataStore([artistA, artistB], ['2024-01-01']);
    // Primary key lookup should count wins from both co-artist entries
    const wins = computeReleaseWins('artist-a::collab-song', '2024-01-01', dataStore);
    // Both artist-a and artist-b win with the same release → 2 entries in releaseWinDates
    expect(wins).toBeGreaterThanOrEqual(1);
  });

  it('multiple releases from same artist — only correct release gets the win', () => {
    const artist: ParsedArtist = {
      id: 'bts',
      name: 'BTS',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/bts.svg',
      releases: [
        {
          id: 'dynamite',
          title: 'Dynamite',
          dailyValues: new Map([
            ['2024-01-01', { value: 5000, source: 'inkigayo', episode: 1 }],
          ]),
          embeds: new Map(),
          artistIds: ['bts'],
        },
        {
          id: 'butter',
          title: 'Butter',
          dailyValues: new Map([
            ['2024-01-01', { value: 3000, source: 'inkigayo', episode: 1 }],
          ]),
          embeds: new Map(),
          artistIds: ['bts'],
        },
      ],
      albumReleases: [],
    };

    const dataStore = buildPopulatedDataStore([artist], ['2024-01-01']);
    // Only Dynamite (higher value) should get the win
    const dynamiteWins = computeReleaseWins('bts::dynamite', '2024-01-01', dataStore);
    const butterWins = computeReleaseWins('bts::butter', '2024-01-01', dataStore);
    expect(dynamiteWins).toBe(1);
    expect(butterWins).toBe(0);
  });

  it('scrubbing backward — win count decreases to earlier value', () => {
    const dates = ['2024-01-01', '2024-01-02', '2024-01-03'];
    const artist: ParsedArtist = {
      id: 'bts',
      name: 'BTS',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/bts.svg',
      releases: [{
        id: 'dynamite',
        title: 'Dynamite',
        dailyValues: new Map([
          ['2024-01-01', { value: 1000, source: 'inkigayo', episode: 1 }],
          ['2024-01-02', { value: 1000, source: 'm_countdown', episode: 2 }],
          ['2024-01-03', { value: 1000, source: 'music_bank', episode: 3 }],
        ]),
        embeds: new Map(),
        artistIds: ['bts'],
      }],
      albumReleases: [],
    };

    const dataStore = buildPopulatedDataStore([artist], dates);

    // At date 3: 3 wins
    expect(computeReleaseWins('bts::dynamite', '2024-01-03', dataStore)).toBe(3);
    // At date 2 (scrub backward): 2 wins
    expect(computeReleaseWins('bts::dynamite', '2024-01-02', dataStore)).toBe(2);
    // At date 1 (scrub further backward): 1 win
    expect(computeReleaseWins('bts::dynamite', '2024-01-01', dataStore)).toBe(1);
  });

  it('invalid releaseKey format returns 0', () => {
    const artist: ParsedArtist = {
      id: 'bts',
      name: 'BTS',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/bts.svg',
      releases: [{
        id: 'dynamite',
        title: 'Dynamite',
        dailyValues: new Map([
          ['2024-01-01', { value: 1000, source: 'inkigayo', episode: 1 }],
        ]),
        embeds: new Map(),
        artistIds: ['bts'],
      }],
      albumReleases: [],
    };

    const dataStore = buildPopulatedDataStore([artist], ['2024-01-01']);

    // No :: separator
    expect(computeReleaseWins('invalid-key', '2024-01-01', dataStore)).toBe(0);
    // Empty parts
    expect(computeReleaseWins('::release', '2024-01-01', dataStore)).toBe(0);
    expect(computeReleaseWins('artist::', '2024-01-01', dataStore)).toBe(0);
  });
});

// ============================================================
// Renderer integration tests - wins display formatting
// ============================================================

describe('Song Mode Wins Renderer Integration', () => {
  let container: HTMLElement;
  let renderer: ChartRaceRenderer;
  let eventBus: EventBus;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    eventBus = new EventBus();
    renderer = new ChartRaceRenderer(eventBus);
    renderer.mount(container);
  });

  afterEach(() => {
    renderer.destroy();
    container.remove();
  });

  it('normal bar winsSpan shows "1 win" for a release with 1 win', () => {
    const date = '2024-06-01';
    // Build a real DataStore with 1 win
    const artist: ParsedArtist = {
      id: 'bts',
      name: 'BTS',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/bts.svg',
      releases: [{
        id: 'dynamite',
        title: 'Dynamite',
        dailyValues: new Map([[date, { value: 1000, source: 'inkigayo', episode: 1 }]]),
        embeds: new Map(),
        artistIds: ['bts'],
      }],
      albumReleases: [],
    };
    const dataStore = buildPopulatedDataStore([artist], [date]);

    const entry = makeSongsEntry({
      artistId: 'bts::dynamite',
      artistName: 'Dynamite',
      releaseKey: 'bts::dynamite',
      coArtists: [makeResolvedArtist({ id: 'bts', name: 'BTS' })],
      cumulativeValue: 1000,
      dailyValue: 1000,
    });
    const snapshot: ChartSnapshot = { date, entries: [entry] };

    renderer.update(snapshot, 10, dataStore);

    const winsSpan = container.querySelector('.bar__wins') as HTMLElement;
    expect(winsSpan).not.toBeNull();
    expect(winsSpan.textContent).toBe('1 win');
    expect(winsSpan.style.display).not.toBe('none');
  });

  it('normal bar winsSpan shows "5 wins" for a release with 5 wins', () => {
    const dates = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];
    const sources = ['inkigayo', 'm_countdown', 'music_bank', 'show_champion', 'the_show'];
    const artist: ParsedArtist = {
      id: 'bts',
      name: 'BTS',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/bts.svg',
      releases: [{
        id: 'dynamite',
        title: 'Dynamite',
        dailyValues: new Map(
          dates.map((d, i) => [d, { value: 1000, source: sources[i], episode: i + 1 }]),
        ),
        embeds: new Map(),
        artistIds: ['bts'],
      }],
      albumReleases: [],
    };
    const dataStore = buildPopulatedDataStore([artist], dates);

    const entry = makeSongsEntry({
      artistId: 'bts::dynamite',
      artistName: 'Dynamite',
      releaseKey: 'bts::dynamite',
      coArtists: [makeResolvedArtist({ id: 'bts', name: 'BTS' })],
      cumulativeValue: 5000,
      dailyValue: 1000,
    });
    const snapshot: ChartSnapshot = { date: '2024-01-05', entries: [entry] };

    renderer.update(snapshot, 10, dataStore);

    const winsSpan = container.querySelector('.bar__wins') as HTMLElement;
    expect(winsSpan).not.toBeNull();
    expect(winsSpan.textContent).toBe('5 wins');
    expect(winsSpan.style.display).not.toBe('none');
  });

  it('normal bar winsSpan is hidden for release with 0 wins', () => {
    const date = '2024-06-01';
    // Build a DataStore where BTS loses to aespa
    const bts: ParsedArtist = {
      id: 'bts',
      name: 'BTS',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/bts.svg',
      releases: [{
        id: 'dynamite',
        title: 'Dynamite',
        dailyValues: new Map([[date, { value: 100, source: 'inkigayo', episode: 1 }]]),
        embeds: new Map(),
        artistIds: ['bts'],
      }],
      albumReleases: [],
    };
    const aespa: ParsedArtist = {
      id: 'aespa',
      name: 'aespa',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/aespa.svg',
      releases: [{
        id: 'supernova',
        title: 'Supernova',
        dailyValues: new Map([[date, { value: 5000, source: 'inkigayo', episode: 1 }]]),
        embeds: new Map(),
        artistIds: ['aespa'],
      }],
      albumReleases: [],
    };
    const dataStore = buildPopulatedDataStore([bts, aespa], [date]);

    const entry = makeSongsEntry({
      artistId: 'bts::dynamite',
      artistName: 'Dynamite',
      releaseKey: 'bts::dynamite',
      coArtists: [makeResolvedArtist({ id: 'bts', name: 'BTS' })],
      cumulativeValue: 100,
      dailyValue: 100,
    });
    const snapshot: ChartSnapshot = { date, entries: [entry] };

    renderer.update(snapshot, 10, dataStore);

    const winsSpan = container.querySelector('.bar__wins') as HTMLElement;
    expect(winsSpan).not.toBeNull();
    expect(winsSpan.textContent).toBe('');
    expect(winsSpan.style.display).toBe('none');
  });

  it('goalpost label format with wins includes " · N wins"', () => {
    // To trigger goalpost rendering, we need:
    // - More than 10 entries total
    // - An inactive entry at rank 2 (not rank 1, since rank 1 is always included as regular)
    //   that sits between an active entry at rank 1 and an active entry at rank 3
    // - The inactive entry must have won earlier (so it has wins in releaseWinDates)
    const earlyDates = ['2024-01-01', '2024-01-02', '2024-01-03'];
    const snapshotDate = '2024-01-10'; // 7 days later — goalpost artist inactive (>3 days)
    const dates = [...earlyDates, snapshotDate];
    const sources = ['inkigayo', 'm_countdown', 'music_bank'];

    // The goalpost candidate: inactive on snapshot date, won on 3 early dates
    // Place at rank 2 (between active rank 1 and active rank 3)
    const goalpostArtist: ParsedArtist = {
      id: 'winner',
      name: 'Winner',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/winner.svg',
      releases: [{
        id: 'hit-song',
        title: 'Hit Song',
        dailyValues: new Map(
          earlyDates.map((d, i) => [d, { value: 5000, source: sources[i], episode: i + 1 }]),
        ),
        embeds: new Map(),
        artistIds: ['winner'],
      }],
      albumReleases: [],
    };

    // Active artists: rank 1 (highest cumulative), then ranks 3-12
    const activeArtists: ParsedArtist[] = [];
    for (let i = 0; i < 11; i++) {
      activeArtists.push({
        id: `active-${i}`,
        name: `Active ${i}`,
        artistType: 'girl_group',
        generation: 4,
        logoUrl: `assets/logos/active-${i}.svg`,
        releases: [{
          id: `song-${i}`,
          title: `Active Song ${i}`,
          dailyValues: new Map([
            [snapshotDate, { value: 4000 - i * 100, source: 'inkigayo', episode: 1 }],
            ...earlyDates.map((d, di) => [d, { value: 3000 - i * 100, source: sources[di], episode: di + 1 }] as const),
          ]),
          embeds: new Map(),
          artistIds: [`active-${i}`],
        }],
        albumReleases: [],
      });
    }

    const dataStore = buildPopulatedDataStore([goalpostArtist, ...activeArtists], dates);

    // Add composite key entries so filterByActivity can look them up
    dataStore.artists.set('winner::hit-song', goalpostArtist);
    for (let i = 0; i < 11; i++) {
      dataStore.artists.set(`active-${i}::song-${i}`, activeArtists[i]);
    }

    // Build entries sorted by cumulative value:
    // rank 1: active-0 (highest cumulative on snapshot date: ~21000)
    // rank 2: winner::hit-song (inactive, cumulative ~15000 from early wins)
    // rank 3-12: active-1 through active-10
    const entries: RankedEntry[] = [];

    // Rank 1: active-0 (active, highest cumulative)
    entries.push({
      artistId: 'active-0::song-0',
      artistName: 'Active Song 0',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/active-0.svg',
      cumulativeValue: 21000,
      previousCumulativeValue: 17000,
      dailyValue: 4000,
      rank: 1,
      previousRank: 1,
      featuredRelease: { title: 'Active 0 ●', releaseId: 'song-0' },
      isGoalpost: false,
      releaseKey: 'active-0::song-0',
      mode: 'songs',
      coArtists: [{ id: 'active-0', name: 'Active 0', logoUrl: 'assets/logos/active-0.svg', artistType: 'girl_group', generation: 4 }],
    });

    // Rank 2: inactive winner (goalpost candidate)
    entries.push({
      artistId: 'winner::hit-song',
      artistName: 'Hit Song',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/winner.svg',
      cumulativeValue: 15000,
      previousCumulativeValue: 15000,
      dailyValue: 0,
      rank: 2,
      previousRank: 2,
      featuredRelease: { title: 'Winner ▲', releaseId: 'hit-song' },
      isGoalpost: false,
      releaseKey: 'winner::hit-song',
      mode: 'songs',
      coArtists: [{ id: 'winner', name: 'Winner', logoUrl: 'assets/logos/winner.svg', artistType: 'boy_group', generation: 3 }],
    });

    // Ranks 3-12: active-1 through active-10
    for (let i = 1; i <= 10; i++) {
      entries.push({
        artistId: `active-${i}::song-${i}`,
        artistName: `Active Song ${i}`,
        artistType: 'girl_group',
        generation: 4,
        logoUrl: `assets/logos/active-${i}.svg`,
        cumulativeValue: 13000 - i * 100,
        previousCumulativeValue: 10000 - i * 100,
        dailyValue: 4000 - i * 100,
        rank: i + 2,
        previousRank: i + 2,
        featuredRelease: { title: `Active ${i} ●`, releaseId: `song-${i}` },
        isGoalpost: false,
        releaseKey: `active-${i}::song-${i}`,
        mode: 'songs',
        coArtists: [{ id: `active-${i}`, name: `Active ${i}`, logoUrl: `assets/logos/active-${i}.svg`, artistType: 'girl_group', generation: 4 }],
      });
    }

    const snapshot: ChartSnapshot = { date: snapshotDate, entries };

    renderer.update(snapshot, 10, dataStore);

    // Find goalpost label for the inactive winner
    const goalpostLabels = container.querySelectorAll('.bar__goalpost-label') as NodeListOf<HTMLElement>;
    let found = false;
    for (const label of goalpostLabels) {
      if (label.style.display === 'inline' && label.textContent?.includes('Hit Song')) {
        found = true;
        // Should contain wins segment: 3 wins
        expect(label.textContent).toContain(' · 3 wins');
        expect(label.textContent).toMatch(/#\d+ · .+ · .+ · 3 wins/);
      }
    }
    expect(found).toBe(true);
  });

  it('goalpost label format without wins has no wins segment', () => {
    const earlyDates = ['2024-01-01', '2024-01-02'];
    const snapshotDate = '2024-01-10';
    const dates = [...earlyDates, snapshotDate];

    // Goalpost artist: inactive and LOST all chart battles (0 wins)
    const goalpostArtist: ParsedArtist = {
      id: 'loser',
      name: 'Loser',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/loser.svg',
      releases: [{
        id: 'flop-song',
        title: 'Flop Song',
        dailyValues: new Map(
          earlyDates.map((d, i) => [d, { value: 100, source: 'inkigayo', episode: i + 1 }]),
        ),
        embeds: new Map(),
        artistIds: ['loser'],
      }],
      albumReleases: [],
    };

    // Winner on the early dates (ensures loser gets 0 wins)
    const earlyWinner: ParsedArtist = {
      id: 'early-champ',
      name: 'Early Champ',
      artistType: 'solo_female',
      generation: 4,
      logoUrl: 'assets/logos/early-champ.svg',
      releases: [{
        id: 'champ-song',
        title: 'Champ Song',
        dailyValues: new Map(
          earlyDates.map((d, i) => [d, { value: 9000, source: 'inkigayo', episode: i + 1 }]),
        ),
        embeds: new Map(),
        artistIds: ['early-champ'],
      }],
      albumReleases: [],
    };

    // 11 active artists on the snapshot date
    const activeArtists: ParsedArtist[] = [];
    for (let i = 0; i < 11; i++) {
      activeArtists.push({
        id: `active-${i}`,
        name: `Active ${i}`,
        artistType: 'girl_group',
        generation: 4,
        logoUrl: `assets/logos/active-${i}.svg`,
        releases: [{
          id: `song-${i}`,
          title: `Active Song ${i}`,
          dailyValues: new Map([
            [snapshotDate, { value: 4000 - i * 100, source: 'inkigayo', episode: 1 }],
          ]),
          embeds: new Map(),
          artistIds: [`active-${i}`],
        }],
        albumReleases: [],
      });
    }

    const dataStore = buildPopulatedDataStore([goalpostArtist, earlyWinner, ...activeArtists], dates);
    // Add composite key entries for filterByActivity
    dataStore.artists.set('loser::flop-song', goalpostArtist);
    dataStore.artists.set('early-champ::champ-song', earlyWinner);
    for (let i = 0; i < 11; i++) {
      dataStore.artists.set(`active-${i}::song-${i}`, activeArtists[i]);
    }

    // Entries sorted by cumulative value:
    // rank 1: active-0 (highest active cumulative)
    // rank 2: loser::flop-song (inactive, low cumulative but placed here for test)
    // ranks 3-12: active-1 through active-10
    const entries: RankedEntry[] = [];

    entries.push({
      artistId: 'active-0::song-0',
      artistName: 'Active Song 0',
      artistType: 'girl_group',
      generation: 4,
      logoUrl: 'assets/logos/active-0.svg',
      cumulativeValue: 4000,
      previousCumulativeValue: 0,
      dailyValue: 4000,
      rank: 1,
      previousRank: 1,
      featuredRelease: { title: 'Active 0 ●', releaseId: 'song-0' },
      isGoalpost: false,
      releaseKey: 'active-0::song-0',
      mode: 'songs',
      coArtists: [{ id: 'active-0', name: 'Active 0', logoUrl: 'assets/logos/active-0.svg', artistType: 'girl_group', generation: 4 }],
    });

    // Rank 2: inactive loser (goalpost candidate, 0 wins)
    entries.push({
      artistId: 'loser::flop-song',
      artistName: 'Flop Song',
      artistType: 'boy_group',
      generation: 3,
      logoUrl: 'assets/logos/loser.svg',
      cumulativeValue: 200,
      previousCumulativeValue: 200,
      dailyValue: 0,
      rank: 2,
      previousRank: 2,
      featuredRelease: { title: 'Loser ▲', releaseId: 'flop-song' },
      isGoalpost: false,
      releaseKey: 'loser::flop-song',
      mode: 'songs',
      coArtists: [{ id: 'loser', name: 'Loser', logoUrl: 'assets/logos/loser.svg', artistType: 'boy_group', generation: 3 }],
    });

    for (let i = 1; i <= 10; i++) {
      entries.push({
        artistId: `active-${i}::song-${i}`,
        artistName: `Active Song ${i}`,
        artistType: 'girl_group',
        generation: 4,
        logoUrl: `assets/logos/active-${i}.svg`,
        cumulativeValue: 3900 - i * 100,
        previousCumulativeValue: 0,
        dailyValue: 3900 - i * 100,
        rank: i + 2,
        previousRank: i + 2,
        featuredRelease: { title: `Active ${i} ●`, releaseId: `song-${i}` },
        isGoalpost: false,
        releaseKey: `active-${i}::song-${i}`,
        mode: 'songs',
        coArtists: [{ id: `active-${i}`, name: `Active ${i}`, logoUrl: `assets/logos/active-${i}.svg`, artistType: 'girl_group', generation: 4 }],
      });
    }

    const snapshot: ChartSnapshot = { date: snapshotDate, entries };

    renderer.update(snapshot, 10, dataStore);

    // Find goalpost label for the inactive loser
    const goalpostLabels = container.querySelectorAll('.bar__goalpost-label') as NodeListOf<HTMLElement>;
    let found = false;
    for (const label of goalpostLabels) {
      if (label.style.display === 'inline' && label.textContent?.includes('Flop Song')) {
        found = true;
        // Should NOT contain any wins segment
        expect(label.textContent).not.toContain(' win');
        expect(label.textContent).not.toContain(' wins');
      }
    }
    expect(found).toBe(true);
  });
});
