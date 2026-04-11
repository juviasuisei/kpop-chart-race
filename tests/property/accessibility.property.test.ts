// Feature: 0001-kpop-chart-race, Property 17: Loading Progress Display
// **Validates: Requirements 12.2, 12.4**

import fc from 'fast-check';
import { LoadingScreen } from '../../src/loading-screen.ts';

describe('Property 17: Loading Progress Display', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('progress text contains both loaded and total counts, and bar width equals (loaded/total)*100%', () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.integer({ min: 1, max: 500 }), // total > 0
          )
          .chain(([total]) =>
            fc.tuple(
              fc.integer({ min: 0, max: total }),
              fc.constant(total),
            ),
          ),
        ([loaded, total]) => {
          // Fresh screen per sample
          const screen = new LoadingScreen();
          screen.mount(container);

          screen.onFileProgress(loaded, total, []);

          const progressText = container.querySelector('.loading-screen__progress-text');
          expect(progressText).not.toBeNull();

          const text = progressText!.textContent ?? '';
          // Text must contain both loaded and total counts (e.g., "3/12 files")
          expect(text).toContain(`${loaded}/${total}`);

          const barFill = container.querySelector('.progress-bar-fill') as HTMLElement;
          expect(barFill).not.toBeNull();

          const expectedPct = (loaded / total) * 100;
          expect(barFill.style.width).toBe(`${expectedPct}%`);

          screen.destroy();
        },
      ),
    );
  });
});

// Feature: 0001-kpop-chart-race, Property 16: Announcement Formatting
// **Validates: Requirements 11.5, 11.11**

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

describe('Property 16: Announcement Formatting', () => {
  it('formatted string contains the date and exactly min(N, total) artist names with cumulative values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),                       // entry count
        fc.constantFrom(1, 3, 5, 10),                          // announcement count
        fc.integer({ min: 2020, max: 2030 }),                  // year
        fc.integer({ min: 1, max: 12 }),                       // month
        fc.integer({ min: 1, max: 28 }),                       // day
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 20, maxLength: 20 }),
        (entryCount, announcementCount, year, month, day, values) => {
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

          // Build entries sorted descending by value (as a real snapshot would be)
          const entries: RankedEntry[] = [];
          for (let i = 0; i < entryCount; i++) {
            entries.push(makeEntry(i + 1, `Artist${i + 1}`, values[i]));
          }

          const snapshot: ChartSnapshot = { date: dateStr, entries };

          const paced = new ScreenReaderPacedMode();
          paced.setAnnouncementCount(announcementCount);

          const result = paced.formatAnnouncement(snapshot);

          // Must contain a human-readable form of the date
          const d = new Date(year, month - 1, day);
          const formatted = d.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
          expect(result).toContain(formatted);

          // Must contain exactly min(N, total) artist names with cumulative values
          const expectedCount = Math.min(announcementCount, entryCount);
          for (let i = 0; i < expectedCount; i++) {
            expect(result).toContain(entries[i].artistName);
            expect(result).toContain(entries[i].cumulativeValue.toLocaleString('en-US'));
          }

          // Artists beyond the expected count should NOT appear
          for (let i = expectedCount; i < entryCount; i++) {
            expect(result).not.toContain(entries[i].artistName);
          }
        },
      ),
    );
  });
});
