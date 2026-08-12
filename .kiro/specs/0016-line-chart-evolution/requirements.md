# Requirements: Line Chart Evolution

## Overview

Transform the K-Pop Chart Race from a bar chart race into a running line chart visualization. All race views become animated lines accumulating left-to-right over time. The detail drawer is replaced by inline interaction — clicking a line highlights it and overlays event dots directly on the line. A new Episode Browser view is added. Performance must scale to 10K+ songs over 30 years of data.

## User Stories

### US-1: Running Line Chart (Songs Mode)
As a user, I want to see songs as lines running left-to-right over time, where each line's Y position represents its cumulative rank, so I can watch songs compete in real-time.

**Acceptance Criteria:**
- Each song is rendered as a line on a canvas-based chart
- Lines animate left-to-right as dates advance
- Y-axis represents raw cumulative points (lines only go up)
- A song that has no new data continues at its last value (flat line forward)
- New songs enter at the bottom when they first appear and climb
- Animation is smooth at 60fps on mobile devices

### US-2: Running Line Chart (Artists Mode)
As a user, I want to see artists as lines where cumulative points across all their releases are aggregated, so I can see artist-level competition.

**Acceptance Criteria:**
- Same line chart infrastructure as Songs mode but one line per artist (aggregated across all releases)
- Artist lines accumulate across all releases — a new release adds to the same artist line
- Dimming/visibility rules apply at the artist aggregation level (an artist's last activity is the most recent activity across ANY of their releases)
- Always shows all artists that pass the visibility threshold — no songs are shown individually in this mode

### US-3: Visibility & Dimming System
As a user, I want inactive lines to fade and eventually disappear so the chart stays readable with 10K+ songs.

**Acceptance Criteria:**
- Days 0–7 with no new activity: line at full opacity (100%)
- Days 7–28 (base ceiling): linear fade from 100% to 0% opacity
- At 0% opacity the line is not rendered (performance optimization)
- Each active filter doubles the ceiling (7→56, 7→112, etc.)
- Selecting a specific artist filter overrides: all their lines always visible at 100% (applies in Songs mode to show all songs by that artist, and in Artists mode to keep that artist's line visible)
- Dimming applies to both Songs and Artists modes
- In Artists mode, "last activity" means the most recent activity across any of that artist's releases

### US-4: Z-Index / Draw Order
As a user, I want recently active lines on top and inactive ones behind, so I can easily see what's happening now.

**Acceptance Criteria:**
- Primary sort: recency of last activity (more recent = drawn on top)
- Tie-breaker: lifetime-to-date cumulative points (higher LTD = on top)
- Applies to the entire line (full history), not just the current segment
- Highlighted/selected line always renders on the very top layer regardless of activity

### US-5: Inline Detail (Click-to-Highlight)
As a user, I want to click a line and have it expand with event dots instead of opening a side drawer, so I can explore an artist/song's history inline.

**Acceptance Criteria:**
- Clicking a line: all other lines dim significantly, selected line thickens/brightens
- Event dots appear on the selected line at their respective dates:
  - Album/single release (from embeds with type "release_date")
  - Music video release (type "mv")
  - Live performances (type "live_performance")
  - Chart wins (from chartWins data)
- Hovering/tapping a dot shows a popover with the event details and embedded media
- Clicking elsewhere or pressing Escape deselects
- The right-side detail drawer is removed entirely

### US-6: Time Scale & Navigation
As a user, I want to zoom and pan across 30 years of data without losing context.

**Acceptance Criteria:**
- Zoomable time window with presets: All Time, Decade, Year, 90 days
- Default view on load: most recent 90 days (showing current state, no animation)
- Playing the animation resets to the beginning and runs forward through all dates
- During animation: sliding window auto-scrolls to keep the "now" line visible within the current zoom level
- When paused: user can drag/pinch to explore the full timeline
- Level-of-detail: zoomed out uses weekly/monthly aggregation; zoomed in uses daily

### US-7: Episode Browser
As a user, I want to browse individual music show episodes chronologically and see the chart + performances for each, so I can explore the data as an archive.

**Acceptance Criteria:**
- Separate view (not a race) — a scrollable timeline of episodes in chronological order (most recent first)
- Episodes from all shows are interleaved by date (cycling through shows each week)
- Each show has a distinctive color/style so episodes are visually distinguishable at a glance
- Show logos displayed on each episode card
- Opening/expanding an episode shows: chart ranking for that episode, winner, listed performances
- Live performance videos are listed but collapsed by default; user can expand to watch inline
- Clicking an artist name opens a drawer showing that artist's full timeline history
- Clicking a song name opens a drawer showing only that song's history (same layout, scoped to one release)
- Filterable by show source (narrow to a single show or subset)

### US-8: Performance at Scale
As a user on mobile, I want smooth 60fps animation even with thousands of lines and 30 years of data.

**Acceptance Criteria:**
- Canvas-based rendering (not DOM/SVG) for all line chart views
- Web Worker for snapshot computation (off main thread)
- Level-of-detail downsampling when zoomed out
- Viewport culling: only draw visible time window
- Layered canvas: static background layer for dim/inactive lines, foreground for active
- OffscreenCanvas in Web Worker for heavy drawing where supported
- Lazy time-range loading: only fetch the current time window's data; older ranges loaded on demand
- Memory budget: ≤30MB working set on mobile; LRU eviction of off-screen time ranges
- Sparse storage: cumulative values stored as change-points, not dense daily arrays
- Target: 60fps on mid-range mobile (2022+ iPhone SE / Galaxy A series)

### US-9: Yearly View Refresh
As a user, I want the yearly bar chart view to visually match the new design language and let me explore artist/song history.

**Acceptance Criteria:**
- Yearly view keeps bar chart format (not lines)
- Visual styling updated to match new color palette and typography
- Clicking a bar opens the artist drawer (full timeline history)
- If a specific song is identifiable from context (e.g., yearly view in songs mode), clicking opens the song drawer instead
- Interactions remain the same otherwise

### US-10: Filters & Highlighting
As a user, I want existing filters (generation, source, artist type) to work on line views, plus a way to search/pick specific lines to highlight.

**Acceptance Criteria:**
- All existing filters (generation, source, zoom) apply to line views
- Search/autocomplete to find and highlight a specific artist or song
- Multiple highlights possible (compare mode)
- Filter changes adjust the dimming ceiling as described in US-3

## Non-Functional Requirements

- No bar races anywhere. Yearly view has static bar charts. All race views are lines only.
- The existing bar chart race renderer can be removed after line views are complete.
- URL state should encode view, filters, time window, and highlighted lines for shareability (future phase).

## Mobile Orientation

- **Line chart views (Songs & Artists race):** Landscape only on mobile. Show a rotate-device prompt if in portrait.
- **Yearly bar chart view:** Works in both portrait and landscape.
- **Episode Browser:** Works in both portrait and landscape.
- **Drawer (artist/song history):** Works in both portrait and landscape.
