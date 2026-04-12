import { LoadingScreen } from '../../src/loading-screen.ts';

describe('LoadingScreen', () => {
  let container: HTMLElement;
  let screen: LoadingScreen;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    screen = new LoadingScreen();
  });

  afterEach(() => {
    screen.destroy();
    container.remove();
  });

  // 12.1 — Loading screen replaces visualization area on mount
  it('creates a .loading-screen element inside the container on mount', () => {
    screen.mount(container);
    const el = container.querySelector('.loading-screen');
    expect(el).not.toBeNull();
    expect(container.contains(el)).toBe(true);
  });

  // 12.2 — File progress indicator display
  it('updates progress text to "Loading X of X artists..."', () => {
    screen.mount(container);
    screen.onFileProgress(3, 12, ['Artist A']);

    const text = container.querySelector('.loading-screen__progress-text');
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe('Loading 3 of 12 artists...');
  });

  // 12.3 — Artist name scrolling on file parse
  it('appends artist name spans to .artist-credits', () => {
    screen.mount(container);
    screen.onFileProgress(1, 5, ['Luna Park', 'Jay Storm']);

    const credits = container.querySelector('.artist-credits');
    expect(credits).not.toBeNull();

    const spans = credits!.querySelectorAll('.artist-credits__name');
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toBe('Luna Park');
    expect(spans[1].textContent).toBe('Jay Storm');
  });

  // 12.4 — Progress bar display
  it('updates .progress-bar-fill width based on loaded/total', () => {
    screen.mount(container);
    screen.onFileProgress(5, 10, []);

    const fill = container.querySelector('.progress-bar-fill') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe('50%');
  });

  // 12.5 — Transition to complete
  it('adds loading-screen--complete class on onComplete()', () => {
    screen.mount(container);
    screen.onComplete();

    const el = container.querySelector('.loading-screen');
    expect(el).not.toBeNull();
    expect(el!.classList.contains('loading-screen--complete')).toBe(true);
  });

  // 12.6 — Error on total failure
  it('displays error message and hides progress bar on onError()', () => {
    screen.mount(container);
    screen.onError('Unable to load chart data. Please try refreshing the page.');

    const errorArea = container.querySelector('.loading-screen__error') as HTMLElement;
    expect(errorArea).not.toBeNull();
    expect(errorArea.textContent).toBe(
      'Unable to load chart data. Please try refreshing the page.',
    );
    expect(errorArea.style.display).not.toBe('none');

    const progressBar = container.querySelector('.progress-bar') as HTMLElement;
    expect(progressBar.style.display).toBe('none');
  });

  // 12.7 — Empty dataset message
  it('displays info message for empty dataset via onError()', () => {
    screen.mount(container);
    screen.onError('No chart data available.');

    const errorArea = container.querySelector('.loading-screen__error') as HTMLElement;
    expect(errorArea).not.toBeNull();
    expect(errorArea.textContent).toBe('No chart data available.');
  });

  // Destroy removes from DOM
  it('removes the loading screen element from DOM after destroy()', () => {
    screen.mount(container);
    expect(container.querySelector('.loading-screen')).not.toBeNull();

    screen.destroy();
    expect(container.querySelector('.loading-screen')).toBeNull();
  });
});
