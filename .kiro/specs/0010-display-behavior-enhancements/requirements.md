# Requirements Document

## Introduction

Three display behavior enhancements for the K-Pop Chart Race application (v0.5.0). These changes improve the initial user experience by hiding zero-value artists, showing the latest rankings on load, and constraining bar sizing when fewer than 10 entries are visible.

## Glossary

- **Chart_Engine**: The pure computation module (`src/chart-engine.ts`) responsible for computing cumulative values, rankings, and chart snapshots. No DOM access.
- **Renderer**: The chart race renderer (`src/chart-race-renderer.ts`) that owns the visualization DOM subtree, renders bars, and animates transitions.
- **Playback_Controller**: The playback controller (`src/playback-controller.ts`) that manages play/pause state, timeline scrubbing, and date index advancement.
- **Snapshot**: A `ChartSnapshot` object containing a date and an array of `RankedEntry` objects representing the chart state at that date.
- **RankedEntry**: A single entry in a Snapshot, containing an artist's cumulative value, rank, daily value, and metadata.
- **Zoom_Level**: A display setting (10 or "all") controlling how many entries are visible in the chart.
- **Bar_Height**: The pixel height assigned to each bar wrapper in the chart visualization.
- **Date_Index**: The integer index into the sorted `dates` array that the Playback_Controller uses to track the current position.

## Requirements

### Requirement 1: Hide Zero-Value Artists from Chart

**User Story:** As a viewer, I want artists with zero cumulative points to be hidden from the chart, so that only artists who have earned points appear in the visualization.

#### Acceptance Criteria

1. WHEN the Chart_Engine computes a Snapshot for a given date, THE Chart_Engine SHALL exclude all RankedEntry objects where `cumulativeValue` equals 0 from the Snapshot entries array.
2. WHEN the Chart_Engine excludes zero-value entries, THE Chart_Engine SHALL assign ranks starting from 1 based only on the remaining non-zero entries.
3. WHEN all artists have a cumulative value of 0 for a given date, THE Chart_Engine SHALL return a Snapshot with an empty entries array.
4. WHEN an artist transitions from a cumulative value of 0 to a value greater than 0, THE Renderer SHALL display a new bar for that artist at the correct rank position.
5. FOR ALL Snapshots produced by the Chart_Engine, EVERY RankedEntry in the entries array SHALL have a `cumulativeValue` greater than 0.

### Requirement 2: Start at Latest Date

**User Story:** As a viewer, I want the app to start paused at the latest date showing the current rankings, so that I immediately see the most up-to-date chart state.

#### Acceptance Criteria

1. WHEN the application completes data loading, THE application SHALL emit the last date in the sorted dates array as the initial `date:change` event.
2. WHEN the application renders the initial Snapshot, THE Playback_Controller SHALL set the Date_Index to `dates.length - 1`.
3. WHEN the application renders the initial Snapshot, THE Playback_Controller SHALL be in the paused state.
4. WHEN the application renders the initial Snapshot, THE Playback_Controller scrubber position and date label SHALL reflect the last date.
5. WHEN the user presses play after the initial render, THE Playback_Controller SHALL set the Date_Index to 0 and begin playback from the first date.
6. WHEN the Playback_Controller resets to the first date on play, THE Playback_Controller SHALL emit a `date:change` event for the first date before starting the interval-based advancement.

### Requirement 3: Constrain Bar Height with Fewer Than 10 Entries

**User Story:** As a viewer, I want bars to maintain a consistent maximum size when fewer than 10 entries are visible, so that the chart layout remains visually stable and bars do not stretch excessively.

#### Acceptance Criteria

1. WHILE the Zoom_Level is set to 10, THE Renderer SHALL compute Bar_Height as `containerHeight / 10` regardless of how many entries are visible.
2. WHILE the Zoom_Level is set to 10 and fewer than 10 entries are visible, THE Renderer SHALL leave empty space at the bottom of the bars container rather than stretching bars to fill the container.
3. WHILE the Zoom_Level is set to "all", THE Renderer SHALL use the fixed Bar_Height constant (40px) for each bar, unchanged from current behavior.
4. WHEN the number of visible entries changes between Snapshots (e.g., from 3 to 7 as artists gain points), THE Renderer SHALL maintain the same Bar_Height of `containerHeight / 10` for Zoom_Level 10.
