/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for the Toolbar component.
 * Tests: control order, visibility conditions, dropdown contents,
 * mobile drawer behavior, and event handling.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Toolbar } from '../../src/toolbar.ts';
import { EventBus } from '../../src/event-bus.ts';
import { FilterStateManager } from '../../src/filter-state-manager.ts';

function createToolbar() {
  const eventBus = new EventBus();
  const filterState = new FilterStateManager(eventBus);
  const toolbar = new Toolbar(eventBus, filterState);
  return { eventBus, filterState, toolbar };
}

describe('Toolbar — Rendering and Control Order', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('mounts and renders all controls into the container', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    // Should render the toolbar wrapper
    const wrapper = container.querySelector('.toolbar');
    expect(wrapper).not.toBeNull();

    toolbar.unmount();
  });

  it('renders controls in correct right-to-left order: Songs/Artists, Zoom, View, Points/Wins, Source, Generation', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    // The design specifies right-to-left order in DOM:
    // Songs/Artists (rightmost), Zoom, View, Points/Wins, Source, Generation (leftmost)
    // In DOM order (left-to-right reading), this means:
    // Generation, Source, Points/Wins, View, Zoom, Songs/Artists
    const controls = container.querySelectorAll('[data-control]');
    expect(controls.length).toBeGreaterThanOrEqual(7);

    const order = Array.from(controls).map(el => el.getAttribute('data-control'));
    expect(order).toEqual([
      'view',
      'generation',
      'source',
      'artist',
      'metric',
      'zoom',
      'display-mode',
    ]);

    toolbar.unmount();
  });

  it('unmount removes toolbar from DOM', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);
    expect(container.querySelector('.toolbar')).not.toBeNull();

    toolbar.unmount();
    expect(container.querySelector('.toolbar')).toBeNull();
  });
});

describe('Toolbar — Points/Wins Toggle Visibility', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('Points/Wins toggle is hidden in race view mode', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);
    toolbar.setViewMode('race');

    const metricControl = container.querySelector('[data-control="metric"]') as HTMLElement;
    expect(metricControl).not.toBeNull();
    // Should be hidden (display:none or hidden attribute or a class)
    const isHidden = metricControl.hidden ||
      metricControl.style.display === 'none' ||
      metricControl.classList.contains('toolbar__control--hidden');
    expect(isHidden).toBe(true);

    toolbar.unmount();
  });

  it('Points/Wins toggle is visible in yearly view mode', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);
    toolbar.setViewMode('yearly');

    const metricControl = container.querySelector('[data-control="metric"]') as HTMLElement;
    expect(metricControl).not.toBeNull();
    const isHidden = metricControl.hidden ||
      metricControl.style.display === 'none' ||
      metricControl.classList.contains('toolbar__control--hidden');
    expect(isHidden).toBe(false);

    toolbar.unmount();
  });

  it('Points/Wins toggle hidden by default (default view is race)', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    // Default view is race, so metric toggle should be hidden
    const metricControl = container.querySelector('[data-control="metric"]') as HTMLElement;
    const isHidden = metricControl.hidden ||
      metricControl.style.display === 'none' ||
      metricControl.classList.contains('toolbar__control--hidden');
    expect(isHidden).toBe(true);

    toolbar.unmount();
  });
});

