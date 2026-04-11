# Requirements Document

## Introduction

A web-based animated bar chart race visualization that displays K-pop group and artist chart performance over time. The application renders horizontal bars representing artists ranked by cumulative daily performance values, with smooth animations as rankings change. The app is entirely static (no backend), powered by JSON data files, and hosted on GitHub Pages. Built with vanilla TypeScript and Vite, following a TDD approach with property-based testing.

## Glossary

- **Chart_Race**: The animated bar chart visualization where horizontal bars representing artists move, grow, and shrink over time as cumulative performance values change.
- **Bar**: A single horizontal bar in the Chart_Race representing one artist or group, displaying name, logo, and value.
- **Performance_Value**: A numeric daily value assigned to an artist for a given date, representing chart performance.
- **Cumulative_Value**: The running total of all Performance_Values for an artist from the start date up to the current date in the visualization.
- **Playback_Controller**: The component responsible for controlling animation playback, including play, pause, and timeline scrubbing.
- **Timeline_Scrubber**: A slider control that allows the user to move forward or backward through dates in the visualization.
- **Zoom_Selector**: A control that allows the user to toggle between different visible entry counts (Top 10, All).
- **Detail_Panel**: A modal or sidebar that displays full details for a selected artist, including historical data and embedded media content.
- **Data_Loader**: The component responsible for reading, parsing, and combining JSON data files at runtime.
- **Embed_Renderer**: The component responsible for converting stored permalinks into embedded media players (YouTube, Apple Music, Instagram, TikTok).
- **Tween**: A smooth numeric interpolation between two values over a time interval, used to animate value transitions.
- **Artist_Type**: A classification of a K-pop artist: one of "boy_group", "girl_group", "solo_male", "solo_female", or "mixed_group". Each Artist_Type maps to a distinct bar color in the Chart_Race.
- **Generation**: A positive integer (1 or greater) representing the K-pop generation an artist belongs to, displayed as a Roman numeral inside the Bar.
- **Release_Entry**: A JSON data object representing a single song or album release by an artist, containing the release title, daily Performance_Values keyed by date (each including a numeric value, a Chart_Source identifying the music show program, and an episode number identifying the specific episode of that show), and a collection of date-keyed embed entries. Each date maps to an array of EmbedDateEntry objects, allowing multiple embed groups with different Event_Types on the same date (e.g., a "live_performance" YouTube video and a "promotion" Instagram post on the same date). Each EmbedDateEntry contains an Event_Type label and a list of embed links. Each embed link is an object with a URL and an optional description field; when a description is provided, it is displayed alongside the embedded content in the Detail_Panel.
- **Chart_Source**: A validated string identifying the music show program that produced a daily Performance_Value. The initial set of known values is: "inkigayo", "the_show", "show_champion", "music_bank". Each known Chart_Source maps to a static logo asset. The set can grow but must be explicitly defined. Unknown Chart_Source values are not rejected — entries with unrecognized sources are still included, but displayed without a logo.
- **Chart_Win**: A daily Performance_Value entry where the artist achieved the highest value for a given Chart_Source on a given date across all artists in the dataset. If multiple artists tie for the highest value, all tied artists are considered winners. Total Chart_Wins for the same Release_Entry on the same Chart_Source are tracked to determine the Crown_Level.
- **Crown_Level**: An integer (1 through 5) representing the total number of Chart_Wins an artist has achieved for the same Release_Entry on the same Chart_Source. Crown_Level 3 is known as a "Triple Crown." Each level maps to a progressively more elaborate crown icon.
- **Event_Type**: A string label stored in the JSON data describing the type of content for a date entry within a Release_Entry (e.g., "trailer", "mv", "live_performance", "release_date", "chart_performance", "promotion"). The full set of Event_Type values will be defined in the data model. The Detail_Panel uses Event_Type to display a human-readable title for each timeline entry.
- **Featured_Release**: The Release_Entry most relevant to a given artist at the current date. When one or more Release_Entry objects have non-zero Performance_Values on the current date, the Featured_Release is the one with the highest Performance_Value. When no Release_Entry has a non-zero Performance_Value on the current date, the Featured_Release retains the most recent release that had a non-zero Performance_Value. The Featured_Release title is always displayed next to the bar.
- **Artist_Entry**: A JSON data object representing a single K-pop artist or group, containing artist name, Artist_Type, Generation, logo reference, and a collection of Release_Entry objects.
- **Loading_Screen**: The initial screen displayed while the Data_Loader fetches and parses JSON data files. Shows loading progress, a scrolling list of artist names as they are discovered, and transitions to the Chart_Race once loading completes.

