# Requirements Document

## Introduction

Comprehensive overhaul of the Detail_Panel component in the K-Pop Chart Race application (v0.8.0). This feature redesigns the artist detail panel with a wider layout, single-column centered timeline, grouped date entries in reverse chronological order, enlarged show logos, enhanced points display with crown icons, tiered crown sizing, and a sticky header showing artist info with cumulative points.

## Glossary

- **Detail_Panel**: The sidebar (desktop) or full-screen overlay (mobile) component that displays an artist's timeline of chart performances and embedded media. Implemented in `src/detail-panel.ts`.
- **Timeline**: The vertical scrollable area within the Detail_Panel that lists chart performance entries and embed groups organized by date.
- **Timeline_Entry**: A single card within the Timeline representing chart performance data and/or embedded media for a specific date.
- **Date_Group**: A collection of Timeline_Entries that share the same date, rendered under a single date header.
- **Source_Logo**: The image representing a music show chart source (e.g., Inkigayo, Music Bank), displayed within a chart performance Timeline_Entry.
- **Crown_Icon**: An SVG icon indicating a chart win, with visual size varying by crown level tier.
- **Sticky_Header**: The fixed-position header area at the top of the Detail_Panel that remains visible while the Timeline scrolls.
- **Artist_Logo**: The white SVG logo for an artist, displayed in the Sticky_Header against a colored background.
- **ARTIST_TYPE_COLORS**: A shared color map keyed by ArtistType that provides the background color for the Artist_Logo display. Currently defined in `chart-race-renderer.ts`.
- **Cumulative_Value**: The total points an artist has earned from the data start date through the current snapshot date, computed by the chart engine.
- **Snapshot_Date**: The current date in the chart race playback, needed to compute the Cumulative_Value for the Sticky_Header.

## Requirements

### Requirement 1: Wider Panel Layout

**User Story:** As a user, I want the detail panel to be wider on desktop, so that timeline content has more room and is easier to read.

#### Acceptance Criteria

1. WHILE the viewport width is 768px or greater, THE Detail_Panel SHALL render with a width of 500px.
2. WHILE the viewport width is less than 768px, THE Detail_Panel SHALL render as a full-screen overlay occupying 100% width and height.

### Requirement 2: Single-Column Centered Timeline

**User Story:** As a user, I want timeline entries to appear in a single centered column instead of alternating left and right, so that the timeline is easier to follow.

#### Acceptance Criteria

1. THE Detail_Panel SHALL render all Timeline_Entries in a single column, centered horizontally on the vertical timeline line.
2. THE Detail_Panel SHALL NOT alternate Timeline_Entries between left and right sides.
3. THE Timeline vertical line SHALL remain centered behind the Timeline_Entries.

### Requirement 3: Group Same-Date Items Under One Date Header

**User Story:** As a user, I want items that share the same date to be grouped under a single date heading, so that I can see all activity for a given day together.

#### Acceptance Criteria

1. WHEN multiple Timeline_Entries share the same date, THE Detail_Panel SHALL display the date header once for that Date_Group.
2. WHEN multiple Timeline_Entries share the same date, THE Detail_Panel SHALL render all chart performance entries and embed groups under the single date header.
3. THE Detail_Panel SHALL NOT display duplicate date headers for entries sharing the same date.

### Requirement 4: Reverse Chronological Timeline Order

**User Story:** As a user, I want the timeline to show the most recent events first, so that I can quickly see the latest activity.

#### Acceptance Criteria

1. THE Detail_Panel SHALL sort Date_Groups in reverse chronological order (newest date first).
2. WITHIN each Date_Group, THE Detail_Panel SHALL render chart performance Timeline_Entries before embed-only Timeline_Entries.
3. WITHIN each Date_Group, THE Detail_Panel SHALL preserve the original file order for embed-only entries from the same release.

### Requirement 5: Larger Source Logos

