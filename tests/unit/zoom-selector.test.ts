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

  it('creates a .zoom-toggle button on mount', () => {
    selector.mount(container);
    const btn = container.querySelector('.zoom-toggle');
    expect(btn).not.toBeNull();
    expect(btn!.tagName).toBe('BUTTON');
  });

  it('defaults to zoom level 10', () => {
    selector.mount(container);
    expect(selector.getLevel()).toBe(10);
  });

  it('shows "Zoom Out" label when at top 10', () => {
    selector.mount(container);
    const btn = container.querySelector('.zoom-toggle') as HTMLButtonElement;
    expect(btn.textContent).toContain('Zoom Out');
  });

  it('toggles to "all" and shows "Zoom In" on click', () => {
    selector.mount(container);
    const btn = container.querySelector('.zoom-toggle') as HTMLButtonElement;

    let emittedLevel: unknown;
    eventBus.on('zoom:change', (level) => { emittedLevel = level; });

    btn.click();

    expect(selector.getLevel()).toBe('all');
    expect(btn.textContent).toContain('Zoom In');
    expect(emittedLevel).toBe('all');
  });

  it('toggles back to 10 on second click', () => {
    selector.mount(container);
    const btn = container.querySelector('.zoom-toggle') as HTMLButtonElement;

    btn.click(); // → all
    btn.click(); // → 10

    expect(selector.getLevel()).toBe(10);
    expect(btn.textContent).toContain('Zoom Out');
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
