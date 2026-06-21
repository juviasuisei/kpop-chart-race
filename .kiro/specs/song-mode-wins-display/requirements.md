# Requirements Document

## Introduction

This feature adds win count display to the race view when in song mode. Currently, the race view in artist mode shows total wins (styled with crown text and positioned after the value), but in song mode — where each bar represents an individual song/release — wins are not displayed because the underlying computation only counts wins per artist ID. Song mode entries use a composite `releaseKey` as their identifier, which doesn't match any real artist ID in the chart wins data.

The solution requires computing per-release wins (how many music show wins a specific song has accumulated) and displaying them on song mode bars with the same styling and positioning as artist mode wins.

## Glossary

- **Chart_Race_Renderer**: The UI component responsible for rendering animated bar chart elements, positioning bars, and displaying data labels (rank, name, value, wins) in the race view.
- **Chart_Engine**: The computation module that processes raw artist/release data into snapshots, computes cumulative values, determines chart wins, and produces crown levels.
- **Release_Key**: A composite identifier in song mode representing a specific release, formatted as `${artistId}::${releaseId}`.
- **Chart_Win**: An event where a song achieves the highest value on a specific date for a specific music show source. One win per (date, source) pair.
- **Crown_Level**: The running total of wins accumulated by a specific (artist, release, source) tuple, displayed as a count alongside the bar.
- **Song_Mode**: The display mode where each bar represents an individual song/release rather than an aggregated artist total.
- **Artist_Mode**: The display mode where each bar represents an artist's total cumulative value across all releases.
- **DataStore**: The central runtime data structure holding all parsed artist data, sorted dates, first appearances, and pre-computed chart wins.
- **Goalpost_Bar**: A minimized bar representation (dashed line) for inactive entries that still appear as reference points in the top-10 zoom view.

## Requirements

### Requirement 1: Per-Release Win Computation

**User Story:** As a user viewing the race in song mode, I want to see how many music show wins each song has, so that I can track individual song achievements over time.

#### Acceptance Criteria

1. THE Chart_Engine SHALL provide a function that computes the total number of chart wins for a specific release up to and including a given date.
2. WHEN computing per-release wins, THE Chart_Engine SHALL count a win for a release on a given (date, source) pair only when the release's artist is among the winners AND the release is the one that contributed the winning value for that artist on that source.
3. WHEN a release has co-artists, THE Chart_Engine SHALL count the win if any of the release's credited artist IDs appear in the winners for that (date, source) pair.
4. THE Chart_Engine SHALL count wins across all sources (inkigayo, m_countdown, music_bank, show_champion, show_music_core, the_show) for the total.
5. WHEN no wins exist for a release up to the given date, THE Chart_Engine SHALL return zero.

### Requirement 2: Display Wins on Song Mode Bars

**User Story:** As a user viewing the race in song mode, I want wins displayed on song bars with the same styling as artist mode, so that the experience is consistent across display modes.

#### Acceptance Criteria

1. WHEN the race view is in song mode and a song has one or more wins, THE Chart_Race_Renderer SHALL display the win count text on the bar using the same CSS class and positioning as artist mode wins.
2. WHEN the race view is in song mode and a song has zero wins, THE Chart_Race_Renderer SHALL hide the wins element for that bar.
3. THE Chart_Race_Renderer SHALL format the win count text as `"{count} win"` for exactly one win and `"{count} wins"` for two or more wins, matching artist mode formatting.
4. THE Chart_Race_Renderer SHALL position the wins element immediately after the value element on the bar, consistent with artist mode layout.

### Requirement 3: Display Wins on Song Mode Goalpost Bars

**User Story:** As a user viewing the race in song mode with top-10 zoom, I want goalpost bars to include win counts in their compact label, so that I can see win information for inactive songs.

#### Acceptance Criteria

1. WHEN the race view is in song mode and a goalpost bar's song has one or more wins, THE Chart_Race_Renderer SHALL include the win count in the goalpost compact label following the format `"#rank · songTitle · points · N win(s)"`.
2. WHEN the race view is in song mode and a goalpost bar's song has zero wins, THE Chart_Race_Renderer SHALL omit the wins segment from the goalpost compact label.

### Requirement 4: Win Count Accuracy Over Time

**User Story:** As a user scrubbing through dates in song mode, I want the win count to update accurately for each date, so that I see the correct cumulative wins as they happen.

#### Acceptance Criteria

1. WHEN the playback advances to a new date in song mode, THE Chart_Race_Renderer SHALL update each song's displayed win count to reflect the cumulative wins up to and including the new date.
2. WHEN the user scrubs backward to an earlier date in song mode, THE Chart_Race_Renderer SHALL display the correct cumulative win count for that earlier date, not retaining future wins.
3. WHEN a song wins on the currently displayed date, THE Chart_Race_Renderer SHALL reflect the incremented win count on that same date's frame.