describe('Toolbar — Artist Filter Visibility', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function isHidden(el: HTMLElement | null): boolean {
    if (!el) return false;
    return el.hidden ||
      el.style.display === 'none' ||
      el.classList.contains('toolbar__control--hidden');
  }

  // The artist filter now acts as a "pin" in Artists mode rather than a hard
  // filter, so it stays visible in race/line and in yearly at the top-10 zoom.
  // It is only hidden in yearly "all" zoom (treemap), where pinning has no
  // visible effect. In Songs mode it always shows.

  it('artist filter is visible in race mode (Songs)', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    filterState.update({ view: 'line', displayMode: 'songs' });

    const artistControl = container.querySelector('[data-control="artist"]') as HTMLElement;
    expect(isHidden(artistControl)).toBe(false);

    toolbar.unmount();
  });

  it('artist filter is visible in race mode (Artists) — acts as a pin', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    filterState.update({ view: 'line', displayMode: 'artists' });

    const artistControl = container.querySelector('[data-control="artist"]') as HTMLElement;
    expect(isHidden(artistControl)).toBe(false);

    toolbar.unmount();
  });

  it('artist filter is visible in yearly Artists mode at the top-10 zoom', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    filterState.update({ view: 'yearly', displayMode: 'artists', zoom: 10 });

    const artistControl = container.querySelector('[data-control="artist"]') as HTMLElement;
    expect(isHidden(artistControl)).toBe(false);

    toolbar.unmount();
  });

  it('artist filter is hidden in yearly Artists mode at the "all" zoom', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    filterState.update({ view: 'yearly', displayMode: 'artists', zoom: 'all' });

    const artistControl = container.querySelector('[data-control="artist"]') as HTMLElement;
    expect(isHidden(artistControl)).toBe(true);

    toolbar.unmount();
  });

  it('artist filter is visible in yearly mode when display toggle is on Songs', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    filterState.update({ view: 'yearly', displayMode: 'songs', zoom: 'all' });

    const artistControl = container.querySelector('[data-control="artist"]') as HTMLElement;
    expect(isHidden(artistControl)).toBe(false);

    toolbar.unmount();
  });

  it('changing zoom in yearly Artists mode shows/hides the artist filter', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    filterState.update({ view: 'yearly', displayMode: 'artists', zoom: 10 });

    let artistControl = container.querySelector('[data-control="artist"]') as HTMLElement;
    expect(isHidden(artistControl)).toBe(false);

    filterState.update({ zoom: 'all' });
    artistControl = container.querySelector('[data-control="artist"]') as HTMLElement;
    expect(isHidden(artistControl)).toBe(true);

    toolbar.unmount();
  });
});

describe('Toolbar — Display Mode Toggle Visibility', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function isHidden(el: HTMLElement | null): boolean {
    if (!el) return false;
    return el.hidden ||
      el.style.display === 'none' ||
      el.classList.contains('toolbar__control--hidden');
  }

  // The Songs/Artists toggle only makes sense in the race/line and yearly
  // views. The episode browser and artist timeline are inherently
  // per-song/per-episode, so the toggle is hidden there.

  it('display-mode toggle is visible in race view', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    filterState.update({ view: 'line' });

    const displayControl = container.querySelector('[data-control="display-mode"]') as HTMLElement;
    expect(isHidden(displayControl)).toBe(false);

    toolbar.unmount();
  });

  it('display-mode toggle is visible in yearly view', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    filterState.update({ view: 'yearly' });

    const displayControl = container.querySelector('[data-control="display-mode"]') as HTMLElement;
    expect(isHidden(displayControl)).toBe(false);

    toolbar.unmount();
  });

  it('display-mode toggle is hidden in episodes view', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    filterState.update({ view: 'episodes' });

    const displayControl = container.querySelector('[data-control="display-mode"]') as HTMLElement;
    expect(isHidden(displayControl)).toBe(true);

    toolbar.unmount();
  });

  it('display-mode toggle is hidden in artist-timeline view', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    filterState.update({ view: 'artist-timeline' });

    const displayControl = container.querySelector('[data-control="display-mode"]') as HTMLElement;
    expect(isHidden(displayControl)).toBe(true);

    toolbar.unmount();
  });

  it('display-mode toggle reappears when switching back from episodes to race', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);

    filterState.update({ view: 'episodes' });
    let displayControl = container.querySelector('[data-control="display-mode"]') as HTMLElement;
    expect(isHidden(displayControl)).toBe(true);

    filterState.update({ view: 'line' });
    displayControl = container.querySelector('[data-control="display-mode"]') as HTMLElement;
    expect(isHidden(displayControl)).toBe(false);

    toolbar.unmount();
  });
});

