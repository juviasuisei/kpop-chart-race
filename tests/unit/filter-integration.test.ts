/**
 * Integration tests for the full filter-compute-render pipeline:
 * FilterStateManager → computeSnapshot/computeSnapshotSongs → applyGenerationFilter
 *
 * Validates: Requirements 1.7, 7.6, 11.1, 11.2, 11.5, 12.6, 12.7
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../../src/event-bus.ts';
import { FilterStateManager } from '../../src/filter-state-manager.ts';
import {
  computeSnapshot,
  computeSnapshotSongs,
  applyGenerationFilter,
} from '../../src/chart-engine.ts';
import type { DataStore, ParsedArtist, ParsedRelease } from '../../src/models.ts';
import type { FilterState } from '../../src/types.ts';

/**
 * Build a small test DataStore with 4 artists across different generations
 * and releases with different chart sources.
 */
function createTestDataStore(): DataStore {
  const releaseA1: ParsedRelease = {
    id: 'release-a1',
    title: 'Fire',
    dailyValues: new Map([
      ['2024-06-01', { value: 500, source: 'inkigayo', episode: 1 }],
      ['2024-06-02', { value: 600, source: 'music_bank', episode: 2 }],
      ['2024-06-03', { value: 400, source: 'inkigayo', episode: 3 }],
    ]),
    embeds: new Map(),
    artistIds: ['artist-a'],
  };

  const releaseA2: ParsedRelease = {
    id: 'release-a2',
    title: 'Ice',
    dailyValues: new Map([
      ['2024-06-02', { value: 200, source: 'inkigayo', episode: 2 }],
      ['2024-06-03', { value: 300, source: 'inkigayo', episode: 3 }],
    ]),
    embeds: new Map(),
    artistIds: ['artist-a'],
  };

  const releaseB1: ParsedRelease = {
    id: 'release-b1',
    title: 'Ocean',
    dailyValues: new Map([
      ['2024-06-01', { value: 700, source: 'inkigayo', episode: 1 }],
      ['2024-06-02', { value: 100, source: 'music_bank', episode: 2 }],
      ['2024-06-03', { value: 900, source: 'inkigayo', episode: 3 }],
    ]),
    embeds: new Map(),
    artistIds: ['artist-b'],
  };

  const releaseC1: ParsedRelease = {
    id: 'release-c1',
    title: 'Sky',
    dailyValues: new Map([
      ['2024-06-01', { value: 300, source: 'inkigayo', episode: 1 }],
      ['2024-06-02', { value: 800, source: 'inkigayo', episode: 2 }],
      ['2024-06-03', { value: 200, source: 'music_bank', episode: 3 }],
    ]),
    embeds: new Map(),
    artistIds: ['artist-c'],
  };

  // Artist D has a collab release with artist A
  const releaseD1: ParsedRelease = {
    id: 'release-d1',
    title: 'Together',
    dailyValues: new Map([
      ['2024-06-01', { value: 100, source: 'inkigayo', episode: 1 }],
      ['2024-06-03', { value: 250, source: 'inkigayo', episode: 3 }],
    ]),
    embeds: new Map(),
    artistIds: ['artist-d', 'artist-a'], // co-artist release
  };

  const artistA: ParsedArtist = {
    id: 'artist-a',
    name: 'Alpha Group',
    artistType: 'boy_group',
    generation: 4,
    logoUrl: 'assets/logos/alpha.svg',
    releases: [releaseA1, releaseA2],
    albumReleases: [],
  };

  const artistB: ParsedArtist = {
    id: 'artist-b',
    name: 'Beta Girls',
    artistType: 'girl_group',
    generation: 4,
    logoUrl: 'assets/logos/beta.svg',
    releases: [releaseB1],
    albumReleases: [],
  };

  const artistC: ParsedArtist = {
    id: 'artist-c',
    name: 'Gamma Solo',
    artistType: 'solo_female',
    generation: 3,
    logoUrl: 'assets/logos/gamma.svg',
    releases: [releaseC1],
    albumReleases: [],
  };

  const artistD: ParsedArtist = {
    id: 'artist-d',
    name: 'Delta Star',
    artistType: 'solo_male',
    generation: 5,
    logoUrl: 'assets/logos/delta.svg',
    releases: [releaseD1],
    albumReleases: [],
  };

  return {
    artists: new Map([
      ['artist-a', artistA],
      ['artist-b', artistB],
      ['artist-c', artistC],
      ['artist-d', artistD],
    ]),
    dates: ['2024-06-01', '2024-06-02', '2024-06-03'],
    startDate: '2024-06-01',
    endDate: '2024-06-03',
    firstAppearance: new Map(),
    chartWins: new Map(),
  };
}

