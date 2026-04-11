# Tasks

- [x] 1. Fix timeline vertical line by adding inner wrapper
  - [x] 1.1 In `src/detail-panel.ts`, create a `detail-panel__timeline-inner` wrapper div inside the timeline container and append all timeline entries to it
  - [x] 1.2 In `src/style.css`, move the `::before` pseudo-element from `.detail-panel__timeline` to `.detail-panel__timeline-inner` and add `position: relative; min-height: 100%` to the inner wrapper
- [x] 2. Fix right-side embed overflow
  - [x] 2.1 In `src/style.css`, add `overflow: hidden` to `.timeline-entry` to prevent embed content from overflowing
  - [x] 2.2 In `src/style.css`, add `max-width: 100%` and responsive sizing rules for iframes and blockquotes inside timeline entries
- [x] 3. Update tests for new DOM structure
  - [x] 3.1 Update `tests/unit/detail-panel.test.ts` to verify the inner wrapper element exists and contains timeline entries
  - [x] 3.2 Run all existing tests to confirm no regressions