## Requirements

### Requirement 1: Data Loading and Parsing

**User Story:** As a user, I want the application to load chart data from JSON files, so that I can view K-pop performance visualizations without a backend server.

#### Acceptance Criteria

1. WHEN the application starts, THE Data_Loader SHALL read all JSON files from the configured data folder and combine them into a single dataset.
2. THE Data_Loader SHALL parse each JSON file as a single Artist_Entry object containing artist name, Artist_Type, Generation, logo reference, and a collection of Release_Entry objects (each with release title, daily Performance_Values keyed by date, and a collection of date-keyed embed permalinks).
3. IF a JSON file contains invalid syntax, THEN THE Data_Loader SHALL log a descriptive error message identifying the file and continue loading remaining files.
4. IF a file's Artist_Entry has missing required fields (name, Artist_Type, Generation, or at least one Release_Entry with daily values), THEN THE Data_Loader SHALL skip that file and log a warning identifying the file and entry.
5. THE Data_Loader SHALL compute an artist's daily Performance_Value for a given date by summing the Performance_Values of all Release_Entry objects for that artist on that date.
6. WHEN the Chart_Race advances to a new date, THE Data_Loader SHALL identify the Featured_Release for each artist as the Release_Entry with the highest Performance_Value on that date; when all Release_Entry Performance_Values are zero for that date, THE Data_Loader SHALL retain the most recent release that had a non-zero Performance_Value as the Featured_Release.
7. IF an Artist_Entry contains an Artist_Type value not in the set ("boy_group", "girl_group", "solo_male", "solo_female", "mixed_group"), THEN THE Data_Loader SHALL skip that entry and log a warning identifying the invalid Artist_Type.
8. IF an Artist_Entry contains a Generation value that is not a positive integer (less than 1), THEN THE Data_Loader SHALL skip that entry and log a warning identifying the invalid Generation.
9. IF a DailyValueEntry contains a Chart_Source value not in the known validated set ("inkigayo", "the_show", "show_champion", "music_bank"), THEN THE Data_Loader SHALL log a warning identifying the unknown source but SHALL still include the entry in the dataset (the entry is displayed without a source logo).
10. THE Data_Loader SHALL format parsed Artist_Entry objects back into valid JSON (pretty-print capability).
11. FOR ALL valid Artist_Entry collections, parsing then printing then parsing SHALL produce an equivalent collection (round-trip property).
12. FOR ALL artists on any given date, THE Data_Loader SHALL produce a daily Performance_Value equal to the sum of all Release_Entry Performance_Values for that artist on that date (invariant property).

### Requirement 2: Cumulative Value Calculation

**User Story:** As a user, I want to see cumulative performance values that sum over time, so that I can understand the total chart performance of each artist.

#### Acceptance Criteria

1. WHEN the Chart_Race advances to a new date, THE Chart_Race SHALL compute the Cumulative_Value for each artist by summing all Performance_Values from the start date up to and including the current date.
2. THE Chart_Race SHALL rank artists in descending order of Cumulative_Value for the current date.
3. WHEN two artists have equal Cumulative_Values, THE Chart_Race SHALL maintain their previous relative order (stable sort).
4. FOR ALL dates in the dataset, THE Cumulative_Value for each artist SHALL equal the sum of that artist's Performance_Values from the start date through the current date (invariant property).

### Requirement 3: Animated Bar Chart Race Rendering

**User Story:** As a user, I want to see an animated bar chart race with smooth transitions, so that I can visually follow how artist rankings change over time.

#### Acceptance Criteria

1. THE Chart_Race SHALL render horizontal bars for each visible artist, ordered by rank from top (highest Cumulative_Value) to bottom.
2. WHEN the Chart_Race advances to a new date, THE Chart_Race SHALL animate bar position changes over a transition duration so that bars smoothly move up or down as rankings change.
3. WHEN the Chart_Race advances to a new date, THE Chart_Race SHALL animate bar width changes proportionally to the ratio of each artist's Cumulative_Value to the highest Cumulative_Value among visible artists.
4. WHEN the Chart_Race advances to a new date, THE Chart_Race SHALL Tween displayed numeric values from the previous Cumulative_Value to the new Cumulative_Value over the transition duration.
5. THE Chart_Race SHALL display the current date prominently during playback.

