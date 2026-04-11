import { EventBus } from '../../src/event-bus.ts';
import { ZoomSelector } from '../../src/zoom-selector.ts';

describe('ZoomSelector', () => {
  let container: HTMLElement;
  let eventBus: EventBus;
  let selector: ZoomSelector;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    eventBus = new EventBus();
    selector = new ZoomSelector(eventBus);
  });

  afterEach(() => {
    selector.destroy();
    container.remove();
  });

  // 1. Mount creates .zoom-selector fieldset
  it('creates a .zoom-selector fieldset on mount', () => {
    selector.mount(container);
    const fieldset = container.querySelector('fieldset.zoom-selector');
    expect(fieldset).not.toBeNull();
    expect(fieldset!.tagName).toBe('FIELDSET');
  });

  // 2. Default selection is Top 10 — Req 5.5
  it('defaults to Top 10 selected', () => {
    selector.mount(container);
    const checked = container.querySelector<HTMLInputElement>('input[name="zoom-level"]:checked');
    expect(checked).not.toBeNull();
    expect(checked!.value).toBe('10');
  });

  // 3. getLevel returns 10 by default
  it('returns 10 from getLevel by default', () => {
    selector.mount(container);
    expect(selector.getLevel()).toBe(10);
  });

  // 4. All options rendered (Top 10 and All) — Req 5.1
  it('renders both Top 10 and All radio options', () => {
    selector.mount(container);
    const radios = container.querySelectorAll<HTMLInputElement>('input[name="zoom-level"]');
    expect(radios.length).toBe(2);

    const values = Array.from(radios).map((r) => r.value);
    expect(values).toContain('10');
    expect(values).toContain('all');
  });

  // 5. Selecting "All" emits zoom:change with "all"
  it('emits zoom:change with "all" when All is selected', () => {
    selector.mount(container);
    let emittedLevel: unknown;
    eventBus.on('zoom:change', (level) => { emittedLevel = level; });

    const allRadio = container.querySelector<HTMLInputElement>('input[value="all"]')!;
    allRadio.checked = true;
    allRadio.dispatchEvent(new Event('change', { bubbles: true }));

    expect(emittedLevel).toBe('all');
  });

  // 6. Keyboard navigation — radio buttons have correct attributes — Req 11.3
  it('renders radio buttons with correct type and name for keyboard navigation', () => {
    selector.mount(container);
    const radios = container.querySelectorAll<HTMLInputElement>('input[name="zoom-level"]');

    for (const radio of radios) {
      expect(radio.type).toBe('radio');
      expect(radio.name).toBe('zoom-level');
    }

    // Verify they are grouped in a fieldset with a legend for accessibility
    const legend = container.querySelector('fieldset.zoom-selector legend');
    expect(legend).not.toBeNull();
  });

  // 7. Destroy removes DOM
  it('removes DOM elements on destroy', () => {
    selector.mount(container);
    expect(container.querySelector('.zoom-selector')).not.toBeNull();

    selector.destroy();
    expect(container.querySelector('.zoom-selector')).toBeNull();
  });
});
