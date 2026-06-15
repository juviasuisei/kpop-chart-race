/** @vitest-environment jsdom */

/**
 * Unit tests for Songs mode bar rendering in ChartRaceRenderer.
 *
 * These tests verify Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, and 4.1:
 * - Single artist release shows artist logo on bar
 * - Multi-artist release shows logos side by side with 4px spacing
 * - Release title is primary label with musical note icon
 * - Artist names in secondary position with type indicators
 * - Same artist multiple releases → multiple separate bars
 * - Bar click opens detail panel for first artist (index 0) by default
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChartRaceRenderer } from '../../src/chart-race-renderer.ts';
import { EventBus } from '../../src/event-bus.ts';
import type { ChartSnapshot, DataStore, RankedEntry, ParsedArtist, ResolvedArtist } from '../../src/models.ts';
import type { ArtistType, DailyValueEntry } from '../../src/types.ts';

/** Helper to create a ResolvedArtist */
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

/** Helper to create a Songs-mode RankedEntry */
function makeSongsEntry(overrides: Partial<RankedEntry> = {}): RankedEntry {
  return {
    artistId: 'artist-1::release-1',
    artistName: 'Dynamite', // release title in Songs mode (primary label)
    artistType: 'boy_group',
    generation: 3,
    logoUrl: 'assets/logos/bts.svg',
    cumulativeValue: 500,
    previousCumulativeValue: 400,
    dailyValue: 100,
    rank: 1,
    previousRank: 1,
    featuredRelease: { title: 'BTS ▲', releaseId: 'release-1' }, // artist names in secondary position
    isGoalpost: false,
    releaseKey: 'artist-1::release-1',
    mode: 'songs',
    coArtists: [makeResolvedArtist()],
    ...overrides,
  };
}

function makeSnapshot(entries: RankedEntry[], date = '2024-06-01'): ChartSnapshot {
  return { date, entries };
}

