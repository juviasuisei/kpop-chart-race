import { FilterStateManager, shouldClearImplicitArtist, shouldClearImplicitSource } from '../../src/filter-state-manager.ts';
import type { FilterState } from '../../src/types.ts';
import { EventBus } from '../../src/event-bus.ts';

describe('FilterStateManager', () => {
  let eventBus: EventBus;
  let manager: FilterStateManager;

  beforeEach(() => {
    eventBus = new EventBus();
    manager = new FilterStateManager(eventBus);
  });

  describe('initialization', () => {
    it('should initialize with correct default state', () => {
      const state = manager.getState();

      expect(state.displayMode).toBe('songs');
      expect(state.generation).toBe('all');
      expect(state.source).toBe('all');
      expect(state.zoom).toBe(10);
      expect(state.view).toBe('line');
      expect(state.metric).toBe('points');
    });

    it('should accept partial initial state overrides', () => {
      const custom = new FilterStateManager(eventBus, {
        displayMode: 'artists',
        zoom: 'all',
      });
      const state = custom.getState();

      expect(state.displayMode).toBe('artists');
      expect(state.zoom).toBe('all');
      // defaults preserved for unspecified fields
      expect(state.generation).toBe('all');
      expect(state.source).toBe('all');
      expect(state.view).toBe('line');
      expect(state.metric).toBe('points');
    });
  });

  describe('update()', () => {
    it('should change individual fields and preserve others', () => {
      manager.update({ displayMode: 'artists' });
      const state = manager.getState();

      expect(state.displayMode).toBe('artists');
      // all other fields preserved
      expect(state.generation).toBe('all');
      expect(state.source).toBe('all');
      expect(state.zoom).toBe(10);
      expect(state.view).toBe('line');
      expect(state.metric).toBe('points');
    });

    it('should update multiple fields at once', () => {
      manager.update({ generation: 4, source: 'inkigayo', zoom: 'all' });
      const state = manager.getState();

      expect(state.generation).toBe(4);
      expect(state.source).toBe('inkigayo');
      expect(state.zoom).toBe('all');
      // others preserved
      expect(state.displayMode).toBe('songs');
      expect(state.view).toBe('line');
      expect(state.metric).toBe('points');
    });

    it('should emit "filter:change" event on the EventBus', () => {
      const received: unknown[] = [];
      eventBus.on('filter:change' as any, (...args: unknown[]) => received.push(args));

      manager.update({ zoom: 'all' });

      expect(received.length).toBe(1);
    });

    it('should emit the updated state with the "filter:change" event', () => {
      let emittedState: unknown = null;
      eventBus.on('filter:change' as any, (state: unknown) => {
        emittedState = state;
      });

      manager.update({ source: 'music_bank' });

      expect(emittedState).toEqual({
        displayMode: 'songs',
        generation: 'all',
        source: 'music_bank',
        artist: 'all',
        zoom: 10,
        view: 'line',
        metric: 'points',
      });
    });
  });

  describe('reset()', () => {
    it('should restore all fields to defaults', () => {
      manager.update({
        displayMode: 'artists',
        generation: 3,
        source: 'inkigayo',
        zoom: 'all',
        view: 'yearly',
        metric: 'wins',
      });

      manager.reset();
      const state = manager.getState();

      expect(state.displayMode).toBe('songs');
      expect(state.generation).toBe('all');
      expect(state.source).toBe('all');
      expect(state.zoom).toBe(10);
      expect(state.view).toBe('line');
      expect(state.metric).toBe('points');
    });

    it('should emit "filter:change" event on reset', () => {
      const received: unknown[] = [];
      eventBus.on('filter:change' as any, (...args: unknown[]) => received.push(args));

      manager.update({ zoom: 'all' });
      received.length = 0; // clear from the update call

      manager.reset();

      expect(received.length).toBe(1);
    });
  });

  describe('getState() immutability', () => {
    it('should return an immutable copy — mutations do not affect internal state', () => {
      const state = manager.getState();

      // Attempt to mutate the returned object
      (state as any).displayMode = 'artists';
      (state as any).generation = 5;
      (state as any).source = 'inkigayo';

      // Internal state should be unchanged
      const fresh = manager.getState();
      expect(fresh.displayMode).toBe('songs');
      expect(fresh.generation).toBe('all');
      expect(fresh.source).toBe('all');
    });

    it('should return a new object reference on each call', () => {
      const first = manager.getState();
      const second = manager.getState();

      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    });
  });

  describe('view switch preserves filter values', () => {
    it('should preserve all filter values when switching from race to yearly', () => {
      manager.update({
        displayMode: 'artists',
        generation: 4,
        source: 'music_bank',
        zoom: 'all',
      });

      const beforeSwitch = manager.getState();
      manager.update({ view: 'yearly' });
      const afterSwitch = manager.getState();

      expect(afterSwitch.view).toBe('yearly');
      // All other values preserved
      expect(afterSwitch.displayMode).toBe(beforeSwitch.displayMode);
      expect(afterSwitch.generation).toBe(beforeSwitch.generation);
      expect(afterSwitch.source).toBe(beforeSwitch.source);
      expect(afterSwitch.zoom).toBe(beforeSwitch.zoom);
      expect(afterSwitch.metric).toBe(beforeSwitch.metric);
    });

    it('should preserve all filter values when switching from yearly to line', () => {
      manager.update({
        view: 'yearly',
        displayMode: 'artists',
        generation: 3,
        source: 'inkigayo',
        zoom: 'all',
        metric: 'wins',
      });

      const beforeSwitch = manager.getState();
      manager.update({ view: 'line' });
      const afterSwitch = manager.getState();

      expect(afterSwitch.view).toBe('line');
      // All other values preserved
      expect(afterSwitch.displayMode).toBe(beforeSwitch.displayMode);
      expect(afterSwitch.generation).toBe(beforeSwitch.generation);
      expect(afterSwitch.source).toBe(beforeSwitch.source);
      expect(afterSwitch.zoom).toBe(beforeSwitch.zoom);
      expect(afterSwitch.metric).toBe(beforeSwitch.metric);
    });

    it('should preserve metric value through line→yearly→line round-trip', () => {
      manager.update({ metric: 'wins' });
      manager.update({ view: 'yearly' });
      manager.update({ view: 'line' });

      expect(manager.getState().metric).toBe('wins');
    });
  });

  describe('artist filter provenance (explicit vs. implicit)', () => {
    it('defaults to non-explicit', () => {
      expect(manager.isArtistFilterExplicit()).toBe(false);
    });

    it('marks the artist explicit when opts.artistExplicit is true', () => {
      manager.update({ artist: 'aespa' }, { artistExplicit: true });
      expect(manager.getState().artist).toBe('aespa');
      expect(manager.isArtistFilterExplicit()).toBe(true);
    });

    it('marks the artist implicit when opts.artistExplicit is false', () => {
      manager.update({ artist: 'aespa', view: 'artist-timeline' }, { artistExplicit: false });
      expect(manager.isArtistFilterExplicit()).toBe(false);
    });

    it('leaves the flag unchanged when artist is not part of the update', () => {
      manager.update({ artist: 'aespa' }, { artistExplicit: true });
      manager.update({ view: 'episodes' }); // no artist key
      expect(manager.isArtistFilterExplicit()).toBe(true);
    });

    it('resets the flag to non-explicit when the artist is cleared to "all"', () => {
      manager.update({ artist: 'aespa' }, { artistExplicit: true });
      manager.update({ artist: 'all' });
      expect(manager.isArtistFilterExplicit()).toBe(false);
    });

    it('does not treat clearing to "all" as explicit even if opts omitted', () => {
      manager.update({ artist: 'aespa' }, { artistExplicit: true });
      manager.update({ artist: 'all' }); // implicit clear
      expect(manager.getState().artist).toBe('all');
      expect(manager.isArtistFilterExplicit()).toBe(false);
    });

    it('reset() clears the explicit flag', () => {
      manager.update({ artist: 'aespa' }, { artistExplicit: true });
      manager.reset();
      expect(manager.isArtistFilterExplicit()).toBe(false);
      expect(manager.getState().artist).toBe('all');
    });

    it('a later explicit selection overrides a prior implicit one', () => {
      manager.update({ artist: 'aespa', view: 'artist-timeline' }, { artistExplicit: false });
      expect(manager.isArtistFilterExplicit()).toBe(false);
      manager.update({ artist: 'bts' }, { artistExplicit: true });
      expect(manager.isArtistFilterExplicit()).toBe(true);
    });
  });

  describe('source filter provenance (explicit vs. implicit)', () => {
    it('defaults to non-explicit', () => {
      expect(manager.isSourceFilterExplicit()).toBe(false);
    });

    it('marks the source explicit when opts.sourceExplicit is true', () => {
      manager.update({ source: 'inkigayo' }, { sourceExplicit: true });
      expect(manager.getState().source).toBe('inkigayo');
      expect(manager.isSourceFilterExplicit()).toBe(true);
    });

    it('marks the source implicit when opts.sourceExplicit is false', () => {
      manager.update({ source: 'inkigayo', view: 'episodes' }, { sourceExplicit: false });
      expect(manager.isSourceFilterExplicit()).toBe(false);
    });

    it('leaves the flag unchanged when source is not part of the update', () => {
      manager.update({ source: 'inkigayo' }, { sourceExplicit: true });
      manager.update({ view: 'yearly' }); // no source key
      expect(manager.isSourceFilterExplicit()).toBe(true);
    });

    it('resets the flag to non-explicit when the source is cleared to "all"', () => {
      manager.update({ source: 'inkigayo' }, { sourceExplicit: true });
      manager.update({ source: 'all' });
      expect(manager.isSourceFilterExplicit()).toBe(false);
    });

    it('reset() clears the explicit flag', () => {
      manager.update({ source: 'inkigayo' }, { sourceExplicit: true });
      manager.reset();
      expect(manager.isSourceFilterExplicit()).toBe(false);
      expect(manager.getState().source).toBe('all');
    });

    it('artist and source provenance flags are independent', () => {
      manager.update({ artist: 'aespa' }, { artistExplicit: true });
      manager.update({ source: 'inkigayo', view: 'episodes' }, { sourceExplicit: false });
      expect(manager.isArtistFilterExplicit()).toBe(true);
      expect(manager.isSourceFilterExplicit()).toBe(false);
    });
  });

  describe('automatic implicit-filter clearing on view change', () => {
    // update() folds the implicit-clear in, so a single update produces the
    // final, cleared state (no re-emit). These test the wired behavior end to
    // end via the manager, replacing the old parity-harness router test.

    it('clears an implicit artist when navigating away from the timeline', () => {
      manager.update({ artist: 'aespa', view: 'artist-timeline' }, { artistExplicit: false });
      expect(manager.getState().artist).toBe('aespa'); // stays on its home view

      manager.update({ view: 'episodes' });
      expect(manager.getState().artist).toBe('all');
      expect(manager.isArtistFilterExplicit()).toBe(false);
    });

    it('keeps an explicit artist when navigating away from the timeline', () => {
      manager.update({ artist: 'aespa' }, { artistExplicit: true }); // dropdown choice
      manager.update({ view: 'episodes' });
      expect(manager.getState().artist).toBe('aespa');
    });

    it('clears an implicit source when navigating away from episodes', () => {
      manager.update({ source: 'inkigayo', view: 'episodes' }, { sourceExplicit: false });
      expect(manager.getState().source).toBe('inkigayo'); // stays on episodes

      manager.update({ view: 'line' });
      expect(manager.getState().source).toBe('all');
      expect(manager.isSourceFilterExplicit()).toBe(false);
    });

    it('keeps an explicit source when navigating away from episodes', () => {
      manager.update({ source: 'inkigayo' }, { sourceExplicit: true });
      manager.update({ view: 'yearly' });
      expect(manager.getState().source).toBe('inkigayo');
    });

    it('clears the implicit artist but keeps the just-set implicit source when drilling timeline→show', () => {
      // Click an artist name → timeline (implicit artist).
      manager.update({ artist: 'aespa', view: 'artist-timeline' }, { artistExplicit: false });
      // Click a show link in the timeline → episodes scoped to a source.
      manager.update({ view: 'episodes', source: 'the_show' }, { sourceExplicit: false });

      // Landing on episodes: implicit artist cleared (not its home), source kept.
      expect(manager.getState().artist).toBe('all');
      expect(manager.getState().source).toBe('the_show');

      // Navigate to race → the implicit source clears too.
      manager.update({ view: 'line' });
      expect(manager.getState().source).toBe('all');
    });

    it('emits filter:change exactly once per update (no re-emit from clearing)', () => {
      manager.update({ source: 'inkigayo', view: 'episodes' }, { sourceExplicit: false });

      let emitCount = 0;
      let lastState: FilterState | null = null;
      eventBus.on('filter:change', (s) => {
        emitCount++;
        lastState = s;
      });

      // Navigating away triggers a clear — but it must be folded into this
      // single update, so filter:change fires exactly once with source cleared.
      manager.update({ view: 'line' });
      expect(emitCount).toBe(1);
      expect(lastState!.source).toBe('all');
    });
  });
});