**User Story:** As a user, I want the music show source logos to be larger in the timeline, so that I can easily identify which show the performance is from.

#### Acceptance Criteria

1. THE Detail_Panel SHALL render Source_Logo images at 80px by 80px within chart performance Timeline_Entries.
2. WHEN a chart performance Timeline_Entry includes an episode number, THE Detail_Panel SHALL display the episode number centered below the Source_Logo at the current text size.

### Requirement 6: Points Display with "pts" Suffix and Winner Icon

**User Story:** As a user, I want to see "pts" after the chart value and a crown icon above the points for winners, so that the scoring is clear and wins are visually prominent.

#### Acceptance Criteria

1. THE Detail_Panel SHALL display the text "pts" immediately after the chart value number in each chart performance Timeline_Entry.
2. WHEN a chart performance Timeline_Entry has a crown level greater than zero, THE Detail_Panel SHALL display the Crown_Icon centered above the points value.

### Requirement 7: Crown Icon Sizing Tiers

**User Story:** As a user, I want crown icons to grow larger at higher win levels, so that more impressive win streaks are visually distinguished.

#### Acceptance Criteria

1. WHILE the crown level is between 1 and 6 (inclusive), THE Detail_Panel SHALL render the Crown_Icon at 24px height.
2. WHILE the crown level is between 7 and 9 (inclusive), THE Detail_Panel SHALL render the Crown_Icon at 48px height.
3. WHILE the crown level is 10 or greater, THE Detail_Panel SHALL render the Crown_Icon at 72px height.

### Requirement 8: Sticky Header with Artist Information

**User Story:** As a user, I want the artist header to stay visible while I scroll through the timeline, so that I always know which artist I am viewing and their current standing.

#### Acceptance Criteria

1. THE Sticky_Header SHALL remain fixed at the top of the Detail_Panel while the Timeline scrolls.
2. THE Sticky_Header SHALL display the Artist_Logo centered horizontally at a large size (approximately 80–100px).
3. THE Sticky_Header SHALL display the ARTIST_TYPE_COLORS background color for the artist's type behind the Artist_Logo.
4. THE Sticky_Header SHALL display the artist name centered below the Artist_Logo.
5. WHEN the artist has a Korean name, THE Sticky_Header SHALL display the Korean name in parentheses after the artist name.
6. THE Sticky_Header SHALL display the artist type label and generation (Roman numeral) centered below the name.
7. WHEN the artist has a debut date, THE Sticky_Header SHALL display the debut date below the type and generation line.
8. THE Sticky_Header SHALL display the artist's Cumulative_Value at the current Snapshot_Date, formatted with locale-appropriate thousands separators and a "pts" suffix.

### Requirement 9: Detail Panel Open Method Accepts Snapshot Date

**User Story:** As a developer, I want the detail panel open method to accept the current snapshot date, so that the sticky header can compute and display the correct cumulative points.

#### Acceptance Criteria

1. THE Detail_Panel `open()` method SHALL accept a `currentDate` parameter in addition to `artistId` and `dataStore`.
2. WHEN `currentDate` is provided, THE Detail_Panel SHALL use the chart engine's `computeCumulativeValue` function to calculate the artist's Cumulative_Value at that date.
3. THE Detail_Panel SHALL display the computed Cumulative_Value in the Sticky_Header.

### Requirement 10: Shared Artist Type Colors

**User Story:** As a developer, I want the ARTIST_TYPE_COLORS map to be accessible from the detail panel module, so that the sticky header can use the correct background color without duplicating the color definitions.

#### Acceptance Criteria

1. THE application SHALL make the ARTIST_TYPE_COLORS map importable by both the Chart_Race_Renderer and the Detail_Panel modules.
2. THE Detail_Panel SHALL use the shared ARTIST_TYPE_COLORS map to set the Sticky_Header background color for the Artist_Logo area.
3. THE application SHALL NOT maintain duplicate definitions of the ARTIST_TYPE_COLORS map.
