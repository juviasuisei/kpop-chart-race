# Implementation Plan: Song Mode Wins Display

## Overview

This implementation adds per-release win count display to the race view in song mode. The approach is:
1. Extend `DataStore` with a `releaseWinDates` map populated during `computeChartWins`.
2. Add a new `computeReleaseWins` function in `chart-engine.ts` that uses binary search on the pre-computed data.
3. Update `updateBarElement` in `chart-race-renderer.ts` to call `computeReleaseWins` when in song mode.
4. Validate with property-based tests and unit tests.

## Tasks

- [x] 1. Extend DataStore and populate releaseWinDates during computeChartWins
  - [x] 1.1 Add `releaseWinDates` field to DataStore interface and populate it in computeChartWins
    - Add `releaseWinDates: Map<string, string[]>` to the `DataStore` interface in `src/models.ts`
    - In `src/chart-engine.ts`, modify `computeChartWins` to build a `releaseWinDates` map alongside the existing `winCounts` logic
    - For each winner in the inner loop, push the current date to `releaseWinDates.get(${artistId}::${releaseId})`
    - After processing all dates, sort each release's date array chronologically
    - Update the call site in `src/data-loader.ts` (or wherever `computeChartWins` result is assigned) to also store `releaseWinDates` on the DataStore
    - _Requirements: 1.1, 1.2, 1.4_

- [x] 2. Implement computeReleaseWins function
  - [x] 2.1 Create the `computeReleaseWins` export in `src/chart-engine.ts`
    - Parse `releaseKey` (format `${artistId}::${releaseId}`) to extract primaryArtistId and releaseId
    - Look up artist from `dataStore.artists` to get the release's `artistIds` array (co-artists)
    - For each credited artistId, build the lookup key `${artistId}::${releaseId}` and get win dates from `dataStore.releaseWinDates`
    - Use binary search (or `Array.filter`) to count entries ≤ the given date
    - Return 0 for invalid releaseKey format, missing artist/release, or undefined `releaseWinDates`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 2.2 Write property test: per-release win computation correctness (Property 1)
    - **Property 1: Per-release win computation correctness**
    - **Validates: Requirements 1.1, 1.4, 1.5**
    - Create `tests/property/song-mode-wins.property.test.ts`
    - Generate arbitrary DataStore with chart wins data, verify `computeReleaseWins` matches oracle counting

  - [x] 2.3 Write property test: win attribution specificity (Property 2)
    - **Property 2: Win attribution specificity**
    - **Validates: Requirements 1.2**
    - For artists with multiple releases, only the winning release gets credit for a (date, source) win

  - [x] 2.4 Write property test: co-artist win inclusion (Property 3)
    - **Property 3: Co-artist win inclusion**
    - **Validates: Requirements 1.3**
    - If any co-artist ID appears in winners and the release contributed the winning value, the release gets the win

  - [x] 2.5 Write property test: cumulative wins monotonicity (Property 6)
    - **Property 6: Cumulative wins monotonicity over time**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - For any two dates where date1 ≤ date2, `computeReleaseWins(key, date1, ds)` ≤ `computeReleaseWins(key, date2, ds)`

- [x] 3. Checkpoint - Verify chart engine changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update renderer to use computeReleaseWins in song mode
  - [x] 4.1 Add conditional branch in `updateBarElement` to call `computeReleaseWins` for song mode
    - In `src/chart-race-renderer.ts`, import `computeReleaseWins` from `./chart-engine.ts`
    - Replace the existing `const totalWins = computeTotalWins(...)` line with a conditional:
      - If `isSongsMode`: call `computeReleaseWins(entry.releaseKey!, snapshotDate, dataStore)`
      - Otherwise: call `computeTotalWins(entry.artistId, snapshotDate, dataStore)` (existing behavior)
    - No other rendering changes needed — wins display, formatting, and goalpost labels already use `totalWins` uniformly
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 4.1, 4.2, 4.3_

  - [x] 4.2 Write property test: win count display formatting (Property 4)
    - **Property 4: Win count display formatting**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - For song-mode bars: wins > 0 shows "{count} win"/"wins", wins = 0 hides element

  - [x] 4.3 Write property test: goalpost label wins formatting (Property 5)
    - **Property 5: Goalpost label wins formatting**
    - **Validates: Requirements 3.1, 3.2**
    - For song-mode goalpost bars: wins > 0 appends " · N win(s)" to label, wins = 0 omits wins segment

- [x] 5. Write unit tests for song mode wins
  - [x] 5.1 Write unit tests for `computeReleaseWins` and renderer integration
    - Create `tests/unit/song-mode-wins.test.ts`
    - Test: release with exactly 1 win → returns 1
    - Test: release with 5 wins across different sources → returns 5
    - Test: release with 0 wins → returns 0
    - Test: co-artist release wins counted when secondary artist wins
    - Test: multiple releases from same artist — only correct release gets the win
    - Test: scrubbing backward — win count decreases to earlier value
    - Test: invalid releaseKey format → returns 0
    - Test: goalpost label format with wins: `"#1 · Song Title · 1,234 · 3 wins"`
    - Test: goalpost label format without wins: `"#1 · Song Title · 1,234"`
    - Test: normal bar winsSpan shows "1 win" / "5 wins" / hidden for 0
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 2.3, 3.1, 3.2, 4.2_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The renderer already handles wins display/formatting uniformly — only the win count computation source changes for song mode
- `releaseWinDates` is pre-computed once during data load, so per-frame lookups are efficient (binary search)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "5.1"] }
  ]
}
```