describe('shouldClearImplicitArtist', () => {
  // An implicit artist (set by drilling in) is cleared on any non-timeline
  // view; an explicit artist persists everywhere; the timeline never clears.

  it('clears an implicit artist when navigating to episodes', () => {
    expect(shouldClearImplicitArtist('episodes', 'aespa', false)).toBe(true);
  });

  it('clears an implicit artist when navigating to yearly', () => {
    expect(shouldClearImplicitArtist('yearly', 'aespa', false)).toBe(true);
  });

  it('clears an implicit artist when navigating to the race/line view', () => {
    expect(shouldClearImplicitArtist('line', 'aespa', false)).toBe(true);
  });

  it('keeps an explicit artist when navigating to episodes', () => {
    expect(shouldClearImplicitArtist('episodes', 'aespa', true)).toBe(false);
  });

  it('never clears while on the artist-timeline view (it is the subject)', () => {
    expect(shouldClearImplicitArtist('artist-timeline', 'aespa', false)).toBe(false);
    expect(shouldClearImplicitArtist('artist-timeline', 'aespa', true)).toBe(false);
  });

  it('is a no-op when there is no artist filter', () => {
    expect(shouldClearImplicitArtist('episodes', 'all', false)).toBe(false);
  });
});

describe('shouldClearImplicitSource', () => {
  // An implicit source (set by drilling into a show) is cleared on any
  // non-episodes view; an explicit source persists; episodes never clears.

  it('clears an implicit source when navigating to yearly', () => {
    expect(shouldClearImplicitSource('yearly', 'inkigayo', false)).toBe(true);
  });

  it('clears an implicit source when navigating to the race/line view', () => {
    expect(shouldClearImplicitSource('line', 'inkigayo', false)).toBe(true);
  });

  it('clears an implicit source when navigating to the artist timeline', () => {
    expect(shouldClearImplicitSource('artist-timeline', 'inkigayo', false)).toBe(true);
  });

  it('keeps an explicit source when navigating away from episodes', () => {
    expect(shouldClearImplicitSource('yearly', 'inkigayo', true)).toBe(false);
  });

  it('never clears while on the episodes view (its home)', () => {
    expect(shouldClearImplicitSource('episodes', 'inkigayo', false)).toBe(false);
    expect(shouldClearImplicitSource('episodes', 'inkigayo', true)).toBe(false);
  });

  it('is a no-op when there is no source filter', () => {
    expect(shouldClearImplicitSource('yearly', 'all', false)).toBe(false);
  });
});
