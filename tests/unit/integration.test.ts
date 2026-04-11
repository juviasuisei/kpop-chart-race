/**
 * Integration tests — verify EventBus wiring between components.
 *
 * Instead of testing the full main.ts flow (which calls fetch), we manually
 * create components and connect them via EventBus, mirroring main.ts wiring.
 */

import { EventBus } from '../../src/event-bus.ts';
import { computeSnapshot } from '../../src/chart-engine.ts';
import { ChartRaceRenderer } from '../../src/chart-race-renderer.ts';
import { DetailPanel } from '../../src/detail-panel.ts';
import type { DataStore, ParsedArtist, ParsedRelease, ChartSnapshot } from '../../src/models.ts';
import type { ZoomLevel } from '../../src/types.ts';

// Mock IntersectionObserver for DetailPanel
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
 * Build a small test DataStore with 3 artists and a few dates.
 */
function createTestDataStore(): DataStore {
  const releaseA: ParsedRelease = {
    id: 'song-alpha',
    title: 'Song Alpha',
    dailyValues: new Map([
      ['2024-06-01', { value: 500, source: 'inkigayo', episode: 100 }],
      ['2024-06-02', { value: 600, source: 'music_bank', episode: 200 }],
      ['2024-06-03', { value: 400, source: 'inkigayo', episode: 101 }],
    ]),
    embeds: new Map(),
  };

  const releaseB: ParsedRelease = {
    id: 'song-beta',
    title: 'Song Beta',
    dailyValues: new Map([
      ['2024-06-01', { value: 300, source: 'inkigayo', episode: 100 }],
      ['2024-06-02', { value: 800, source: 'music_bank', episode: 200 }],
      ['2024-06-03', { value: 200, source: 'inkigayo', episode: 101 }],
    ]),
    embeds: new Map(),
  };

  const releaseC: ParsedRelease = {
    id: 'song-gamma',
    title: 'Song Gamma',
    dailyValues: new Map([
      ['2024-06-01', { value: 700, source: 'inkigayo', episode: 100 }],
      ['2024-06-02', { value: 100, source: 'music_bank', episode: 200 }],
      ['2024-06-03', { value: 900, source: 'inkigayo', episode: 101 }],
    ]),
    embeds: new Map(),
  };

  const artistA: ParsedArtist = {
    id: 'artist-a',
    name: 'Artist A',
    artistType: 'boy_group',
    generation: 4,
    logoUrl: 'assets/logos/a.svg',
    releases: [releaseA],
  };

  const artistB: ParsedArtist = {
    id: 'artist-b',
    name: 'Artist B',
    artistType: 'girl_group',
    generation: 3,
    logoUrl: 'assets/logos/b.svg',
    releases: [releaseB],
  };

  const artistC: ParsedArtist = {
    id: 'artist-c',
    name: 'Artist C',
    artistType: 'solo_female',
    generation: 5,
    logoUrl: 'assets/logos/c.svg',
    releases: [releaseC],
  };

  return {
    artists: new Map([
      ['artist-a', artistA],
      ['artist-b', artistB],
      ['artist-c', artistC],
    ]),
    dates: ['2024-06-01', '2024-06-02', '2024-06-03'],
    startDate: '2024-06-01',
    endDate: '2024-06-03',
    chartWins: new Map(),
  };
}

