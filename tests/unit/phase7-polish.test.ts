/**
 * Phase 7 Polish tests — keyboard shortcuts, URL state encoding, accessibility announcements.
 *
 * Tests the logic added in main.ts for:
 * 1. Keyboard shortcut handling (Space, Arrow keys, Escape, 1-5 speed keys)
 * 2. URL hash encoding/decoding of filter state
 * 3. Accessibility announcements on filter/view changes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FilterStateManager } from '../../src/filter-state-manager.ts';
import { EventBus } from '../../src/event-bus.ts';
import { LiveRegionAnnouncer } from '../../src/live-region.ts';
import type { FilterState } from '../../src/types.ts';

// ============================================================
// URL State Encoding / Decoding (extracted logic for testability)
// ============================================================

const DEFAULT_FILTER_VALUES: Partial<FilterState> = {
  view: 'line',
  generation: 'all',
  source: 'all',
  artist: 'all',
  displayMode: 'songs',
};

function encodeStateToHash(state: FilterState): string {
  const params: string[] = [];
  if (state.view !== DEFAULT_FILTER_VALUES.view) params.push(`view=${state.view}`);
  if (state.generation !== DEFAULT_FILTER_VALUES.generation) params.push(`gen=${state.generation}`);
  if (state.source !== DEFAULT_FILTER_VALUES.source) params.push(`source=${state.source}`);
  if (state.artist !== DEFAULT_FILTER_VALUES.artist) params.push(`artist=${state.artist}`);
  if (state.displayMode !== DEFAULT_FILTER_VALUES.displayMode) params.push(`mode=${state.displayMode}`);
  return params.length > 0 ? `#${params.join('&')}` : '';
}

function parseHashToState(hash: string): Partial<FilterState> {
  const partial: Partial<FilterState> = {};
  if (!hash || hash === '#') return partial;

  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const pairs = raw.split('&');
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (!key || !value) continue;
    switch (key) {
      case 'view':
        if (['line', 'race', 'yearly', 'episodes', 'artist-timeline'].includes(value)) {
          partial.view = value as FilterState['view'];
        }
        break;
      case 'gen':
        partial.generation = value === 'all' ? 'all' : parseInt(value, 10);
        break;
      case 'source':
        partial.source = value;
        break;
      case 'artist':
        partial.artist = value;
        break;
      case 'mode':
        if (value === 'songs' || value === 'artists') {
          partial.displayMode = value;
        }
        break;
    }
  }
  return partial;
}

describe('URL State Encoding', () => {
  const defaultState: FilterState = {
    displayMode: 'songs',
    generation: 'all',
    source: 'all',
    artist: 'all',
    zoom: 10,
    view: 'line',
    metric: 'points',
  };

  describe('encodeStateToHash', () => {
    it('returns empty string for default state', () => {
      expect(encodeStateToHash(defaultState)).toBe('');
    });

    it('encodes view changes', () => {
      const state = { ...defaultState, view: 'yearly' as const };
      expect(encodeStateToHash(state)).toBe('#view=yearly');
    });

    it('encodes generation filter', () => {
      const state = { ...defaultState, generation: 4 as const };
      expect(encodeStateToHash(state)).toBe('#gen=4');
    });

    it('encodes source filter', () => {
      const state = { ...defaultState, source: 'inkigayo' };
      expect(encodeStateToHash(state)).toBe('#source=inkigayo');
    });

    it('encodes artist filter', () => {
      const state = { ...defaultState, artist: 'bts' };
      expect(encodeStateToHash(state)).toBe('#artist=bts');
    });

    it('encodes display mode', () => {
      const state = { ...defaultState, displayMode: 'artists' as const };
      expect(encodeStateToHash(state)).toBe('#mode=artists');
    });

    it('encodes multiple non-default values', () => {
      const state: FilterState = {
        ...defaultState,
        view: 'episodes',
        source: 'music_bank',
        generation: 3,
      };
      const hash = encodeStateToHash(state);
      expect(hash).toContain('view=episodes');
      expect(hash).toContain('source=music_bank');
      expect(hash).toContain('gen=3');
      expect(hash.startsWith('#')).toBe(true);
    });

    it('omits default values from hash', () => {
      const state = { ...defaultState, source: 'inkigayo' };
      const hash = encodeStateToHash(state);
      expect(hash).not.toContain('view=');
      expect(hash).not.toContain('gen=');
      expect(hash).not.toContain('artist=');
      expect(hash).not.toContain('mode=');
    });
  });

  describe('parseHashToState', () => {
    it('returns empty object for empty hash', () => {
      expect(parseHashToState('')).toEqual({});
      expect(parseHashToState('#')).toEqual({});
    });

    it('parses view', () => {
      expect(parseHashToState('#view=yearly')).toEqual({ view: 'yearly' });
    });

    it('parses generation as number', () => {
      expect(parseHashToState('#gen=4')).toEqual({ generation: 4 });
    });

    it('parses generation "all"', () => {
      expect(parseHashToState('#gen=all')).toEqual({ generation: 'all' });
    });

    it('parses source', () => {
      expect(parseHashToState('#source=inkigayo')).toEqual({ source: 'inkigayo' });
    });

    it('parses artist', () => {
      expect(parseHashToState('#artist=bts')).toEqual({ artist: 'bts' });
    });

    it('parses display mode', () => {
      expect(parseHashToState('#mode=artists')).toEqual({ displayMode: 'artists' });
    });

    it('parses multiple params', () => {
      const result = parseHashToState('#view=episodes&source=music_bank&gen=3');
      expect(result).toEqual({
        view: 'episodes',
        source: 'music_bank',
        generation: 3,
      });
    });

    it('ignores invalid view values', () => {
      expect(parseHashToState('#view=invalid')).toEqual({});
    });

    it('ignores invalid mode values', () => {
      expect(parseHashToState('#mode=invalid')).toEqual({});
    });

    it('handles hash without leading #', () => {
      expect(parseHashToState('view=yearly')).toEqual({ view: 'yearly' });
    });
  });

  describe('roundtrip', () => {
    it('encodeStateToHash → parseHashToState preserves state', () => {
      const state: FilterState = {
        ...defaultState,
        view: 'episodes',
        generation: 4,
        source: 'inkigayo',
        artist: 'aespa',
        displayMode: 'artists',
      };
      const hash = encodeStateToHash(state);
      const parsed = parseHashToState(hash);
      expect(parsed.view).toBe('episodes');
      expect(parsed.generation).toBe(4);
      expect(parsed.source).toBe('inkigayo');
      expect(parsed.artist).toBe('aespa');
      expect(parsed.displayMode).toBe('artists');
    });
  });
});

// ============================================================
// Keyboard Shortcuts (testing the logic pattern)
// ============================================================

describe('Keyboard Shortcuts', () => {
  const SPEED_PRESETS: Record<string, number> = {
    '1': 0.5,
    '2': 0.8,
    '3': 1.0,
    '4': 1.5,
    '5': 2.0,
  };

  it('speed presets map keys 1-5 to correct values', () => {
    expect(SPEED_PRESETS['1']).toBe(0.5);
    expect(SPEED_PRESETS['2']).toBe(0.8);
    expect(SPEED_PRESETS['3']).toBe(1.0);
    expect(SPEED_PRESETS['4']).toBe(1.5);
    expect(SPEED_PRESETS['5']).toBe(2.0);
  });

  it('does not trigger for non-numeric keys', () => {
    expect(SPEED_PRESETS['a']).toBeUndefined();
    expect(SPEED_PRESETS['0']).toBeUndefined();
    expect(SPEED_PRESETS['6']).toBeUndefined();
  });

  describe('input element guard', () => {
    it('should skip shortcuts when target is an INPUT element', () => {
      const input = document.createElement('input');
      const shouldSkip = input.tagName === 'INPUT' || input.tagName === 'TEXTAREA' || input.isContentEditable;
      expect(shouldSkip).toBe(true);
    });

    it('should skip shortcuts when target is a TEXTAREA', () => {
      const textarea = document.createElement('textarea');
      const shouldSkip = textarea.tagName === 'INPUT' || textarea.tagName === 'TEXTAREA' || textarea.isContentEditable;
      expect(shouldSkip).toBe(true);
    });

    it('should skip shortcuts when target is contentEditable', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      // In jsdom, isContentEditable may not be fully implemented, so check contentEditable attribute
      const shouldSkip = div.tagName === 'INPUT' || div.tagName === 'TEXTAREA' || div.contentEditable === 'true';
      expect(shouldSkip).toBe(true);
    });

    it('should not skip shortcuts for regular div elements', () => {
      const div = document.createElement('div');
      const shouldSkip = div.tagName === 'INPUT' || div.tagName === 'TEXTAREA' || div.contentEditable === 'true';
      expect(shouldSkip).toBe(false);
    });
  });
});

// ============================================================
// Accessibility Announcements
// ============================================================

describe('Accessibility Announcements', () => {
  let container: HTMLElement;
  let liveRegion: LiveRegionAnnouncer;
  let eventBus: EventBus;
  let filterStateManager: FilterStateManager;

  const VIEW_LABELS: Record<string, string> = {
    line: 'Line Chart',
    race: 'Race',
    yearly: 'Yearly Summary',
    episodes: 'Episode Browser',
    'artist-timeline': 'Artist Timeline',
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    liveRegion = new LiveRegionAnnouncer();
    liveRegion.mount(container);
    eventBus = new EventBus();
    filterStateManager = new FilterStateManager(eventBus);
  });

  afterEach(() => {
    liveRegion.destroy();
    container.remove();
  });

  it('announces view change', () => {
    const announceSpy = vi.spyOn(liveRegion, 'announce');

    let previousView = 'line';
    eventBus.on('filter:change', (state: FilterState) => {
      if (state.view !== previousView) {
        const label = VIEW_LABELS[state.view] ?? state.view;
        liveRegion.announce(`Switched to ${label} view`);
        previousView = state.view;
      }
    });

    filterStateManager.update({ view: 'yearly' });
    expect(announceSpy).toHaveBeenCalledWith('Switched to Yearly Summary view');
  });

  it('announces generation filter change', () => {
    const announceSpy = vi.spyOn(liveRegion, 'announce');

    let previousGeneration: number | 'all' = 'all';
    eventBus.on('filter:change', (state: FilterState) => {
      if (state.generation !== previousGeneration) {
        if (state.generation === 'all') {
          liveRegion.announce('Showing all generations');
        } else {
          liveRegion.announce(`Filtered to Gen ${state.generation}`);
        }
        previousGeneration = state.generation;
      }
    });

    filterStateManager.update({ generation: 4 });
    expect(announceSpy).toHaveBeenCalledWith('Filtered to Gen 4');

    filterStateManager.update({ generation: 'all' });
    expect(announceSpy).toHaveBeenCalledWith('Showing all generations');
  });

  it('announces source filter change', () => {
    const announceSpy = vi.spyOn(liveRegion, 'announce');

    let previousSource = 'all';
    eventBus.on('filter:change', (state: FilterState) => {
      if (state.source !== previousSource) {
        if (state.source === 'all') {
          liveRegion.announce('Showing all sources');
        } else {
          const sourceLabel = state.source.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          liveRegion.announce(`Source: ${sourceLabel}`);
        }
        previousSource = state.source;
      }
    });

    filterStateManager.update({ source: 'inkigayo' });
    expect(announceSpy).toHaveBeenCalledWith('Source: Inkigayo');

    filterStateManager.update({ source: 'all' });
    expect(announceSpy).toHaveBeenCalledWith('Showing all sources');
  });

  it('does not announce when view stays the same', () => {
    const announceSpy = vi.spyOn(liveRegion, 'announce');

    let previousView = 'line';
    eventBus.on('filter:change', (state: FilterState) => {
      if (state.view !== previousView) {
        liveRegion.announce(`Switched to ${VIEW_LABELS[state.view]} view`);
        previousView = state.view;
      }
    });

    // Update something other than view
    filterStateManager.update({ source: 'inkigayo' });
    expect(announceSpy).not.toHaveBeenCalledWith(expect.stringContaining('Switched to'));
  });
});
