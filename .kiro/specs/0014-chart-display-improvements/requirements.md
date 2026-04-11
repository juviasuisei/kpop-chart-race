# Requirements Document

## Introduction

This specification covers four chart display improvements for the K-Pop Chart Race application (version bump 0.8.0 → 0.9.0):

1. Fix chart win logic when the same artist has multiple releases on the same show/date
2. Add a rolling 365-day activity filter for the top 10 zoom view
3. Display rank numbers in front of artist logos on each bar
4. Hide logos in "all" zoom mode to prevent visual clipping on small bars

## Glossary

- **Chart_Engine**: The pure computation module (`chart-engine.ts`) responsible for cumulative values, rankings, chart wins, and snapshot generation. No DOM access.
- **Chart_Race_Renderer**: The DOM rendering module (`chart-race-renderer.ts`) that creates and animates bar elements, manages layout, and handles visual updates.
- **Filter_Utility**: The `filterByZoom` function in `utils.ts` that selects which ranked entries are visible based on the current zoom level.
- **DataStore**: The central data store containing all parsed artist data, sorted dates, and chart win results.
- **ChartSnapshot**: A snapshot of the chart state for a given date, containing an array of RankedEntry objects sorted by cumulative value.
- **RankedEntry**: A single entry in a ChartSnapshot representing one artist's rank, cumulative value, daily value, and metadata.
- **DailyValueEntry**: A record of a single daily performance value for a release, including the source (music show) and episode number.
- **ZoomLevel**: The display mode, either `10` (top 10 view) or `"all"` (all artists view).
- **Chart_Win**: A designation awarded to the artist with the highest DailyValueEntry value for a given (date, source) pair. Each artist can win at most once per (date, source) regardless of how many releases they have on that show.
- **Crown_Level**: A running count of total chart wins for a given (artistId, releaseId, source) tuple, displayed as a crown icon in the detail panel.
- **Snapshot_Date**: The date string (YYYY-MM-DD) of the currently displayed chart snapshot.
- **Rank_Badge**: A visual element displaying the rank number (e.g., "#1") positioned before the artist logo on each bar.

## Requirements

### Requirement 1: Deduplicate Artist Entries Before Chart Win Determination

**User Story:** As a viewer, I want each artist to win at most once per (date, source) pair, so that an artist with multiple releases on the same show does not receive duplicate chart wins.

#### Acceptance Criteria

1. WHEN the Chart_Engine computes chart wins for a given (date, source) pair, THE Chart_Engine SHALL retain only the highest-value release per artist before determining the winner.
2. WHEN an artist has multiple releases with DailyValueEntry records on the same (date, source) pair, THE Chart_Engine SHALL select the release with the highest value to represent that artist.
3. WHEN an artist has multiple releases tied at the same highest value on a (date, source) pair, THE Chart_Engine SHALL select the first release encountered in iteration order to represent that artist.
4. WHEN the Chart_Engine determines winners for a (date, source) pair after deduplication, THE Chart_Engine SHALL flag all artists tied at the maximum value as winners.
5. THE Chart_Engine SHALL increment the Crown_Level only for the single selected release per winning artist per (date, source) pair.
6. WHEN an artist has a non-selected release on a (date, source) pair, THE Chart_Engine SHALL not increment the Crown_Level for that non-selected release.

### Requirement 2: Rolling 365-Day Activity Filter for Top 10 View

**User Story:** As a viewer, I want the top 10 view to show only artists with recent chart activity, so that inactive artists do not occupy slots in the focused view.

#### Acceptance Criteria

1. WHILE the ZoomLevel is `10`, THE Filter_Utility SHALL always include the rank-1 entry regardless of activity recency.
2. WHILE the ZoomLevel is `10`, THE Filter_Utility SHALL include entries ranked 2 through 10 only for artists who have at least one DailyValueEntry within the 365 days preceding the Snapshot_Date.
3. WHEN an artist has no DailyValueEntry within the 365 days preceding the Snapshot_Date and the artist is not rank 1, THE Filter_Utility SHALL exclude that artist from the top 10 view.
4. WHILE the ZoomLevel is `"all"`, THE Filter_Utility SHALL include all entries without applying the 365-day activity filter.
5. THE Filter_Utility SHALL compute the 365-day window relative to the current Snapshot_Date, not a fixed calendar date.
6. WHEN fewer than 10 artists pass the activity filter, THE Filter_Utility SHALL display only the qualifying artists without padding to fill 10 slots.

### Requirement 3: Rank Badge Display on Bars

**User Story:** As a viewer, I want to see rank numbers displayed on each bar, so that I can quickly identify each artist's position in the chart.

#### Acceptance Criteria

1. THE Chart_Race_Renderer SHALL display a Rank_Badge element containing the text "#N" (where N is the artist's rank) before the logo on each bar.
2. WHEN the chart snapshot updates, THE Chart_Race_Renderer SHALL update each Rank_Badge to reflect the artist's current rank.
3. THE Rank_Badge SHALL use a CSS class `bar__rank` for styling.
4. THE Rank_Badge SHALL be styled as a fixed-width element that does not shrink or overflow.

### Requirement 4: Hide Logos in "All" Zoom Mode

**User Story:** As a viewer, I want logos hidden when viewing all artists, so that small bars do not display clipped or distorted logo images.

#### Acceptance Criteria

1. WHILE the ZoomLevel is `"all"`, THE Chart_Race_Renderer SHALL hide the logo image on each bar.
2. WHILE the ZoomLevel is `10`, THE Chart_Race_Renderer SHALL display the logo image on each bar.
3. WHEN the ZoomLevel changes from `10` to `"all"`, THE Chart_Race_Renderer SHALL hide all visible logo images.
4. WHEN the ZoomLevel changes from `"all"` to `10`, THE Chart_Race_Renderer SHALL show all visible logo images.
5. THE Chart_Race_Renderer SHALL toggle logo visibility by adding or removing a CSS class rather than modifying the `display` property directly.
