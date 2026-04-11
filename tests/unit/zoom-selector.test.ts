import { EventBus } from '../../src/event-bus.ts';
import { ZoomSelector } from '../../src/zoom-selector.ts';

describe('ZoomSelector', () => {
  let container: HTMLElement;
  let eventBus: EventBus;
  let selector: ZoomSelector;

  beforeEach(() => {
    container = document.createElement('div');
    // Create a mock playback-controls container for the toggle to insert into
    const playbackControls = document.createElement('div');
    playbackControls.className = 'playback-controls';
    const playBtn = document.createElement('button');
    playbackControls.appendChild(playBtn);
    container.appendChild(playbackControls);
    document.body.appendChild(container);
    eventBus = new EventBus();
    selector = new ZoomSelector(eventBus);
  });

  afterEach(() => {
    selector.destroy();
    container.remove();
  });

  it('creates a .zoom-toggle element on mount', () => {
    selector.mount(container);
    const toggle = container.querySelector('.zoom-toggle');
    expect(toggle).not.toBeNull();
  });

  it('defaults to zoom level 10', () => {
    selector.mount(container);
    expect(selector.getLevel()).toBe(10);
  });

  it('shows Top 10 label as active by default', () => {
    selector.mount(container);
    const labels = container.querySelectorAll('.zoom-toggle__label');
    expect(labels[0].classList.contains('zoom-toggle__label--active')).toBe(true);
    expect(labels[1].classList.contains('zoom-toggle__label--active')).toBe(false);
  });

  it('toggles to "all" on click and slides thumb', () => {
    selector.mount(container);
    const toggle = container.querySelector('.zoom-toggle') as HTMLElement;

    let emittedLevel: unknown;
    eventBus.on('zoom:change', (level) => { emittedLevel = level; });

    toggle.click();

    expect(selector.getLevel()).toBe('all');
    expect(emittedLevel).toBe('all');

    const track = container.querySelector('.zoom-toggle__track');
    expect(track!.classList.contains('zoom-toggle__track--on')).toBe(true);

    const labels = container.querySelectorAll('.zoom-toggle__label');
    expect(labels[0].classList.contains('zoom-toggle__label--active')).toBe(false);
    expect(labels[1].classList.contains('zoom-toggle__label--active')).toBe(true);
  });

  it('toggles back to 10 on second click', () => {
    selector.mount(container);
    const toggle = container.querySelector('.zoom-toggle') as HTMLElement;

    toggle.click(); // → all
    toggle.click(); // → 10

    expect(selector.getLevel()).toBe(10);

    const track = container.querySelector('.zoom-toggle__track');
    expect(track!.classList.contains('zoom-toggle__track--on')).toBe(false);
  });

  it('has role="switch" for accessibility', () => {
    selector.mount(container);
    const toggle = container.querySelector('.zoom-toggle') as HTMLElement;
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    toggle.click();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('inserts before the play button in playback controls', () => {
    selector.mount(container);
    const playbackControls = container.querySelector('.playback-controls')!;
    expect(playbackControls.firstChild).toBe(container.querySelector('.zoom-toggle'));
  });

  it('removes DOM elements on destroy', () => {
    selector.mount(container);
    expect(container.querySelector('.zoom-toggle')).not.toBeNull();
    selector.destroy();
    expect(container.querySelector('.zoom-toggle')).toBeNull();
  });
});
