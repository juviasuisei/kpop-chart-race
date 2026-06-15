# Requirements Document

## Introduction

This feature overhauls the K-Pop Chart Race application's UI to support a Songs/Artists display mode toggle, generation-based filtering, unified toolbar controls, and a shortened inactive window. The goal is to allow users to explore chart performance at the individual release (song) level rather than only at the artist cumulative level, and to provide consistent filtering and control access across both race and yearly views.

## Glossary

- **App**: The K-Pop Chart Race web application
- **Race_View**: The animated bar-chart-race visualization showing ranked entries progressing over time
- **Yearly_View**: The static grid/treemap visualization showing per-year aggregates
- **Display_Mode**: A setting that determines whether chart entries are organized by individual release ("Songs") or by artist cumulative totals ("Artists")
- **Songs_Mode**: Display mode where each bar/cell represents an individual release (song) with its own cumulative value
- **Artists_Mode**: Display mode where each bar/cell represents an artist with their total cumulative value across all releases
- **Toolbar**: A persistent horizontal control strip rendered at the top of the application, containing all filter and toggle controls
- **Generation_Filter**: A control that filters entries by the artist's generation number (1–N, dynamically expanding)
- **Source_Filter**: A control that filters entries by the originating chart show (e.g., Inkigayo, Music Bank)
- **Zoom_Toggle**: A control that switches between "Top 10" and "All" display density
- **Inactive_Window**: The number of days of inactivity after which an entry is no longer considered active in race view filtering
- **Filter_State**: The collective set of active filter and toggle values (display mode, generation, source, zoom)
- **Co_Artists**: Multiple artists credited on a single release, stored as an array of artist references on the release
- **Scrubber**: The timeline/playback slider positioned at the bottom of the race view
- **Performance_Value**: A daily numeric value from a chart source for a given release on a specific date

## Requirements

### Requirement 1: Songs/Artists Display Mode Toggle

**User Story:** As a user, I want to switch between viewing chart data by individual song and by cumulative artist totals, so that I can explore performance at the granularity that interests me.

#### Acceptance Criteria

