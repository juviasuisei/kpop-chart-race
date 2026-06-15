import { FilterStateManager } from '../../src/filter-state-manager.ts';
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
      expect(state.view).toBe('race');
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
      expect(state.view).toBe('race');
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
      expect(state.view).toBe('race');
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
      expect(state.view).toBe('race');
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
        zoom: 10,
        view: 'race',
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
      expect(state.view).toBe('race');
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

    it('should preserve all filter values when switching from yearly to race', () => {
      manager.update({
        view: 'yearly',
        displayMode: 'artists',
        generation: 3,
        source: 'inkigayo',
        zoom: 'all',
        metric: 'wins',
      });

      const beforeSwitch = manager.getState();
      manager.update({ view: 'race' });
      const afterSwitch = manager.getState();

      expect(afterSwitch.view).toBe('race');
      // All other values preserved
      expect(afterSwitch.displayMode).toBe(beforeSwitch.displayMode);
      expect(afterSwitch.generation).toBe(beforeSwitch.generation);
      expect(afterSwitch.source).toBe(beforeSwitch.source);
      expect(afterSwitch.zoom).toBe(beforeSwitch.zoom);
      expect(afterSwitch.metric).toBe(beforeSwitch.metric);
    });

    it('should preserve metric value through race→yearly→race round-trip', () => {
      manager.update({ metric: 'wins' });
      manager.update({ view: 'yearly' });
      manager.update({ view: 'race' });

      expect(manager.getState().metric).toBe('wins');
    });
  });
});