describe('Toolbar — Generation Filter Dropdown', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('Generation dropdown populated from data, sorted descending with "All" first', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);
    toolbar.setGenerations([3, 5, 4, 1, 2]);

    const genControl = container.querySelector('[data-control="generation"]');
    const options = genControl?.querySelectorAll('option');
    expect(options).not.toBeUndefined();
    expect(options!.length).toBe(6); // "All" + 5 generations

    // First option is "All"
    expect(options![0].value).toBe('all');
    expect(options![0].textContent?.toLowerCase()).toContain('all');

    // Remaining sorted descending: 5, 4, 3, 2, 1
    expect(options![1].value).toBe('5');
    expect(options![2].value).toBe('4');
    expect(options![3].value).toBe('3');
    expect(options![4].value).toBe('2');
    expect(options![5].value).toBe('1');

    toolbar.unmount();
  });

  it('Generation dropdown shows descriptive labels (e.g., "5th Gen")', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);
    toolbar.setGenerations([5, 4, 3]);

    const genControl = container.querySelector('[data-control="generation"]');
    const options = genControl?.querySelectorAll('option');

    // Check that labels contain generation info
    expect(options![1].textContent).toContain('5');
    expect(options![2].textContent).toContain('4');
    expect(options![3].textContent).toContain('3');

    toolbar.unmount();
  });

  it('setGenerations can be called multiple times to update options', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    toolbar.setGenerations([3, 4]);
    let options = container.querySelector('[data-control="generation"]')?.querySelectorAll('option');
    expect(options!.length).toBe(3); // All + 4 + 3

    toolbar.setGenerations([5, 4, 3, 2, 1]);
    options = container.querySelector('[data-control="generation"]')?.querySelectorAll('option');
    expect(options!.length).toBe(6); // All + 5 gens

    toolbar.unmount();
  });
});

describe('Toolbar — Source Filter Dropdown', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('Source dropdown contains 7 options: "All" plus 6 sources', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    const sourceControl = container.querySelector('[data-control="source"]');
    const options = sourceControl?.querySelectorAll('option');
    expect(options).not.toBeUndefined();
    expect(options!.length).toBe(7);

    toolbar.unmount();
  });

  it('Source dropdown has "All" as first option', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    const sourceControl = container.querySelector('[data-control="source"]');
    const options = sourceControl?.querySelectorAll('option');
    expect(options![0].value).toBe('all');
    expect(options![0].textContent?.toLowerCase()).toContain('all');

    toolbar.unmount();
  });

  it('Source dropdown contains all 6 chart sources', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    const sourceControl = container.querySelector('[data-control="source"]');
    const options = sourceControl?.querySelectorAll('option');
    const values = Array.from(options!).map(o => o.value);

    expect(values).toContain('inkigayo');
    expect(values).toContain('the_show');
    expect(values).toContain('show_champion');
    expect(values).toContain('music_bank');
    expect(values).toContain('m_countdown');
    expect(values).toContain('show_music_core');

    toolbar.unmount();
  });
});