### Requirement 4: Bar Content Display

**User Story:** As a user, I want each bar to show the artist name, logo, generation, color-coded type, and current driving release, so that I can identify artists, their background, and what is fueling their growth at a glance.

#### Acceptance Criteria

1. THE Bar SHALL display the artist or group name as text inside the bar.
2. THE Bar SHALL display the artist's logo or image inside or adjacent to the bar, loaded from a static asset referenced in the Artist_Entry.
3. THE Bar SHALL display the current Cumulative_Value as text outside the right edge of the bar.
4. IF an artist's logo asset is not found, THEN THE Bar SHALL render a placeholder graphic and display the artist name without interrupting the visualization.
5. THE Bar SHALL render its background color based on the artist's Artist_Type, using a distinct color for each of the five types: boy_group, girl_group, solo_male, solo_female, and mixed_group.
6. THE Chart_Race SHALL display a legend mapping each Artist_Type to its assigned color.
7. THE Bar SHALL display the artist's Generation as a Roman numeral prefixed with "Gen" (e.g., Gen III, Gen VI) as text inside the bar.
8. THE Bar SHALL display the title of the artist's Featured_Release as text outside the bar, adjacent to the Cumulative_Value (e.g., with a music note icon prefix like "♪ [release title]").
9. THE Bar SHALL render the artist's logo with a light halo or glow effect (e.g., CSS drop-shadow filter) around the non-transparent portions of the image to ensure the logo is visually distinct against any Artist_Type bar color.

### Requirement 5: Zoom Level Selection

**User Story:** As a user, I want to toggle between different zoom levels, so that I can focus on the top performers or see the full field.

#### Acceptance Criteria

1. THE Zoom_Selector SHALL provide options for Top 10 and All entries.
2. WHEN the user selects a zoom level, THE Chart_Race SHALL display only the number of top-ranked bars corresponding to the selected zoom level.
3. WHEN the selected zoom level results in more bars than fit in the viewport, THE Chart_Race SHALL enable vertical scrolling to view all visible bars.
4. WHEN the user changes the zoom level, THE Chart_Race SHALL scale bar heights proportionally to fit the selected number of entries within the available viewport height.
5. THE Zoom_Selector SHALL default to Top 10 on initial load.

### Requirement 6: Playback Controls

**User Story:** As a user, I want playback controls to start, stop, and scrub through the visualization, so that I can explore the data at my own pace.

#### Acceptance Criteria

1. THE Playback_Controller SHALL provide a play/pause toggle button.
2. WHEN the user presses play, THE Playback_Controller SHALL advance the Chart_Race by one date approximately every 1 second (autoplay).
3. WHEN the user presses pause, THE Playback_Controller SHALL stop advancing the Chart_Race and hold the current date.
4. THE Playback_Controller SHALL provide a Timeline_Scrubber that represents the full date range of the dataset.
5. WHEN the user drags the Timeline_Scrubber to a position, THE Playback_Controller SHALL update the Chart_Race to display the corresponding date.
6. WHEN the Chart_Race reaches the last date in the dataset during autoplay, THE Playback_Controller SHALL pause automatically.
7. WHEN the user is actively dragging the Timeline_Scrubber, THE Chart_Race SHALL continuously update bar positions, widths, and numeric values to reflect the date corresponding to the current scrubber position, animating at the pace of the user's drag.
8. WHEN the user drags the Timeline_Scrubber rapidly across many dates, THE Playback_Controller SHALL throttle rendering updates using requestAnimationFrame to maintain smooth performance.

### Requirement 7: Click-to-Detail Panel

**User Story:** As a user, I want to click on a bar to see detailed information about an artist, so that I can explore their history and media content.

#### Acceptance Criteria

