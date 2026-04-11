import { LiveRegionAnnouncer } from '../../src/live-region.ts';
import { ScreenReaderPacedMode } from '../../src/screen-reader-paced-mode.ts';
import type { ChartSnapshot, RankedEntry } from '../../src/models.ts';

/**
 * Helper: build a RankedEntry with the given rank, name, and cumulative value.
 */
function makeEntry(rank: number, name: string, cumulative: number): RankedEntry {
  return {
    artistId: name.toLowerCase().replace(/\s+/g, '-'),
    artistName: name,
    artistType: 'boy_group',
    generation: 4,
    logoUrl: `assets/logos/${name.toLowerCase()}.svg`,
    cumulativeValue: cumulative,
    previousCumulativeValue: 0,
    dailyValue: 0,
    rank,
    previousRank: rank,
    featuredRelease: { title: 'Song', releaseId: 'song' },
  };
}

function makeSnapshot(date: string, entries: RankedEntry[]): ChartSnapshot {
  return { date, entries };
}

// ---------------------------------------------------------------------------
// LiveRegionAnnouncer
// ---------------------------------------------------------------------------
describe('LiveRegionAnnouncer', () => {
  let container: HTMLElement;
  let announcer: LiveRegionAnnouncer;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    announcer = new LiveRegionAnnouncer();
  });

  afterEach(() => {
    announcer.destroy();
    container.remove();
  });

  // 1. Mount creates a visually hidden div with role="log" and aria-live="polite"
  it('mount creates a visually hidden div with role="log" and aria-live="polite"', () => {
    announcer.mount(container);

    const el = container.querySelector('[role="log"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('aria-live')).toBe('polite');
    expect(el!.classList.contains('visually-hidden')).toBe(true);
  });

  // 2. Announce sets textContent on the live region
  it('announce sets textContent on the live region', () => {
    announcer.mount(container);
    announcer.announce('Hello screen reader');

    const el = container.querySelector('[role="log"]');
    expect(el!.textContent).toBe('Hello screen reader');
  });

  // 3. Announce returns a Promise
  it('announce returns a Promise', () => {
    announcer.mount(container);
    const result = announcer.announce('test');
    expect(result).toBeInstanceOf(Promise);
  });

  // 4. Destroy removes the element from DOM
  it('destroy removes the element from DOM', () => {
    announcer.mount(container);
    expect(container.querySelector('[role="log"]')).not.toBeNull();

    announcer.destroy();
    expect(container.querySelector('[role="log"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ScreenReaderPacedMode
// ---------------------------------------------------------------------------
describe('ScreenReaderPacedMode', () => {
  let container: HTMLElement;
  let paced: ScreenReaderPacedMode;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    paced = new ScreenReaderPacedMode();
  });

  afterEach(() => {
    paced.destroy();
    container.remove();
  });

  // 5. Default announcement count is 1 — Req 11.12
  it('default announcement count is 1', () => {
    expect(paced.getAnnouncementCount()).toBe(1);
  });

  // 6. setAnnouncementCount updates the count for valid values
  it('setAnnouncementCount updates the count for valid values', () => {
    for (const val of [1, 3, 5, 10]) {
      paced.setAnnouncementCount(val);
      expect(paced.getAnnouncementCount()).toBe(val);
    }
  });

  // 7. setAnnouncementCount ignores invalid values
  it('setAnnouncementCount ignores invalid values', () => {
    paced.setAnnouncementCount(3);
    paced.setAnnouncementCount(2);   // invalid
    expect(paced.getAnnouncementCount()).toBe(3);

    paced.setAnnouncementCount(0);   // invalid
    expect(paced.getAnnouncementCount()).toBe(3);

    paced.setAnnouncementCount(-1);  // invalid
    expect(paced.getAnnouncementCount()).toBe(3);

    paced.setAnnouncementCount(7);   // invalid
    expect(paced.getAnnouncementCount()).toBe(3);
  });

  // 8. formatAnnouncement includes date and correct number of artists — Req 11.11
  it('formatAnnouncement includes date and correct number of artists', () => {
    const snapshot = makeSnapshot('2024-05-13', [
      makeEntry(1, 'Stellar Nova', 2450),
      makeEntry(2, 'Luna Park', 1800),
      makeEntry(3, 'Jay Storm', 1200),
    ]);

    paced.setAnnouncementCount(1);
    const result1 = paced.formatAnnouncement(snapshot);
    expect(result1).toContain('May 13, 2024');
    expect(result1).toContain('Stellar Nova');
    expect(result1).toContain('2,450');
    expect(result1).not.toContain('Luna Park');

    paced.setAnnouncementCount(3);
    const result3 = paced.formatAnnouncement(snapshot);
    expect(result3).toContain('Stellar Nova');
    expect(result3).toContain('Luna Park');
    expect(result3).toContain('Jay Storm');
  });

  // 9. mountControl creates a visually hidden select element
  it('mountControl creates a visually hidden select element', () => {
    paced.mountControl(container);

    const wrapper = container.querySelector('.visually-hidden');
    expect(wrapper).not.toBeNull();

    const select = wrapper!.querySelector('select');
    expect(select).not.toBeNull();
  });

  // 10. mountControl select has options for 1, 3, 5, 10
  it('mountControl select has options for 1, 3, 5, 10', () => {
    paced.mountControl(container);

    const select = container.querySelector('select')!;
    const options = Array.from(select.options).map((o) => Number(o.value));
    expect(options).toEqual([1, 3, 5, 10]);
  });
});