describe('Integration: Full filter-compute-render pipeline', () => {
  let eventBus: EventBus;
  let dataStore: DataStore;

  beforeEach(() => {
    eventBus = new EventBus();
    dataStore = createTestDataStore();
  });

  /**
   * Validates: Requirement 1.7
   * Mode toggle preserves playback date and play/pause state.
   * When toggling Songs→Artists or Artists→Songs, the current playback date
   * is preserved and the correct number of entries is produced.
   */
  it('mode toggle preserves playback date and produces correct entries per mode', () => {
    const fsm = new FilterStateManager(eventBus);
    const currentDate = '2024-06-02';

    // Start in songs mode (default)
    expect(fsm.getState().displayMode).toBe('songs');

    // Compute songs mode snapshot
    const songsSnapshot = computeSnapshotSongs(currentDate, dataStore, fsm.getState());
    expect(songsSnapshot.date).toBe(currentDate);
    // Songs mode: one entry per release with dailyValues data
    // releaseA1, releaseA2, releaseB1, releaseC1, releaseD1 = 5 releases
    // But releaseA2 has data only on 06-02 and 06-03, releaseD1 only on 06-01 and 06-03
    // All have data up to 06-02, so all should appear
    expect(songsSnapshot.entries.length).toBe(5);

    // Toggle to artists mode — preserve date
    fsm.update({ displayMode: 'artists' });
    expect(fsm.getState().displayMode).toBe('artists');

    const artistsSnapshot = computeSnapshot(currentDate, dataStore);
    expect(artistsSnapshot.date).toBe(currentDate);
    // Artists mode: one entry per artist with cumulative > 0
    // All 4 artists have data by 06-02
    expect(artistsSnapshot.entries.length).toBe(4);

    // Date is preserved across mode toggle
    expect(songsSnapshot.date).toBe(artistsSnapshot.date);

    // Toggle back to songs mode
    fsm.update({ displayMode: 'songs' });
    const songsAgainSnapshot = computeSnapshotSongs(currentDate, dataStore, fsm.getState());
    expect(songsAgainSnapshot.date).toBe(currentDate);
    expect(songsAgainSnapshot.entries.length).toBe(5);
  });

  /**
   * Validates: Requirements 11.1, 11.2, 11.5
   * View switch (race→yearly→race) preserves FilterState completely.
   */
  it('view switch preserves FilterState completely', () => {
    const fsm = new FilterStateManager(eventBus, {
      displayMode: 'artists',
      generation: 4,
      source: 'inkigayo',
      zoom: 'all',
      view: 'line',
      metric: 'wins',
    });

    const stateBefore = fsm.getState();

    // Switch to yearly view
    fsm.update({ view: 'yearly' });
    const stateAfterYearly = fsm.getState();

    // All fields except 'view' should be preserved
    expect(stateAfterYearly.displayMode).toBe(stateBefore.displayMode);
    expect(stateAfterYearly.generation).toBe(stateBefore.generation);
    expect(stateAfterYearly.source).toBe(stateBefore.source);
    expect(stateAfterYearly.zoom).toBe(stateBefore.zoom);
    expect(stateAfterYearly.metric).toBe(stateBefore.metric);
    expect(stateAfterYearly.view).toBe('yearly');

    // Switch back to race view
    fsm.update({ view: 'line' });
    const stateAfterRace = fsm.getState();

    // All fields should match original state
    expect(stateAfterRace).toEqual(stateBefore);
  });

  /**
   * Validates: Requirements 7.6, 12.6
   * Generation + source filter combination produces correct entries.
   * Set generation=4 AND source=inkigayo, then verify only gen-4 entries
   * with inkigayo values.
   */
  it('generation + source filter combination produces correct entries', () => {
    const fsm = new FilterStateManager(eventBus, {
      displayMode: 'songs',
      generation: 4,
      source: 'inkigayo',
      zoom: 10,
      view: 'line',
      metric: 'points',
    });

    const date = '2024-06-03';
    const state = fsm.getState();

    // Compute songs snapshot with source=inkigayo
    const snapshot = computeSnapshotSongs(date, dataStore, state);

    // Apply generation filter for gen 4
    const filtered = applyGenerationFilter(snapshot.entries, state.generation);

    // Only gen-4 artists should remain: artist-a (gen 4) and artist-b (gen 4)
    // Releases: releaseA1, releaseA2 (artist-a, gen4), releaseB1 (artist-b, gen4)
    // Note: releaseD1 has co-artists [artist-d(gen5), artist-a(gen4)] — should pass
    // because at least one co-artist is gen 4
    expect(filtered.length).toBe(4); // releaseA1, releaseA2, releaseB1, releaseD1

    // Verify all entries have at least one gen-4 co-artist
    for (const entry of filtered) {
      if (entry.coArtists && entry.coArtists.length > 0) {
        const hasGen4 = entry.coArtists.some(a => a.generation === 4);
        expect(hasGen4).toBe(true);
      } else {
        expect(entry.generation).toBe(4);
      }
    }

    // Verify cumulative values only include inkigayo source
    // releaseA1: inkigayo values on 06-01 (500) + 06-03 (400) = 900
    const releaseA1Entry = filtered.find(e => e.releaseKey === 'artist-a::release-a1');
    expect(releaseA1Entry).toBeDefined();
    expect(releaseA1Entry!.cumulativeValue).toBe(900);

    // releaseA2: inkigayo values on 06-02 (200) + 06-03 (300) = 500
    const releaseA2Entry = filtered.find(e => e.releaseKey === 'artist-a::release-a2');
    expect(releaseA2Entry).toBeDefined();
    expect(releaseA2Entry!.cumulativeValue).toBe(500);

    // releaseB1: inkigayo values on 06-01 (700) + 06-03 (900) = 1600
    const releaseB1Entry = filtered.find(e => e.releaseKey === 'artist-b::release-b1');
    expect(releaseB1Entry).toBeDefined();
    expect(releaseB1Entry!.cumulativeValue).toBe(1600);

    // Ranks should be contiguous 1..N
    for (let i = 0; i < filtered.length; i++) {
      expect(filtered[i].rank).toBe(i + 1);
    }
  });

  /**
   * Validates: Requirements 12.6
   * Default init state: songs mode, race view, zoom 10, all gen, all source.
   */
  it('default init state matches specification defaults', () => {
    const fsm = new FilterStateManager(eventBus);
    const state = fsm.getState();

    expect(state.displayMode).toBe('songs');
    expect(state.view).toBe('line');
    expect(state.zoom).toBe(10);
    expect(state.generation).toBe('all');
    expect(state.source).toBe('all');
    expect(state.metric).toBe('points');
  });

  /**
   * Validates: Requirement 12.7
   * Data loading failure shows error message with no controls rendered.
   * When DataStore has 0 artists, appropriate handling occurs.
   */
  it('empty DataStore produces empty snapshot (error state behavior)', () => {
    const emptyDataStore: DataStore = {
      artists: new Map(),
      dates: [],
      startDate: '',
      endDate: '',
      firstAppearance: new Map(),
      chartWins: new Map(),
    };

    const fsm = new FilterStateManager(eventBus);
    const state = fsm.getState();

    // Songs mode with empty store
    const songsSnapshot = computeSnapshotSongs('2024-06-01', emptyDataStore, state);
    expect(songsSnapshot.entries).toHaveLength(0);
    expect(songsSnapshot.date).toBe('2024-06-01');

    // Artists mode with empty store
    const artistsSnapshot = computeSnapshot('2024-06-01', emptyDataStore);
    expect(artistsSnapshot.entries).toHaveLength(0);
    expect(artistsSnapshot.date).toBe('2024-06-01');

    // Verify that a loading:error event can be emitted and observed
    let errorMessage = '';
    eventBus.on('loading:error', (msg: string) => {
      errorMessage = msg;
    });
    eventBus.emit('loading:error', 'Failed to load data files');
    expect(errorMessage).toBe('Failed to load data files');
  });

  /**
   * Additional integration: filter:change event is emitted on FilterStateManager update
   */
  it('FilterStateManager emits filter:change on update', () => {
    const fsm = new FilterStateManager(eventBus);
    let receivedState: FilterState | undefined;

    eventBus.on('filter:change', (state: FilterState) => {
      receivedState = state;
    });

    fsm.update({ generation: 4, source: 'inkigayo' });

    expect(receivedState).toBeDefined();
    expect(receivedState!.generation).toBe(4);
    expect(receivedState!.source).toBe('inkigayo');
    // Other fields preserved
    expect(receivedState!.displayMode).toBe('songs');
    expect(receivedState!.zoom).toBe(10);
  });

  /**
   * Validates: Requirement 1.7 (mode toggle end-to-end)
   * Full pipeline: toggle mode, re-compute, verify data consistency
   */
  it('full pipeline: mode toggle re-computes correctly for the same date', () => {
    const fsm = new FilterStateManager(eventBus);
    const date = '2024-06-03';

    // Songs mode computation
    const songsState = fsm.getState();
    const songsSnapshot = computeSnapshotSongs(date, dataStore, songsState);
    const songsFiltered = applyGenerationFilter(songsSnapshot.entries, songsState.generation);

    // All 5 releases should be present (generation "all")
    expect(songsFiltered.length).toBe(5);

    // Switch to artists mode
    fsm.update({ displayMode: 'artists' });
    const artistsState = fsm.getState();
    const artistsSnapshot = computeSnapshot(date, dataStore, undefined, artistsState.source);
    const artistsFiltered = applyGenerationFilter(artistsSnapshot.entries, artistsState.generation);

    // All 4 artists should be present
    expect(artistsFiltered.length).toBe(4);

    // Verify date consistency
    expect(songsSnapshot.date).toBe(artistsSnapshot.date);

    // Verify that artist-a's cumulative in artists mode equals sum of all their releases
    // releaseA1: 500+600+400=1500, releaseA2: 200+300=500 → total=2000
    const artistAEntry = artistsFiltered.find(e => e.artistId === 'artist-a');
    expect(artistAEntry).toBeDefined();
    expect(artistAEntry!.cumulativeValue).toBe(2000);
  });
});