1. WHILE the Playback_Controller is paused, WHEN the user clicks a Bar, THE Detail_Panel SHALL open displaying full details for the selected artist.
2. WHEN the user pauses playback, THE Detail_Panel SHALL automatically open showing the currently top-ranked artist, serving as a discovery mechanism to indicate that any Bar can be clicked for details.
3. WHEN the user resumes playback by pressing play, THE Detail_Panel SHALL automatically close.
4. THE Detail_Panel SHALL display a vertical timeline of all dates for the selected artist, with entries alternating on left and right sides of a central timeline line.
5. Each date entry in the vertical timeline SHALL display the date as a heading, followed by the content for that date: the Chart_Source logo (for known sources), the episode number (e.g., "Ep 480"), the Performance_Value, embeds rendered inline via the Embed_Renderer, or both, along with a human-readable label derived from the Event_Type field. Each date may have multiple embed groups with different Event_Types. IF an embed link has a description, THE Detail_Panel SHALL display the description text alongside the embedded content.
6. WHEN the vertical timeline content exceeds the Detail_Panel viewport height, THE Detail_Panel SHALL enable independent scrolling within the timeline.
7. THE Detail_Panel SHALL render embed permalinks inline within their respective date entries in the vertical timeline, passing each permalink to the Embed_Renderer without requiring a separate selection step.
8. WHEN the user clicks a close button or clicks outside the Detail_Panel, THE Detail_Panel SHALL close and return focus to the Chart_Race.
9. WHILE the Playback_Controller is playing, WHEN the user taps or clicks a Bar, THE Playback_Controller SHALL immediately pause the animation, resolve the tap against the bar positions at the moment of the pause (freeze-then-resolve), and open the Detail_Panel for the Bar under the tap point.
10. THE Bar SHALL provide a tap/click target area that extends beyond the visible bar bounds by additional padding to minimize mis-taps, especially on mobile devices.
11. WHEN a daily Performance_Value entry represents the highest value for that Chart_Source on that date across all artists in the dataset, THE Detail_Panel SHALL visually highlight that entry with an escalating crown icon based on the Crown_Level (1 through 5), where level 3 represents the "Triple Crown." Each successive Crown_Level SHALL display a progressively more elaborate crown icon. If multiple artists tie for the highest value, all tied artists SHALL be highlighted. The Crown_Level is the total count of Chart_Wins for the same Release_Entry on the same Chart_Source, regardless of whether other releases won in between.

### Requirement 8: Embed Rendering

**User Story:** As a user, I want to see embedded YouTube videos, Apple Music players, and social media posts in the detail panel, so that I can engage with the artist's content directly.

#### Acceptance Criteria

1. WHEN the Embed_Renderer receives a YouTube permalink from a Release_Entry date-keyed embed collection, THE Embed_Renderer SHALL render it as an embedded YouTube video player using the standard YouTube iframe embed template.
2. WHEN the Embed_Renderer receives an Apple Music permalink from a Release_Entry date-keyed embed collection, THE Embed_Renderer SHALL render it as an embedded Apple Music player using the standard Apple Music embed template.
3. WHEN the Embed_Renderer receives an Instagram permalink from a Release_Entry date-keyed embed collection, THE Embed_Renderer SHALL render it as an embedded Instagram post using the standard Instagram embed template.
4. WHEN the Embed_Renderer receives a TikTok permalink from a Release_Entry date-keyed embed collection, THE Embed_Renderer SHALL render it as an embedded TikTok post using the standard TikTok embed template.
5. IF a permalink is malformed or the embed fails to load, THEN THE Embed_Renderer SHALL display a fallback link to the original permalink with descriptive text.
6. FOR ALL supported permalink types, THE Embed_Renderer SHALL sanitize the permalink input to prevent script injection before rendering.

### Requirement 9: Responsive Design

**User Story:** As a user, I want the visualization to work well on both mobile and desktop devices, so that I can view it on any screen size.

#### Acceptance Criteria

1. THE Chart_Race SHALL adapt its layout to viewport widths from 320px to 2560px.
2. WHEN the viewport width is below 768px, THE Chart_Race SHALL use a mobile-optimized layout with appropriately sized bars, text, and controls.
3. WHEN the viewport width is 768px or above, THE Chart_Race SHALL use a desktop-optimized layout.
4. THE Playback_Controller and Zoom_Selector SHALL remain accessible and usable at all supported viewport widths.
5. THE Detail_Panel SHALL render as a full-screen overlay on viewports below 768px and as a sidebar on viewports 768px or above.

