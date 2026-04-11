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
