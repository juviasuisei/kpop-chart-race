# Implementation Plan: Display Behavior Enhancements

## Overview

Three targeted changes to improve initial UX: filter zero-value artists from snapshots, start paused at the latest date, and verify bar height is already `containerHeight / 10`. Bump version to 0.5.0.

## Tasks

- [x] 1. Filter zero-value entries in computeSnapshot
  - [x] 1.1 In `src/chart-engine.ts` `computeSnapshot`, insert a `.filter(e => e.cumulativeValue > 0)` on the unsorted array before the sort/rank assignment
    - The `previousMap` lookup must still use all artists (including zero-value) so `previousCumulativeValue` and `previousRank` are correct when an artist transitions from 0 to non-zero
    - Assign ranks `1..N` on the filtered array only
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x]* 1.2 Write property test for zero-value exclusion invariant
    - **Property 1: Zero-value exclusion invariant**
    - Generate random DataStores (2-8 artists, 1-5 dates, random daily values including zeros), compute snapshots, assert every entry has `cumulativeValue > 0` and ranks form `[1..N]`
    - Add to `tests/property/chart-engine.property.test.ts`
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5**

- [x] 2. Checkpoint — Run tests, commit, push
  - Ensure all tests pass (`npm test`), ask the user if questions arise.
  - Commit with message `feat(chart-engine): filter zero-value entries from snapshots`
  - Push after commit

- [x] 3. Start at last date
  - [x] 3.1 In `src/main.ts`, change the initial `date:change` emission from `dataStore.dates[0]` to `dataStore.dates[dataStore.dates.length - 1]`
    - _Requirements: 2.1_

  - [x] 3.2 In `src/playback-controller.ts` `mount()`, set `this.currentIndex = this.dates.length - 1` and update scrubber value/label to match the last date
    - _Requirements: 2.2, 2.3, 2.4_

  - [x] 3.3 In `src/playback-controller.ts` `play()`, add a guard: if `this.currentIndex >= this.dates.length - 1`, reset to 0, update scrubber/label, and emit `date:change` for `this.dates[0]` before starting the interval
    - _Requirements: 2.5, 2.6_

- [x] 4. Checkpoint — Run tests, commit, push
  - Ensure all tests pass (`npm test`), ask the user if questions arise.
  - Commit with message `feat(playback): start paused at latest date`
  - Push after commit

- [x] 5. Verify bar height is already containerHeight/10
  - [x] 5.1 Confirm in `src/chart-race-renderer.ts` that `barHeight` is computed as `containerHeight / 10` (not `containerHeight / visibleEntries.length`) when `zoomLevel === 10`
    - If already correct, add a code comment noting this satisfies Requirement 3 and make no functional change
    - _Requirements: 3.1, 3.2, 3.4_

  - [x]* 5.2 Write property test for bar height independence from entry count at zoom 10
    - **Property 2: Bar height independence from entry count at zoom 10**
    - Generate random snapshots with 1-10 entries, mock `containerHeight` to a random positive value, call `renderer.update()` at zoom 10, assert all bar wrapper heights equal `containerHeight / 10`
    - Add to `tests/property/renderer.property.test.ts`
    - **Validates: Requirements 3.1, 3.2, 3.4**

- [x] 6. Checkpoint — Run tests, commit, push
  - Ensure all tests pass (`npm test`), ask the user if questions arise.
  - Commit with message `test: add property tests for display behavior enhancements`
  - Push after commit

- [x] 7. Bump version to 0.5.0
  - [x] 7.1 Update `version` field in `package.json` from `"0.4.0"` to `"0.5.0"`
    - _Requirements: all (feature release)_

- [x] 8. Final checkpoint — Run tests, commit, push
  - Ensure all tests pass (`npm test`), ask the user if questions arise.
  - Commit with message `chore: bump version to 0.5.0`
  - Push after commit

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Bar height (Requirement 3) is already correctly implemented — task 5 is verification + property test only
- Each checkpoint includes running tests, committing, and pushing
- Property tests use fast-check with minimum 100 iterations, following existing patterns in `tests/property/`
