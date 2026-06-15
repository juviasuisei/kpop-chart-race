# Implementation Plan: UI Overhaul — Songs, Filters & Toolbar

## Overview

This plan implements a dual display mode (Songs/Artists), generation-based and source-based filtering, a unified toolbar, and a shortened inactive window for the K-Pop Chart Race application. The implementation follows a test-first approach: tests are written before their corresponding implementation changes. Commits happen at the top-level task level, each bumping the minor version.

## Tasks

- [x] 1. Extend data models and add co-artist resolution
  - [x] 1.1 Write unit tests for ParsedRelease.artistIds and co-artist resolution
    - Create `tests/unit/co-artist-resolution.test.ts`
    - Test: ParsedRelease with single artistId resolves to parent artist data
    - Test: ParsedRelease with multiple artistIds resolves each in order
    - Test: Missing artistId falls back to parent artist data
    - Test: Empty artistIds array defaults to `[parentArtistId]`
    - Test: Resolution preserves name, logoUrl, generation, artistType for each resolved artist
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 1.2 Write property test for co-artist resolution (Property 6)
    - Create `tests/property/co-artist-resolution.property.test.ts`
    - **Property 6: Artist resolution preserves order and completeness**
    - For any array of 1–20 artist IDs and a DataStore, resolveArtists returns same-length array with correct order and all fields populated (fallback for missing IDs)
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

  - [x] 1.3 Extend ParsedRelease model and implement resolveArtists
    - Add `artistIds: string[]` to `ParsedRelease` interface in `src/models.ts`
    - Add `ResolvedArtist` interface to `src/models.ts`
    - Create `src/co-artist-resolver.ts` with `resolveArtists(artistIds, dataStore, parentArtist): ResolvedArtist[]`
    - During data loading, default `artistIds` to `[parentArtistId]` when not present in JSON
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 1.4 Write unit tests for co-artist name formatting
    - Add tests to `tests/unit/co-artist-resolution.test.ts`
    - Test: Single artist → "ArtistName ▲"
    - Test: Two artists → "Artist1 ▲ • Artist2 ●" preserving order
    - Test: Three+ artists preserve order with bullet separators
    - _Requirements: 2.3_

  - [x] 1.5 Write property test for co-artist name formatting (Property 5)
    - Add to `tests/property/co-artist-resolution.property.test.ts`
    - **Property 5: Co-artist name formatting preserves order**
    - For any array of 1–20 artist names with type indicators, formatted label contains names in original order separated by " • " with correct indicator symbols
    - **Validates: Requirements 2.3**

  - [x] 1.6 Implement co-artist name formatting utility
    - Add `formatCoArtistLabel(artists: ResolvedArtist[]): string` to `src/co-artist-resolver.ts`
    - Returns names joined by " • " with type indicator symbols alongside each name
    - _Requirements: 2.3_

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement FilterStateManager
  - [x] 3.1 Write unit tests for FilterStateManager
    - Create `tests/unit/filter-state-manager.test.ts`
    - Test: Initializes with correct defaults (songs, all, all, 10, race, points)
    - Test: `update()` changes individual fields and preserves others
    - Test: `reset()` restores defaults
    - Test: `getState()` returns immutable copy (mutations don't affect internal state)
    - Test: View switch preserves all filter values (race→yearly and yearly→race)
    - _Requirements: 11.1, 11.2, 11.3, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 3.2 Write property test for FilterState preservation on view switch (Property 12)
    - Create `tests/property/filter-state.property.test.ts`
    - **Property 12: FilterState preservation on view switch**
    - For any valid FilterState combination, after view switch the FilterState is identical
    - **Validates: Requirements 11.1, 11.2**

  - [x] 3.3 Implement FilterStateManager class
    - Create `src/filter-state-manager.ts`
    - Implement `FilterState` interface, `FilterStateManager` class with constructor, `getState()`, `update()`, `reset()`
    - Emit `filter:change` event on EventBus when state changes
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 4. Implement computeSnapshotSongs and source-filtered computation
  - [x] 4.1 Write unit tests for computeSnapshotSongs
    - Create `tests/unit/compute-snapshot-songs.test.ts`
    - Test: Produces one entry per release with correct cumulativeValue
    - Test: Each entry has releaseKey in format `${artistId}::${releaseId}`
    - Test: Multi-artist release shows coArtists array populated
    - Test: Source filter limits which dailyValues are summed
    - Test: Source filter "all" sums everything
    - Test: Entry with zero matching source values still appears with value 0
    - Test: Entries are ranked by descending cumulativeValue with contiguous ranks
    - _Requirements: 1.3, 7.3, 7.5_

  - [x] 4.2 Write property tests for Songs mode computation (Properties 1, 2)
    - Create `tests/property/songs-mode.property.test.ts`
    - **Property 1: Songs mode cumulative value correctness**
    - For any DataStore and date, each entry's cumulativeValue equals sum of that release's dailyValues up to and including the date (filtered by source)
    - **Property 2: Songs mode yearly aggregate correctness**
    - For any DataStore and calendar year, each release's aggregate equals sum of dailyValues within that year (filtered by source)
    - **Validates: Requirements 1.3, 1.4**

  - [x] 4.3 Write property tests for Artists mode with source filter (Properties 3, 4)
    - Create `tests/property/artists-mode.property.test.ts`
    - **Property 3: Artists mode cumulative value correctness**
    - For any DataStore and date, each entry's cumulativeValue equals sum of ALL releases' dailyValues up to date (filtered by source)
    - **Property 4: Artists mode yearly aggregate correctness**
    - For any DataStore and year, each artist's aggregate equals sum of all releases' dailyValues within that year (filtered by source)
    - **Validates: Requirements 1.5, 1.6**

  - [x] 4.4 Write property tests for source filter correctness (Properties 10, 11)
    - Add to `tests/property/filter-state.property.test.ts`
    - **Property 10: Source filter cumulative correctness**
    - For any DataStore, date, and source filter, cumulativeValue equals sum of only matching-source dailyValues
    - **Property 11: Source filter preserves zero-value entries**
    - For any DataStore and specific source, entries with zero matching values still appear with cumulativeValue === 0
    - **Validates: Requirements 7.3, 7.4, 7.5**

  - [x] 4.5 Write property test for multi-artist full attribution in Artists mode (Property 7)
    - Add to `tests/property/songs-mode.property.test.ts`
    - **Property 7: Multi-artist release full attribution in Artists mode**
    - For any multi-artist release in Artists mode, each participating artist's cumulativeValue includes the full (un-split) value of the shared release
    - **Validates: Requirements 5.5**

  - [x] 4.6 Implement computeSnapshotSongs and computeCumulativeValueFiltered
    - Add `computeCumulativeValueFiltered` to `src/chart-engine.ts`
    - Add `computeSnapshotSongs(date, dataStore, filterState, previousSnapshot?)` to `src/chart-engine.ts`
    - Extend `RankedEntry` with `releaseKey`, `coArtists?`, and `mode` fields in `src/models.ts`
    - Extend existing `computeSnapshot` to accept optional source filter parameter
    - _Requirements: 1.3, 1.5, 5.5, 5.6, 7.3, 7.5_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement generation filter logic
  - [x] 6.1 Write unit tests for generation filtering
    - Create `tests/unit/generation-filter.test.ts`
    - Test: "All" passes all entries through
    - Test: Specific generation filters to only matching artists
    - Test: Songs mode: release passes if at least one co-artist matches generation
    - Test: Filtered entries get contiguous ranks (1, 2, 3…)
    - Test: Generations derived from data are sorted descending
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6_

  - [x] 6.2 Write property tests for generation filter (Properties 8, 9, 16)
    - Add to `tests/property/filter-state.property.test.ts`
    - **Property 8: Generation filter only passes matching entries**
    - After filtering, every entry has at least one associated artist with matching generation
    - **Property 9: Generation filter produces contiguous ranks**
    - Ranks form a contiguous 1..N sequence, entries at rank k have value ≥ rank k+1
    - **Property 16: Generation filter dropdown sorted descending from data**
    - Generation options are in descending numeric order with "All" first
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.6**

  - [x] 6.3 Implement applyGenerationFilter and generation extraction
    - Add `applyGenerationFilter(entries, generation)` to `src/chart-engine.ts`
    - Add `extractGenerations(dataStore): number[]` utility that returns sorted descending list
    - Re-assign contiguous ranks after filtering
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 7. Update inactive window from 14 to 3 days
  - [x] 7.1 Update existing tests for 14→3 day inactive window change
    - In `tests/unit/` and `tests/property/`, find tests referencing the 14-day window
    - Update expected values and constants to use 3 days
    - Add explicit boundary test: active at day-3, inactive at day-4
    - _Requirements: 10.1_

  - [x] 7.2 Write property test for inactive window boundary (Property 15)
    - Create `tests/property/zoom-activity.property.test.ts`
    - **Property 15: Inactive window 3-day boundary**
    - Entry with most recent activity within 3 days is active; more than 3 days is inactive
    - **Validates: Requirements 10.1**

  - [x] 7.3 Write property tests for zoom limits (Properties 13, 14)
    - Add to `tests/property/zoom-activity.property.test.ts`
    - **Property 13: Race view zoom limits entries to at most 10**
    - With zoom 10, filterByActivity returns at most 10 non-goalpost entries
    - **Property 14: Yearly view zoom limits entries to at most 10 per year**
    - With zoom "Top 10", yearly computation returns at most 10 entries per year in descending order
    - **Validates: Requirements 9.3, 9.5**

  - [x] 7.4 Change INACTIVE_WINDOW_DAYS constant from 14 to 3
    - Extract `const INACTIVE_WINDOW_DAYS = 3` in `src/utils.ts`
    - Replace hardcoded `14` in `filterByActivity` with the constant
    - All existing goalpost/backfill logic remains unchanged
    - _Requirements: 10.1_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Toolbar component and wire into main.ts
  - [x] 9.1 Write unit tests for Toolbar rendering and behavior
    - Create `tests/unit/toolbar.test.ts`
    - Test: Toolbar renders all controls in correct order (right-to-left: Songs/Artists, Zoom, View, Points/Wins, Source, Generation)
    - Test: Points/Wins toggle only visible in yearly view mode
    - Test: Generation filter dropdown populated from data, sorted descending with "All" first
    - Test: Source filter dropdown contains 6 sources plus "All"
    - Test: Mobile drawer collapses below 768px, shows chip summary
    - Test: Drawer dismisses on outside tap or filter selection
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 9.2 Implement Toolbar class
    - Create `src/toolbar.ts` with `Toolbar` class
    - Renders all controls: Songs/Artists toggle, Zoom toggle, Race/Yearly switcher, Points/Wins toggle, Source dropdown, Generation dropdown
    - Uses sticky positioning below the header
    - Communicates with FilterStateManager via EventBus
    - Implements mobile drawer behavior (< 768px) with chip summary and auto-dismiss
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.2_

  - [x] 9.3 Wire Toolbar and FilterStateManager into main.ts
    - Replace ad-hoc controls in main.ts with Toolbar + FilterStateManager
    - Remove the existing inline viewSwitcher, metricSwitcher, sourceSelect, yearlyZoomToggle DOM creation
    - Initialize FilterStateManager with defaults (songs mode, all gen, all source, zoom 10)
    - Mount Toolbar into the app container
    - Wire `filter:change` EventBus handler to re-compute snapshots using appropriate engine function (computeSnapshot vs computeSnapshotSongs)
    - Preserve scrubber at bottom of viewport
    - Set default initialization to Songs mode per Requirement 12
    - _Requirements: 1.2, 8.1, 8.2, 8.3, 9.1, 9.2, 11.4, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

- [x] 10. Implement Songs mode rendering in Race View and Yearly View
  - [x] 10.1 Write unit tests for Songs mode bar rendering
    - Create `tests/unit/songs-mode-rendering.test.ts`
    - Test: Single artist release shows artist logo on bar
    - Test: Multi-artist release shows logos side by side with 4px spacing
    - Test: Release title is primary label with musical note icon
    - Test: Artist names in secondary position with type indicators
    - Test: Same artist multiple releases → multiple separate bars
    - Test: Bar click opens detail panel for first artist (index 0) by default
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1_

  - [x] 10.2 Write unit tests for Songs mode yearly view
    - Add to `tests/unit/songs-mode-rendering.test.ts`
    - Test: "All" zoom renders treemap with per-release cells using artist logos
    - Test: Multi-artist release shows all logos in cell
    - Test: "Top 10" zoom shows top 10 releases with "Release Title • Artist Name(s)" label
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 10.3 Extend ChartRaceRenderer for Songs mode
    - Update `src/chart-race-renderer.ts` to handle entries with `mode: "songs"`
    - Render multi-logo layout (side by side, 4px spacing) when `coArtists` present
    - Swap label positions: release title as primary (with ♫ icon), artist name(s) as secondary
    - Emit `bar:click` with releaseKey in Songs mode
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 10.4 Extend YearlyView for Songs mode
    - Update `src/yearly-view.ts` to handle Songs mode entries
    - Treemap ("All" zoom): per-release cells with artist logo(s), tooltip on hover
    - Grid ("Top 10" zoom): release-level entries with "Release Title • Artist Name(s)" label
    - Accept generation and source filters from FilterStateManager
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 10.5 Update DetailPanel for Songs mode multi-artist
    - Update `src/detail-panel.ts` to support stacked multi-artist display
    - When release has multiple co-artists, show each artist's info stacked with visual dividers
    - Auto-open for first artist (index 0) of top-ranked release on playback stop
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Final integration and view-switch wiring
  - [x] 12.1 Write integration tests for full filter-compute-render cycle
    - Create `tests/unit/filter-integration.test.ts`
    - Test: Mode toggle preserves playback date and play/pause state
    - Test: View switch (race→yearly→race) preserves FilterState completely
    - Test: Generation + source filter combination produces correct entries
    - Test: Default init state: songs mode, race view, zoom 10, all gen, all source
    - Test: Data loading failure shows error message with no controls rendered
    - _Requirements: 1.7, 7.6, 11.1, 11.2, 11.5, 12.6, 12.7_

  - [x] 12.2 Wire view-switch and mode-toggle orchestration
    - Ensure view switch renders target view with FilterState already applied (no flash)
    - Preserve playback position on race→yearly→race transitions
    - Source filter applies to both race and yearly views
    - Mode toggle (songs↔artists) re-computes and re-renders within 500ms target
    - _Requirements: 1.7, 7.6, 11.4, 11.5_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The inactive window change (14→3) requires updating existing tests first since they reference 14
- Commit at top-level task level (1, 3, 4, 6, 7, 9, 10, 12), each bumping the minor version
- Run `npx tsc --noEmit` and tests before each commit

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "3.1", "3.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "3.3"] },
    { "id": 2, "tasks": ["1.6", "2"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 4, "tasks": ["4.6", "5"] },
    { "id": 5, "tasks": ["6.1", "6.2"] },
    { "id": 6, "tasks": ["6.3", "7.1", "7.2", "7.3"] },
    { "id": 7, "tasks": ["7.4", "8"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["9.2"] },
    { "id": 10, "tasks": ["9.3", "10.1", "10.2"] },
    { "id": 11, "tasks": ["10.3", "10.4", "10.5"] },
    { "id": 12, "tasks": ["11"] },
    { "id": 13, "tasks": ["12.1"] },
    { "id": 14, "tasks": ["12.2"] },
    { "id": 15, "tasks": ["13"] }
  ]
}
```