1. THE App SHALL provide a toggle control that switches between Songs_Mode and Artists_Mode, with the currently active mode visually indicated (e.g., highlighted or selected state)
2. WHEN the App initializes, THE App SHALL default to Songs_Mode
3. WHILE Songs_Mode is active, THE Race_View SHALL render each bar as an individual release with its own cumulative value (the sum of that release's daily Performance_Values from the dataset start date through the current date)
4. WHILE Songs_Mode is active, THE Yearly_View SHALL render each cell as an individual release with its per-year aggregate value (the sum of that release's daily Performance_Values within the displayed calendar year)
5. WHILE Artists_Mode is active, THE Race_View SHALL render each bar as an artist with the cumulative sum of all that artist's releases' daily Performance_Values from the dataset start date through the current date
6. WHILE Artists_Mode is active, THE Yearly_View SHALL render each cell as an artist with the aggregate sum of all that artist's releases' daily Performance_Values within the displayed calendar year
7. WHEN the user toggles from Songs_Mode to Artists_Mode or vice versa, THE App SHALL re-compute and re-render the current view while preserving the current playback date and play/pause state within 500 milliseconds

### Requirement 2: Songs Mode Bar Presentation

**User Story:** As a user, I want to see artist logos and names on song bars so that I can identify which artists performed each song.

#### Acceptance Criteria

1. WHEN Songs_Mode is active and a release has a single artist, THE Race_View SHALL display that artist's logo on the bar
2. WHEN Songs_Mode is active and a release has multiple Co_Artists, THE Race_View SHALL display each artist's logo side by side on the bar with 4px horizontal spacing between logos
3. WHEN Songs_Mode is active and a release has multiple Co_Artists, THE Race_View SHALL display the artist names joined by a bullet separator (e.g., "Artist1 • Artist2") in the order defined by the release's artist identifier array, with each artist's type indicator symbol displayed alongside their name
4. WHEN Songs_Mode is active, THE Race_View SHALL display the release title as the primary label for the bar
5. WHEN Songs_Mode is active and the same artist has multiple releases with active data, THE Race_View SHALL display that artist's logo on multiple separate bars, each identified by its unique release title
6. WHEN Songs_Mode is active, THE Race_View SHALL swap the label positions compared to Artists_Mode: the release title SHALL appear in the primary name position (where the artist name appears in Artists_Mode) preceded by a musical note icon, and the artist name(s) with their type indicator symbol(s) SHALL appear in the secondary position (where the featured release title appears in Artists_Mode)

### Requirement 3: Songs Mode Yearly View Presentation

**User Story:** As a user, I want the yearly treemap to show individual songs with their artist logo(s) so I can see which songs dominated each year.

#### Acceptance Criteria

1. WHEN Songs_Mode is active and Yearly_View uses "All" zoom, THE Yearly_View SHALL render each release as a separate cell sized proportionally to the release's aggregate value for that year, using the associated artist logo(s) as the icon
2. WHEN Songs_Mode is active and a release has multiple Co_Artists, THE Yearly_View SHALL display all associated artist logos side by side within the cell
3. WHEN Songs_Mode is active and Yearly_View uses "All" zoom, THE Yearly_View SHALL display release information via tooltip on hover (matching the Artists_Mode treemap behavior) rather than rendering text labels inside cells
4. WHEN Songs_Mode is active and Yearly_View uses "Top 10" zoom, THE Yearly_View SHALL render the top 10 releases per year ranked by aggregate value using the same bar/grid layout as Artists_Mode, with the label format swapped to "Release Title • Artist Name(s)" in place of the artist name

### Requirement 4: Songs Mode Detail Panel Interaction

**User Story:** As a user, I want clicking a song bar to still open the artist sidebar so I can drill into the artist's full profile.

#### Acceptance Criteria

1. WHEN Songs_Mode is active and the user clicks a release bar in Race_View, THE App SHALL open the detail panel for the artist whose logo or name was clicked; if the click target is not a specific artist element, THE App SHALL open the detail panel for the first artist in the release's artist identifier array (index 0)
2. WHEN Songs_Mode is active and a release has a single artist, THE detail panel SHALL display that artist's full information (embeds, timeline, crown badges) identically to Artists_Mode
3. WHEN Songs_Mode is active and a release has multiple Co_Artists, THE detail panel SHALL display each artist's full information stacked vertically in the order of the release's artist identifier array, with a visual divider separating each artist's section
4. WHEN playback stops in Songs_Mode, THE App SHALL auto-open the detail panel for the first artist (index 0) of the top-ranked release

### Requirement 5: Multi-Artist Release Data Model

**User Story:** As a developer, I want releases to reference an array of artist identifiers so that co-artist songs can be rendered with all participant information.

#### Acceptance Criteria

1. THE App SHALL support a release referencing between 1 and 20 artist identifiers stored in an ordered array, where array position represents display order
2. WHEN a release references multiple artist identifiers, THE App SHALL resolve each identifier to its corresponding artist data (name, logo URL, generation, artist type) from the DataStore artists map, preserving the array order for rendering
3. IF a release references an artist identifier that does not exist in the DataStore artists map, THEN THE App SHALL use the release's parent artist data (the artist whose file or record contains the release) as the fallback for that unresolved identifier
4. WHEN a release's artist identifier array is resolved, THE App SHALL provide each resolved artist's name, logo URL, generation, and artist type to the rendering layer
5. WHILE Artists_Mode is active, THE App SHALL attribute the full points and wins of a multi-artist release to each participating artist independently on their own respective bars (no combining or splitting); the co-artist array SHALL NOT affect Artists_Mode presentation
6. WHILE Songs_Mode is active, THE App SHALL use the co-artist array to render combined logos and names on the single release bar as specified in Requirement 2

### Requirement 6: Generation Filter

**User Story:** As a user, I want to filter chart entries by artist generation so that I can compare performance within or across generation groups.

#### Acceptance Criteria

1. THE Toolbar SHALL provide a Generation_Filter control that lists all generation values present in the loaded data, sorted in descending numeric order, plus an "All" option
2. WHEN the user selects a generation in the Generation_Filter, THE Race_View SHALL display only entries whose associated artist belongs to the selected generation; in Songs_Mode, a release matches if at least one of its associated artists belongs to the selected generation
3. WHEN the user selects a generation in the Generation_Filter, THE Yearly_View SHALL display only entries whose associated artist belongs to the selected generation; in Songs_Mode, a release matches if at least one of its associated artists belongs to the selected generation
4. WHEN the Generation_Filter is set to "All" (default), THE App SHALL display entries from all generations
5. WHEN new data introduces a generation value not previously present, THE Generation_Filter SHALL include it without code changes
6. WHEN a generation is selected in the Generation_Filter, THE App SHALL exclude non-matching entries from rank and cumulative value computations so that filtered-out entries do not affect the positions or values of displayed entries

### Requirement 7: Source Filter in Race View

**User Story:** As a user, I want to filter the race view by chart source show so that I can focus on performance from a specific program.

#### Acceptance Criteria

1. THE Toolbar SHALL provide a Source_Filter dropdown control that is visible and interactive in both Race_View and Yearly_View, containing one option for each of the 6 chart sources (inkigayo, the_show, show_champion, music_bank, m_countdown, show_music_core) plus an "All" option
2. WHEN the Source_Filter is set to "All", THE App SHALL include daily values from all sources when computing cumulative values in Race_View and aggregate values in Yearly_View
3. WHEN the user selects a specific source in the Source_Filter, THE Race_View SHALL include only daily values whose source field matches the selected source when computing cumulative point totals
4. WHEN the user selects a specific source in the Source_Filter, THE Yearly_View SHALL include only daily values whose source field matches the selected source when computing aggregate values
5. WHEN the user selects a source that yields zero matching daily values for an entry, THE App SHALL display that entry with a cumulative value of 0 rather than removing the entry from the view
6. THE Source_Filter SHALL default to "All" on initial page load and SHALL preserve the currently selected source value when switching between Race_View and Yearly_View

### Requirement 8: Unified Toolbar Layout

**User Story:** As a user, I want all controls consolidated in a persistent toolbar strip so that I can access any filter or toggle without switching views.

#### Acceptance Criteria

1. THE App SHALL render a Toolbar as a horizontal strip using sticky positioning at the top of the viewport, below any existing header, so it remains visible during scrolling
2. THE Toolbar SHALL contain the following controls ordered right-to-left: Songs/Artists toggle, Zoom_Toggle (10/All), Race/Yearly view switcher, Points/Wins metric toggle (visible only in Yearly_View), Source_Filter, Generation_Filter
3. THE Scrubber SHALL remain positioned at the bottom of the viewport, separate from the Toolbar
4. WHEN the viewport width is below 768px, THE Toolbar SHALL collapse into an expandable drawer that is closed by default, with a summary of active non-default filter values shown as chips
5. WHEN the user expands the mobile Toolbar drawer, THE App SHALL display all filter and toggle controls in a vertical layout
6. WHEN the user taps outside the mobile Toolbar drawer or selects a filter value, THE drawer SHALL dismiss automatically

### Requirement 9: Zoom Toggle Availability

**User Story:** As a user, I want the Top 10 / All zoom toggle available in both views so that I can control display density regardless of the current view.

#### Acceptance Criteria

1. THE Toolbar SHALL display the Zoom_Toggle in both Race_View and Yearly_View
2. WHEN the user changes the Zoom_Toggle, THE App SHALL apply the new zoom level to the currently active view without requiring a page reload or view switch
3. WHEN the Zoom_Toggle is set to "Top 10", THE Race_View SHALL display at most 10 active entries (subject to activity-based filtering per Requirement 10)
4. WHEN the Zoom_Toggle is set to "All", THE Race_View SHALL display all entries that meet activity criteria as defined in Requirement 10
5. WHEN the Zoom_Toggle is set to "Top 10", THE Yearly_View SHALL display at most 10 entries per year in grid layout
6. WHEN the Zoom_Toggle is set to "All", THE Yearly_View SHALL display all entries in treemap layout

### Requirement 10: Inactive Window Reduction

**User Story:** As a user, I want bars to cycle out faster in the race view so that the display stays current with the increased data volume.

#### Acceptance Criteria

1. THE Race_View inactive window SHALL be reduced from 14 days to 3 days; all existing activity-based filtering logic (goalpost chaining, rank 1 always shown, backfill to 10) SHALL continue to apply unchanged with the new 3-day threshold

### Requirement 11: Filter State Persistence Across Views

**User Story:** As a user, I want my filter selections to persist when switching between race and yearly views so that I do not lose my filtering context.

#### Acceptance Criteria

1. WHEN the user switches from Race_View to Yearly_View, THE App SHALL preserve the current Filter_State (display mode, generation selection, source selection, zoom level) such that the target view renders with the same filter values applied and the Toolbar controls reflect the preserved selections
2. WHEN the user switches from Yearly_View to Race_View, THE App SHALL preserve the current Filter_State (display mode, generation selection, source selection, zoom level) such that the target view renders with the same filter values applied and the Toolbar controls reflect the preserved selections
3. WHEN the App initializes or the page is refreshed, THE App SHALL reset Filter_State to defaults: Songs_Mode active, Race_View selected, Zoom_Toggle set to "Top 10", Generation_Filter set to "All", Source_Filter set to "All"
4. WHEN the user switches views, THE App SHALL render the target view with the preserved Filter_State already applied, without displaying unfiltered content before applying filters
5. WHEN the user switches from Race_View to Yearly_View while playback is in progress, THE App SHALL preserve the Filter_State and the current playback position so that switching back restores both filtering context and timeline position

### Requirement 12: Default Application State

**User Story:** As a user, I want the app to start in a consistent known state so that my experience is predictable on every visit.

#### Acceptance Criteria

1. WHEN the App initializes, THE App SHALL set Display_Mode to Songs_Mode
2. WHEN the App initializes, THE App SHALL set the active view to Race_View
3. WHEN the App initializes, THE App SHALL set Zoom_Toggle to "Top 10"
4. WHEN the App initializes, THE App SHALL set Generation_Filter to "All"
5. WHEN the App initializes, THE App SHALL set Source_Filter to "All"
6. WHEN the App initializes, THE App SHALL set playback position to the most recent available date in the dataset
7. IF data loading fails during initialization, THEN THE App SHALL display an error message and SHALL NOT render any filter controls or views
