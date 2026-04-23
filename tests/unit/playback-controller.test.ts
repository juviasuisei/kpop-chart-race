import { EventBus } from '../../src/event-bus.ts';
import { PlaybackController } from '../../src/playback-controller.ts';

describe('PlaybackController', () => {
  let container: HTMLElement;
  let eventBus: EventBus;
  let dates: string[];
  let controller: PlaybackController;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    eventBus = new EventBus();
    dates = ['2024-05-01', '2024-05-02', '2024-05-03', '2024-05-04', '2024-05-05'];
    controller = new PlaybackController(eventBus, dates);
  });

  afterEach(() => {
    controller.destroy();
    container.remove();
    vi.useRealTimers();
  });

  // 1. Mount creates .playback-controls element
  it('creates a .playback-controls element on mount', () => {
    controller.mount(container);
    const el = container.querySelector('.playback-controls');
    expect(el).not.toBeNull();
    expect(container.contains(el)).toBe(true);
  });

  // 2. Mount creates play button with aria-label "Play" — Req 11.1
  it('creates a play button with aria-label "Play"', () => {
    controller.mount(container);
    const btn = container.querySelector('.playback-controls__play-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Play');
    expect(btn.textContent).toBe('▶');
  });

  // 3. Mount creates scrubber with aria-label "Timeline scrubber" — Req 11.2
  it('creates a scrubber with aria-label "Timeline scrubber"', () => {
    controller.mount(container);
    const scrubber = container.querySelector('.playback-controls__scrubber') as HTMLInputElement;
    expect(scrubber).not.toBeNull();
    expect(scrubber.getAttribute('aria-label')).toBe('Timeline scrubber');
    expect(scrubber.type).toBe('range');
    expect(scrubber.min).toBe('0');
    expect(scrubber.max).toBe(String(dates.length - 1));
  });

  // 4. Play button toggles to pause icon and aria-label — Req 6.1
  it('toggles play button to pause icon and aria-label on play', () => {
    controller.mount(container);
    controller.play();

    const btn = container.querySelector('.playback-controls__play-btn') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Pause');
    expect(btn.textContent).toBe('⏸');
  });

  // 5. Pause button toggles back to play icon — Req 6.3
  it('toggles pause button back to play icon on pause', () => {
    controller.mount(container);
    controller.play();
    controller.pause();

    const btn = container.querySelector('.playback-controls__play-btn') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Play');
    expect(btn.textContent).toBe('▶');
  });

  // 6. Play emits "play" event via EventBus
  it('emits "play" event via EventBus when play is called', () => {
    controller.mount(container);
    let playEmitted = false;
    eventBus.on('play', () => { playEmitted = true; });

    controller.play();

    expect(playEmitted).toBe(true);
  });

  // 7. Pause emits "pause" event via EventBus
  it('emits "pause" event via EventBus when pause is called', () => {
    controller.mount(container);
    controller.play();

    let pauseEmitted = false;
    eventBus.on('pause', () => { pauseEmitted = true; });

    controller.pause();

    expect(pauseEmitted).toBe(true);
  });

  // 8. seekTo updates scrubber value and emits "date:change"
  it('updates scrubber value and emits "date:change" on seekTo', () => {
    controller.mount(container);
    let emittedDate: string | undefined;
    eventBus.on('date:change', (date) => { emittedDate = date; });

    controller.seekTo('2024-05-03');

    const scrubber = container.querySelector('.playback-controls__scrubber') as HTMLInputElement;
    expect(scrubber.value).toBe('2');
    expect(emittedDate).toBe('2024-05-03');
  });

  // 9. isPlaying returns correct state
  it('returns correct playing state from isPlaying', () => {
    controller.mount(container);

    expect(controller.isPlaying()).toBe(false);

    controller.play();
    expect(controller.isPlaying()).toBe(true);

    controller.pause();
    expect(controller.isPlaying()).toBe(false);
  });

  // 10. Destroy removes DOM elements
  it('removes DOM elements on destroy', () => {
    controller.mount(container);
    expect(container.querySelector('.playback-controls')).not.toBeNull();

    controller.destroy();
    expect(container.querySelector('.playback-controls')).toBeNull();
  });
});

describe('Scrubber date labels', () => {
  let container: HTMLElement;
  let eventBus: EventBus;

  afterEach(() => {
    container.remove();
  });

  it('shows first and last dates flanking the scrubber', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    eventBus = new EventBus();
    const dates = ['2024-01-01', '2024-01-02', '2024-06-15'];
    const controller = new PlaybackController(eventBus, dates);
    controller.mount(container);

    const labels = container.querySelectorAll('.playback-controls__date-label');
    expect(labels.length).toBe(2);
    expect(labels[0].textContent).toBe('2024-01-01');
    expect(labels[1].textContent).toBe('2024-06-15');

    controller.destroy();
  });
});

describe('Scrubber date label clicks', () => {
  let container: HTMLElement;
  let eventBus: EventBus;

  afterEach(() => {
    container.remove();
    vi.useRealTimers();
  });

  it('clicking start date label seeks to the first date', () => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    eventBus = new EventBus();
    const dates = ['2024-01-01', '2024-01-02', '2024-06-15'];
    const controller = new PlaybackController(eventBus, dates);
    controller.mount(container);

    const emitted: string[] = [];
    eventBus.on('date:change', (d: string) => emitted.push(d));

    const labels = container.querySelectorAll('.playback-controls__date-label');
    (labels[0] as HTMLElement).click();

    expect(emitted).toContain('2024-01-01');

    controller.destroy();
  });

  it('clicking end date label seeks to the last date', () => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    eventBus = new EventBus();
    const dates = ['2024-01-01', '2024-01-02', '2024-06-15'];
    const controller = new PlaybackController(eventBus, dates);
    controller.mount(container);

    const emitted: string[] = [];
    eventBus.on('date:change', (d: string) => emitted.push(d));

    const labels = container.querySelectorAll('.playback-controls__date-label');
    (labels[1] as HTMLElement).click();

    expect(emitted).toContain('2024-06-15');

    controller.destroy();
  });
});