describe('Integration: EventBus wiring between components', () => {
  let eventBus: EventBus;
  let dataStore: DataStore;
  let container: HTMLDivElement;

  beforeEach(() => {
    eventBus = new EventBus();
    dataStore = createTestDataStore();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // 1. EventBus date:change → computeSnapshot produces a valid ChartSnapshot
  it('date:change → computeSnapshot produces a valid ChartSnapshot', () => {
    let receivedSnapshot: ChartSnapshot | undefined;
    let currentSnapshot: ChartSnapshot | undefined;
    let previousSnapshot: ChartSnapshot | undefined;

    // Wire date:change → computeSnapshot → state:updated (mirrors main.ts)
    eventBus.on('date:change', (date: string) => {
      previousSnapshot = currentSnapshot;
      currentSnapshot = computeSnapshot(date, dataStore, previousSnapshot);
      eventBus.emit('state:updated', currentSnapshot);
    });

    eventBus.on('state:updated', (snapshot: ChartSnapshot) => {
      receivedSnapshot = snapshot;
    });

    // Emit a date change
    eventBus.emit('date:change', '2024-06-01');

    expect(receivedSnapshot).toBeDefined();
    expect(receivedSnapshot!.date).toBe('2024-06-01');
    expect(receivedSnapshot!.entries).toHaveLength(3);

    // Entries should be ranked descending by cumulative value
    for (let i = 0; i < receivedSnapshot!.entries.length - 1; i++) {
      expect(receivedSnapshot!.entries[i].cumulativeValue)
        .toBeGreaterThanOrEqual(receivedSnapshot!.entries[i + 1].cumulativeValue);
    }

    // On 2024-06-01: A=500, B=300, C=700 → C is rank 1
    expect(receivedSnapshot!.entries[0].artistId).toBe('artist-c');
    expect(receivedSnapshot!.entries[0].rank).toBe(1);
  });

  // 2. EventBus zoom:change updates the renderer (verify update is called)
  it('zoom:change updates the renderer', () => {
    const renderer = new ChartRaceRenderer();
    renderer.mount(container);
    const updateSpy = vi.spyOn(renderer, 'update');

    let currentSnapshot: ChartSnapshot | undefined;
    let previousSnapshot: ChartSnapshot | undefined;
    let currentZoom: ZoomLevel = 10;

    // Wire date:change → computeSnapshot → state:updated → renderer.update
    eventBus.on('date:change', (date: string) => {
      previousSnapshot = currentSnapshot;
      currentSnapshot = computeSnapshot(date, dataStore, previousSnapshot);
      eventBus.emit('state:updated', currentSnapshot);
    });

    eventBus.on('state:updated', (snapshot: ChartSnapshot) => {
      renderer.update(snapshot, currentZoom);
    });

    // Wire zoom:change → re-render
    eventBus.on('zoom:change', (level: ZoomLevel) => {
      currentZoom = level;
      if (currentSnapshot) {
        renderer.update(currentSnapshot, currentZoom);
      }
    });

    // First render
    eventBus.emit('date:change', '2024-06-01');
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ date: '2024-06-01' }), 10);

    // Change zoom
    eventBus.emit('zoom:change', 'all' as ZoomLevel);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenLastCalledWith(expect.objectContaining({ date: '2024-06-01' }), 'all');

    renderer.destroy();
  });

  // 3. EventBus pause → detail panel opens for top-ranked artist
  it('pause → detail panel opens for top-ranked artist', () => {
    const detailPanel = new DetailPanel(eventBus);
    let currentSnapshot: ChartSnapshot | undefined;
    let previousSnapshot: ChartSnapshot | undefined;

    // Wire date:change → computeSnapshot
    eventBus.on('date:change', (date: string) => {
      previousSnapshot = currentSnapshot;
      currentSnapshot = computeSnapshot(date, dataStore, previousSnapshot);
    });

    // Wire pause → auto-open detail panel for top-ranked artist (mirrors main.ts)
    eventBus.on('pause', () => {
      if (currentSnapshot && currentSnapshot.entries.length > 0) {
        const topArtistId = currentSnapshot.entries[0].artistId;
        detailPanel.open(topArtistId, dataStore);
      }
    });

    // Set up a snapshot first
    eventBus.emit('date:change', '2024-06-01');
    expect(currentSnapshot).toBeDefined();

    // Emit pause
    eventBus.emit('pause');

    expect(detailPanel.isOpen()).toBe(true);

    // Top artist on 2024-06-01 is artist-c (value 700)
    const panelEl = document.body.querySelector('.detail-panel');
    expect(panelEl).not.toBeNull();
    const nameEl = panelEl!.querySelector('.detail-panel__artist-name');
    expect(nameEl!.textContent).toBe('Artist C');

    detailPanel.destroy();
  });

  // 4. EventBus play → detail panel closes
  it('play → detail panel closes', () => {
    const detailPanel = new DetailPanel(eventBus);

    // Wire play → auto-close detail panel (mirrors main.ts)
    eventBus.on('play', () => {
      if (detailPanel.isOpen()) {
        detailPanel.close();
      }
    });

    // Open the panel manually
    detailPanel.open('artist-a', dataStore);
    expect(detailPanel.isOpen()).toBe(true);

    // Emit play
    eventBus.emit('play');

    expect(detailPanel.isOpen()).toBe(false);
    expect(document.body.querySelector('.detail-panel')).toBeNull();

    detailPanel.destroy();
  });

  // 5. EventBus bar:click → detail panel opens for the clicked artist
  it('bar:click → detail panel opens for the clicked artist', () => {
    const detailPanel = new DetailPanel(eventBus);

    // Wire bar:click → open detail panel (mirrors main.ts)
    eventBus.on('bar:click', (artistId: string) => {
      detailPanel.open(artistId, dataStore);
    });

    // Click on artist-b
    eventBus.emit('bar:click', 'artist-b');

    expect(detailPanel.isOpen()).toBe(true);
    const nameEl = document.body.querySelector('.detail-panel__artist-name');
    expect(nameEl).not.toBeNull();
    expect(nameEl!.textContent).toBe('Artist B');

    detailPanel.destroy();
  });
});