### Requirement 10: Static Hosting and Build

**User Story:** As a developer, I want the application to build as a static site deployable to GitHub Pages, so that I can host it for free with minimal configuration.

#### Acceptance Criteria

1. THE application SHALL use Vite as the build tool to produce a static output bundle.
2. THE application SHALL use vanilla TypeScript with no frontend framework dependencies.
3. WHEN the build command is executed, THE application SHALL produce a self-contained static output directory deployable to GitHub Pages.
4. THE application SHALL include a GitHub Actions workflow file that builds and deploys the site to GitHub Pages on push to the primary branch.
5. THE application SHALL use Vitest as the test runner for all unit and property-based tests.

### Requirement 11: Accessibility

**User Story:** As a user with assistive technology, I want the visualization to be accessible, so that I can understand the chart data and use the controls.

#### Acceptance Criteria

1. THE Playback_Controller buttons SHALL have descriptive aria-labels indicating their function (play, pause).
2. THE Timeline_Scrubber SHALL have an aria-label describing its purpose and an aria-valuenow reflecting the current date.
3. THE Zoom_Selector SHALL be operable via keyboard navigation.
4. THE Detail_Panel SHALL trap focus while open and return focus to the triggering Bar when closed.
5. THE Chart_Race SHALL provide a visually hidden live region that announces the current date and top-ranked artist when the date changes during playback.
6. THE Chart_Race SHALL use a colorblind-friendly palette for the five Artist_Type bar colors that is distinguishable under common color vision deficiencies (deuteranopia, protanopia, tritanopia).
7. Each Artist_Type SHALL be visually distinguishable by a secondary indicator in addition to color (e.g., a subtle pattern, icon, or shape marker), so that Artist_Types remain identifiable without relying solely on color.
8. THE Chart_Race legend SHALL display both the color and the secondary indicator for each Artist_Type.
9. THE application SHALL ensure all text, icons, and interactive elements meet WCAG 2.1 AA minimum contrast ratios (4.5:1 for normal text, 3:1 for large text and UI components) against their backgrounds, including text rendered inside and outside bars against their Artist_Type background colors.
10. WHEN a screen reader is detected (via prefers-reduced-motion media query or similar heuristic), THE Playback_Controller SHALL switch to a screen-reader-paced mode where the Chart_Race waits for the live region announcements to complete before advancing to the next date, ensuring screen reader users can follow the race narrative without being overwhelmed by rapid updates.
11. WHILE in screen-reader-paced mode, THE Playback_Controller SHALL provide a visually hidden control (accessible only to screen readers and keyboard users) that allows the user to configure how many of the top-ranked artists are announced per date (e.g., top 1, top 3, top 5, top 10); THE Chart_Race SHALL announce the date, then the configured number of top-ranked artists with their names and Cumulative_Values, then automatically advance to the next date.
12. THE screen-reader-paced mode SHALL default to announcing the top 1 artist per date (date plus top-ranked artist name and Cumulative_Value).

### Requirement 12: Loading State

**User Story:** As a user, I want to see an engaging loading experience while the application loads data, so that I know the app is working and I stay interested while waiting.

#### Acceptance Criteria

1. WHEN the application starts loading JSON data files, THE application SHALL display a loading screen that replaces the main visualization area.
2. THE loading screen SHALL display a progress indicator showing the number of files loaded out of the total (e.g., "Loading... 3/12 files").
3. AS each JSON file is parsed, THE loading screen SHALL display the names of artists found in that file in a rapid scrolling animation, creating a "credits roll" effect that previews the artists in the dataset.
4. THE loading screen SHALL display a progress bar or percentage indicator reflecting overall loading progress.
5. WHEN all JSON files have been loaded and parsed, THE loading screen SHALL transition smoothly to the main Chart_Race visualization.
6. IF all JSON files fail to load, THE loading screen SHALL display an error message: "Unable to load chart data. Please try refreshing the page."
7. IF the dataset is empty after loading (no valid entries), THE loading screen SHALL display an informational message: "No chart data available."
8. WHEN the Detail_Panel opens for an artist with many embeds, THE Detail_Panel SHALL lazy-load embed iframes as they scroll into view (intersection observer) to avoid rendering stutter.