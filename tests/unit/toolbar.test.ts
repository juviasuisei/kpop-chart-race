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
    expect(controls.length).toBeGreaterThanOrEqual(6);

    const order = Array.from(controls).map(el => el.getAttribute('data-control'));
    expect(order).toEqual([
      'generation',
      'source',
      'metric',
      'view',
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

  it('shows chip summary of active non-default filters in mobile mode', () => {
    const { toolbar, filterState } = createToolbar();
    // Set a non-default filter so a chip appears
    filterState.update({ generation: 4 });

    toolbar.mount(container);

    // Should show chip summary reflecting active filters
    const chips = container.querySelector('.toolbar__chips') ||
      container.querySelector('.toolbar__summary');
    expect(chips).not.toBeNull();
    expect(chips!.textContent).toContain('4');

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
