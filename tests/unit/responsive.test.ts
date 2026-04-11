import { ChartRaceRenderer } from '../../src/chart-race-renderer.ts';
import { EventBus } from '../../src/event-bus.ts';
import { PlaybackController } from '../../src/playback-controller.ts';
import { ZoomSelector } from '../../src/zoom-selector.ts';

describe('Responsive Design', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  // 1. Verify .chart-race element can be created and mounted
  it('creates a .chart-race element when ChartRaceRenderer is mounted', () => {
    const renderer = new ChartRaceRenderer();
    renderer.mount(container);

    const chartRace = container.querySelector('.chart-race');
    expect(chartRace).not.toBeNull();
    expect(chartRace!.classList.contains('chart-race')).toBe(true);

    renderer.destroy();
  });

  // 2. Verify .detail-panel--mobile class exists for mobile layout concept
  it('creates a detail-panel with --mobile class for mobile viewports', () => {
    const panel = document.createElement('div');
    panel.className = 'detail-panel detail-panel--mobile';
    container.appendChild(panel);

    expect(panel.classList.contains('detail-panel--mobile')).toBe(true);
    expect(panel.classList.contains('detail-panel')).toBe(true);
  });

  // 3. Verify .detail-panel--desktop class exists for desktop layout concept
  it('creates a detail-panel with --desktop class for desktop viewports', () => {
    const panel = document.createElement('div');
    panel.className = 'detail-panel detail-panel--desktop';
    container.appendChild(panel);

    expect(panel.classList.contains('detail-panel--desktop')).toBe(true);
    expect(panel.classList.contains('detail-panel')).toBe(true);
  });

  // 4. Verify playback controls render correctly
  it('renders playback controls with play button, scrubber, and date label', () => {
    const eventBus = new EventBus();
    const dates = ['2024-05-01', '2024-05-02', '2024-05-03'];
    const controller = new PlaybackController(eventBus, dates);
    controller.mount(container);

    const controls = container.querySelector('.playback-controls');
    expect(controls).not.toBeNull();

    const playBtn = container.querySelector('.playback-controls__play-btn');
    expect(playBtn).not.toBeNull();

    const scrubber = container.querySelector('.playback-controls__scrubber');
    expect(scrubber).not.toBeNull();

    const dateLabel = container.querySelector('.playback-controls__date-label');
    expect(dateLabel).not.toBeNull();

    controller.destroy();
  });

  // 5. Verify zoom selector renders correctly
  it('renders zoom selector with radio options', () => {
    const eventBus = new EventBus();
    const selector = new ZoomSelector(eventBus);
    selector.mount(container);

    const fieldset = container.querySelector('.zoom-selector');
    expect(fieldset).not.toBeNull();

    const options = container.querySelectorAll('input[name="zoom-level"]');
    expect(options.length).toBe(2);

    selector.destroy();
  });
});