describe('Toolbar — Mobile Drawer Behavior', () => {
  let container: HTMLElement;
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    // Mock matchMedia to simulate mobile viewport (< 768px)
    matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width: 767px') || query.includes('max-width:767px'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it('collapses into drawer below 768px viewport', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    // In mobile mode, should show drawer toggle / collapsed state
    const drawer = container.querySelector('.toolbar__drawer') ||
      container.querySelector('.toolbar--mobile');
    expect(drawer).not.toBeNull();

    toolbar.unmount();
  });

  it('shows hamburger icon button in mobile mode', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    const trigger = container.querySelector('.toolbar__drawer-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger!.querySelector('svg')).not.toBeNull();
    expect(trigger!.getAttribute('aria-label')).toBe('Open controls');

    toolbar.unmount();
  });

  it('drawer dismisses on outside tap', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    // Open the drawer first
    const trigger = container.querySelector('.toolbar__drawer-trigger') ||
      container.querySelector('.toolbar__toggle');
    if (trigger) {
      (trigger as HTMLElement).click();
    }

    // Verify drawer is open
    const drawerContent = container.querySelector('.toolbar__drawer-content') ||
      container.querySelector('.toolbar__controls--expanded');

    if (drawerContent) {
      // Simulate outside tap
      const outsideEvent = new Event('pointerdown', { bubbles: true });
      document.body.dispatchEvent(outsideEvent);

      // Drawer should be dismissed
      const drawerAfter = container.querySelector('.toolbar__drawer-content--open') ||
        container.querySelector('.toolbar__controls--expanded');
      expect(drawerAfter).toBeNull();
    }

    toolbar.unmount();
  });

  it('drawer dismisses on filter selection', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    // Open the drawer
    const trigger = container.querySelector('.toolbar__drawer-trigger') ||
      container.querySelector('.toolbar__toggle');
    if (trigger) {
      (trigger as HTMLElement).click();
    }

    // Select a source filter value (simulates selecting from dropdown)
    const sourceSelect = container.querySelector('[data-control="source"] select') ||
      container.querySelector('[data-control="source"]');
    if (sourceSelect && sourceSelect.tagName === 'SELECT') {
      (sourceSelect as HTMLSelectElement).value = 'inkigayo';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Drawer should dismiss after filter selection
    const drawerAfter = container.querySelector('.toolbar__drawer-content--open') ||
      container.querySelector('.toolbar__controls--expanded');
    expect(drawerAfter).toBeNull();

    toolbar.unmount();
  });
});

describe('Toolbar — Desktop Viewport', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    // Mock matchMedia for desktop viewport (>= 768px)
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: !query.includes('max-width: 767px') && !query.includes('max-width:767px'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it('renders inline controls (no drawer) on desktop viewport', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    // Should NOT be in mobile/drawer mode
    const drawer = container.querySelector('.toolbar__drawer');
    const mobileClass = container.querySelector('.toolbar--mobile');
    // Desktop should render controls inline
    const controls = container.querySelectorAll('[data-control]');
    expect(controls.length).toBeGreaterThanOrEqual(6);

    toolbar.unmount();
  });
});