/** Build a DataStore for Songs mode entries */
function makeDataStoreForSongsEntries(entries: RankedEntry[], date = '2024-06-01'): DataStore {
  const artists = new Map<string, ParsedArtist>();

  for (const entry of entries) {
    // In Songs mode, artistId is composite: "artistId::releaseId"
    // We need to add the actual artists from coArtists to the store
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
              id: 'release-1',
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

    // Also add the composite ID entry so filterByActivity doesn't filter it out
    const dv: DailyValueEntry = { value: entry.dailyValue || 100, source: 'inkigayo', episode: 1 };
    if (!artists.has(entry.artistId)) {
      artists.set(entry.artistId, {
        id: entry.artistId,
        name: entry.artistName,
        artistType: entry.artistType,
        generation: entry.generation,
        logoUrl: entry.logoUrl,
        releases: [{
          id: 'release-1',
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
  };
}

describe('Songs Mode Bar Rendering', () => {
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

  // Requirement 2.1: Single artist release shows artist logo on bar
  describe('Single artist release logo (Req 2.1)', () => {
    it('displays the single artist logo on the bar', () => {
      const entry = makeSongsEntry({
        coArtists: [makeResolvedArtist({ id: 'bts', name: 'BTS', logoUrl: 'assets/logos/bts.svg' })],
      });
      const snapshot = makeSnapshot([entry]);
      const ds = makeDataStoreForSongsEntries([entry]);

      renderer.update(snapshot, 10, ds);

      const logos = container.querySelectorAll('.bar__logo');
      expect(logos.length).toBeGreaterThanOrEqual(1);
      const firstLogo = logos[0] as HTMLImageElement;
      expect(firstLogo.src).toContain('bts.svg');
    });
  });

  // Requirement 2.2: Multi-artist release shows logos side by side with 4px spacing
  describe('Multi-artist release logos (Req 2.2)', () => {
    it('displays multiple artist logos side by side when release has multiple co-artists', () => {
      const coArtists = [
        makeResolvedArtist({ id: 'bts', name: 'BTS', logoUrl: 'assets/logos/bts.svg', artistType: 'boy_group' }),
        makeResolvedArtist({ id: 'aespa', name: 'aespa', logoUrl: 'assets/logos/aespa.svg', artistType: 'girl_group' }),
      ];
      const entry = makeSongsEntry({
        artistId: 'bts::collab-release',
        releaseKey: 'bts::collab-release',
        coArtists,
        logoUrl: 'assets/logos/bts.svg',
      });
      const snapshot = makeSnapshot([entry]);
      const ds = makeDataStoreForSongsEntries([entry]);

      renderer.update(snapshot, 10, ds);

      // In Songs mode with multiple co-artists, there should be multiple logo images
      const logos = container.querySelectorAll('.bar__logo');
      expect(logos.length).toBeGreaterThanOrEqual(2);

      const logoElements = Array.from(logos) as HTMLImageElement[];
      expect(logoElements[0].src).toContain('bts.svg');
      expect(logoElements[1].src).toContain('aespa.svg');
    });

    it('logos have 4px horizontal spacing between them', () => {
      const coArtists = [
        makeResolvedArtist({ id: 'bts', name: 'BTS', logoUrl: 'assets/logos/bts.svg' }),
        makeResolvedArtist({ id: 'aespa', name: 'aespa', logoUrl: 'assets/logos/aespa.svg' }),
      ];
      const entry = makeSongsEntry({
        artistId: 'bts::collab-release',
        releaseKey: 'bts::collab-release',
        coArtists,
      });
      const snapshot = makeSnapshot([entry]);
      const ds = makeDataStoreForSongsEntries([entry]);

      renderer.update(snapshot, 10, ds);

      // Second logo should have marginLeft of 4px for spacing
      const logos = container.querySelectorAll('.bar__logo');
      if (logos.length >= 2) {
        const secondLogo = logos[1] as HTMLElement;
        expect(secondLogo.style.marginLeft).toBe('4px');
      }
    });
  });

  // Requirement 2.6 + 2.4: Release title is primary label with musical note icon
  describe('Release title as primary label with ♫ icon (Req 2.4, 2.6)', () => {
    it('displays release title in the primary name position with a musical note icon prefix', () => {
      const entry = makeSongsEntry({
        artistName: 'Dynamite', // In Songs mode, artistName holds the release title
        mode: 'songs',
      });
      const snapshot = makeSnapshot([entry]);
      const ds = makeDataStoreForSongsEntries([entry]);

      renderer.update(snapshot, 10, ds);

      // The primary name span should show the release title with ♫ prefix
      const nameSpan = container.querySelector('.bar__name');
      expect(nameSpan).not.toBeNull();
      expect(nameSpan!.textContent).toContain('♫');
      expect(nameSpan!.textContent).toContain('Dynamite');
    });

    it('the musical note icon precedes the release title text', () => {
      const entry = makeSongsEntry({
        artistName: 'Butter',
        mode: 'songs',
      });
      const snapshot = makeSnapshot([entry]);
      const ds = makeDataStoreForSongsEntries([entry]);

      renderer.update(snapshot, 10, ds);

      const nameSpan = container.querySelector('.bar__name');
      expect(nameSpan).not.toBeNull();
      // Should start with ♫ followed by space then title
      expect(nameSpan!.textContent).toMatch(/^♫\s*Butter/);
    });
  });

  // Requirement 2.3 + 2.6: Artist names in secondary position with type indicators
  describe('Artist names in secondary position with type indicators (Req 2.3, 2.6)', () => {
    it('displays artist name with type indicator in the secondary (release) position', () => {
      const entry = makeSongsEntry({
        // In Songs mode: featuredRelease.title contains artist names with indicators
        featuredRelease: { title: 'BTS ▲', releaseId: 'release-1' },
        mode: 'songs',
        coArtists: [makeResolvedArtist({ id: 'bts', name: 'BTS', artistType: 'boy_group' })],
      });
      const snapshot = makeSnapshot([entry]);
      const ds = makeDataStoreForSongsEntries([entry]);

      renderer.update(snapshot, 10, ds);

      // The secondary position (releaseSpan) should show artist names with type indicators
      const releaseSpan = container.querySelector('.bar__release');
      expect(releaseSpan).not.toBeNull();
      expect(releaseSpan!.textContent).toContain('BTS');
      expect(releaseSpan!.textContent).toContain('▲');
    });

    it('displays multiple artist names joined by bullet separator with their type indicators', () => {
      const coArtists = [
        makeResolvedArtist({ id: 'bts', name: 'BTS', artistType: 'boy_group' }),
        makeResolvedArtist({ id: 'aespa', name: 'aespa', artistType: 'girl_group' }),
      ];
      const entry = makeSongsEntry({
        featuredRelease: { title: 'BTS ▲ • aespa ●', releaseId: 'collab-1' },
        mode: 'songs',
        coArtists,
        artistId: 'bts::collab-1',
        releaseKey: 'bts::collab-1',
      });
      const snapshot = makeSnapshot([entry]);
      const ds = makeDataStoreForSongsEntries([entry]);

      renderer.update(snapshot, 10, ds);

      const releaseSpan = container.querySelector('.bar__release');
      expect(releaseSpan).not.toBeNull();
      // Should contain both artist names with indicators joined by bullet
      expect(releaseSpan!.textContent).toContain('BTS');
      expect(releaseSpan!.textContent).toContain('▲');
      expect(releaseSpan!.textContent).toContain('•');
      expect(releaseSpan!.textContent).toContain('aespa');
      expect(releaseSpan!.textContent).toContain('●');
    });

    it('preserves artist order from coArtists array in the secondary label', () => {
      const coArtists = [
        makeResolvedArtist({ id: 'aespa', name: 'aespa', artistType: 'girl_group' }),
        makeResolvedArtist({ id: 'bts', name: 'BTS', artistType: 'boy_group' }),
      ];
      const entry = makeSongsEntry({
        featuredRelease: { title: 'aespa ● • BTS ▲', releaseId: 'collab-2' },
        mode: 'songs',
        coArtists,
        artistId: 'aespa::collab-2',
        releaseKey: 'aespa::collab-2',
      });
      const snapshot = makeSnapshot([entry]);
      const ds = makeDataStoreForSongsEntries([entry]);

      renderer.update(snapshot, 10, ds);

      const releaseSpan = container.querySelector('.bar__release');
      expect(releaseSpan).not.toBeNull();
      const text = releaseSpan!.textContent!;
      // aespa should appear before BTS since that's the coArtists order
      expect(text.indexOf('aespa')).toBeLessThan(text.indexOf('BTS'));
    });
  });

  // Requirement 2.5: Same artist multiple releases → multiple separate bars
  describe('Same artist multiple releases as separate bars (Req 2.5)', () => {
    it('renders separate bars for same artist with different releases', () => {
      const btsArtist = makeResolvedArtist({ id: 'bts', name: 'BTS', logoUrl: 'assets/logos/bts.svg' });

      const entry1 = makeSongsEntry({
        artistId: 'bts::dynamite',
        artistName: 'Dynamite',
        releaseKey: 'bts::dynamite',
        coArtists: [btsArtist],
        rank: 1,
        cumulativeValue: 800,
      });

      const entry2 = makeSongsEntry({
        artistId: 'bts::butter',
        artistName: 'Butter',
        releaseKey: 'bts::butter',
        coArtists: [btsArtist],
        rank: 2,
        cumulativeValue: 600,
      });

      const snapshot = makeSnapshot([entry1, entry2]);
      const ds = makeDataStoreForSongsEntries([entry1, entry2]);

      renderer.update(snapshot, 10, ds);

      // Should have 2 separate bars
      const bars = container.querySelectorAll('.chart-race__bar-wrapper');
      expect(bars.length).toBe(2);

      // Each bar should show a different release title
      const names = container.querySelectorAll('.bar__name');
      expect(names.length).toBe(2);
      const nameTexts = Array.from(names).map(n => n.textContent);
      expect(nameTexts.some(t => t!.includes('Dynamite'))).toBe(true);
      expect(nameTexts.some(t => t!.includes('Butter'))).toBe(true);
    });

    it('each separate bar shows the same artist logo', () => {
      const btsArtist = makeResolvedArtist({ id: 'bts', name: 'BTS', logoUrl: 'assets/logos/bts.svg' });

      const entry1 = makeSongsEntry({
        artistId: 'bts::dynamite',
        artistName: 'Dynamite',
        releaseKey: 'bts::dynamite',
        logoUrl: 'assets/logos/bts.svg',
        coArtists: [btsArtist],
        rank: 1,
        cumulativeValue: 800,
      });

      const entry2 = makeSongsEntry({
        artistId: 'bts::butter',
        artistName: 'Butter',
        releaseKey: 'bts::butter',
        logoUrl: 'assets/logos/bts.svg',
        coArtists: [btsArtist],
        rank: 2,
        cumulativeValue: 600,
      });

      const snapshot = makeSnapshot([entry1, entry2]);
      const ds = makeDataStoreForSongsEntries([entry1, entry2]);

      renderer.update(snapshot, 10, ds);

      // Both bars should have BTS logo
      const logos = container.querySelectorAll('.bar__logo') as NodeListOf<HTMLImageElement>;
      expect(logos.length).toBeGreaterThanOrEqual(2);
      for (const logo of logos) {
        expect(logo.src).toContain('bts.svg');
      }
    });
  });

  // Requirement 4.1: Bar click opens detail panel for first artist (index 0) by default
  describe('Bar click emits first artist ID (Req 4.1)', () => {
    it('clicking a single-artist Songs mode bar emits that artist ID', () => {
      const entry = makeSongsEntry({
        artistId: 'bts::dynamite',
        releaseKey: 'bts::dynamite',
        coArtists: [makeResolvedArtist({ id: 'bts', name: 'BTS' })],
      });
      const snapshot = makeSnapshot([entry]);
      const ds = makeDataStoreForSongsEntries([entry]);

      renderer.update(snapshot, 10, ds);

      const emitted: string[] = [];
      eventBus.on('bar:click', (id: string) => emitted.push(id));

      // Click the bar (not the wrapper background)
      const bar = container.querySelector('.chart-race__bar') as HTMLElement;
      bar.click();

      // For Songs mode, clicking should emit the first artist's ID (index 0)
      // so the detail panel opens for that artist
      expect(emitted.length).toBe(1);
      expect(emitted[0]).toBe('bts');
    });

    it('clicking a multi-artist Songs mode bar emits the first artist ID (index 0)', () => {
      const coArtists = [
        makeResolvedArtist({ id: 'bts', name: 'BTS' }),
        makeResolvedArtist({ id: 'aespa', name: 'aespa' }),
      ];
      const entry = makeSongsEntry({
        artistId: 'bts::collab-release',
        releaseKey: 'bts::collab-release',
        coArtists,
      });
      const snapshot = makeSnapshot([entry]);
      const ds = makeDataStoreForSongsEntries([entry]);

      renderer.update(snapshot, 10, ds);

      const emitted: string[] = [];
      eventBus.on('bar:click', (id: string) => emitted.push(id));

      // Click the bar
      const bar = container.querySelector('.chart-race__bar') as HTMLElement;
      bar.click();

      // Should emit first co-artist's ID (bts at index 0)
      expect(emitted.length).toBe(1);
      expect(emitted[0]).toBe('bts');
    });

    it('clicking a specific artist logo in multi-artist bar emits that artist ID', () => {
      const coArtists = [
        makeResolvedArtist({ id: 'bts', name: 'BTS', logoUrl: 'assets/logos/bts.svg' }),
        makeResolvedArtist({ id: 'aespa', name: 'aespa', logoUrl: 'assets/logos/aespa.svg' }),
      ];
      const entry = makeSongsEntry({
        artistId: 'bts::collab-release',
        releaseKey: 'bts::collab-release',
        coArtists,
      });
      const snapshot = makeSnapshot([entry]);
      const ds = makeDataStoreForSongsEntries([entry]);

      renderer.update(snapshot, 10, ds);

      const emitted: string[] = [];
      eventBus.on('bar:click', (id: string) => emitted.push(id));

      // Click the second logo directly
      const logos = container.querySelectorAll('.bar__logo');
      if (logos.length >= 2) {
        (logos[1] as HTMLElement).click();
        // When clicking a specific artist's logo, should emit that artist's ID
        expect(emitted.length).toBe(1);
        expect(emitted[0]).toBe('aespa');
      }
    });
  });
});