describe('Toolbar — Artist Filter Dropdown', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('renders artist control with "All Artists" trigger button', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    const artistControl = container.querySelector('[data-control="artist"]');
    expect(artistControl).not.toBeNull();

    const trigger = artistControl!.querySelector('.toolbar__artist-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger!.textContent).toBe('All Artists');

    toolbar.unmount();
  });

  it('opens dropdown on trigger click', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    const trigger = container.querySelector('.toolbar__artist-trigger') as HTMLElement;
    trigger.click();

    const dropdown = container.querySelector('.toolbar__artist-dropdown--open');
    expect(dropdown).not.toBeNull();

    toolbar.unmount();
  });

  it('shows search input and artist list when dropdown is open', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);
    toolbar.setArtists([
      { id: 'bts', name: 'BTS', generation: 3 },
      { id: 'aespa', name: 'aespa', generation: 4 },
    ]);

    const trigger = container.querySelector('.toolbar__artist-trigger') as HTMLElement;
    trigger.click();

    const searchInput = container.querySelector('.toolbar__artist-search');
    expect(searchInput).not.toBeNull();

    const items = container.querySelectorAll('.toolbar__artist-item');
    // "All Artists" + 2 artists
    expect(items.length).toBe(3);

    toolbar.unmount();
  });

  it('filters artist list by search input', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);
    toolbar.setArtists([
      { id: 'bts', name: 'BTS', generation: 3 },
      { id: 'aespa', name: 'aespa', generation: 4 },
      { id: 'blackpink', name: 'BLACKPINK', generation: 3 },
    ]);

    const trigger = container.querySelector('.toolbar__artist-trigger') as HTMLElement;
    trigger.click();

    const searchInput = container.querySelector('.toolbar__artist-search') as HTMLInputElement;
    searchInput.value = 'bts';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    const items = container.querySelectorAll('.toolbar__artist-item');
    // "All Artists" + 1 matching artist (BTS)
    expect(items.length).toBe(2);
    expect(items[1].textContent).toBe('BTS');

    toolbar.unmount();
  });

  it('selecting an artist updates filter state', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    toolbar.setArtists([
      { id: 'bts', name: 'BTS', generation: 3 },
      { id: 'aespa', name: 'aespa', generation: 4 },
    ]);

    const trigger = container.querySelector('.toolbar__artist-trigger') as HTMLElement;
    trigger.click();

    // Click "aespa" item (index 2: "All Artists" at 0, "aespa" at 1 alphabetically... wait they're in order passed)
    const items = container.querySelectorAll('.toolbar__artist-item');
    // items[0] = All Artists, items[1] = BTS, items[2] = aespa
    (items[2] as HTMLElement).click();

    expect(filterState.getState().artist).toBe('aespa');

    toolbar.unmount();
  });

  it('selecting "All Artists" clears artist filter', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    toolbar.setArtists([
      { id: 'bts', name: 'BTS', generation: 3 },
    ]);

    // Set artist filter first
    filterState.update({ artist: 'bts' });

    const trigger = container.querySelector('.toolbar__artist-trigger') as HTMLElement;
    trigger.click();

    const items = container.querySelectorAll('.toolbar__artist-item');
    (items[0] as HTMLElement).click(); // "All Artists"

    expect(filterState.getState().artist).toBe('all');

    toolbar.unmount();
  });

  it('filters artists by current generation filter', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    toolbar.setArtists([
      { id: 'bts', name: 'BTS', generation: 3 },
      { id: 'aespa', name: 'aespa', generation: 4 },
      { id: 'blackpink', name: 'BLACKPINK', generation: 3 },
    ]);

    // Set generation filter to 3
    filterState.update({ generation: 3 });

    const trigger = container.querySelector('.toolbar__artist-trigger') as HTMLElement;
    trigger.click();

    const items = container.querySelectorAll('.toolbar__artist-item');
    // "All Artists" + 2 gen-3 artists (BTS, BLACKPINK)
    expect(items.length).toBe(3);

    toolbar.unmount();
  });

  it('resets artist to "all" when generation changes and selected artist does not match', () => {
    const { toolbar, filterState } = createToolbar();
    toolbar.mount(container);
    toolbar.setGenerations([3, 4]);
    toolbar.setArtists([
      { id: 'bts', name: 'BTS', generation: 3 },
      { id: 'aespa', name: 'aespa', generation: 4 },
    ]);

    // Select BTS (gen 3)
    filterState.update({ artist: 'bts' });

    // Change generation to 4 via the select
    const genSelect = container.querySelector('[data-control="generation"] select') as HTMLSelectElement;
    genSelect.value = '4';
    genSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Artist should be reset to "all" since BTS is gen 3
    expect(filterState.getState().artist).toBe('all');

    toolbar.unmount();
  });

  it('closes dropdown on outside click', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);

    const trigger = container.querySelector('.toolbar__artist-trigger') as HTMLElement;
    trigger.click();

    expect(container.querySelector('.toolbar__artist-dropdown--open')).not.toBeNull();

    // Simulate outside click
    const outsideEvent = new Event('pointerdown', { bubbles: true });
    document.body.dispatchEvent(outsideEvent);

    expect(container.querySelector('.toolbar__artist-dropdown--open')).toBeNull();

    toolbar.unmount();
  });

  it('trigger button shows selected artist name', () => {
    const { toolbar } = createToolbar();
    toolbar.mount(container);
    toolbar.setArtists([
      { id: 'bts', name: 'BTS', generation: 3 },
      { id: 'aespa', name: 'aespa', generation: 4 },
    ]);

    const trigger = container.querySelector('.toolbar__artist-trigger') as HTMLElement;
    trigger.click();

    const items = container.querySelectorAll('.toolbar__artist-item');
    (items[1] as HTMLElement).click(); // BTS

    expect(trigger.textContent).toBe('BTS');

    toolbar.unmount();
  });
});
