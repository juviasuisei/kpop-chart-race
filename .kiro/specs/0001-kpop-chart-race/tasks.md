# Implementation Plan: K-Pop Chart Race

## Overview

Incremental implementation of a static animated bar chart race visualizing K-pop artist chart performance. Starts with project scaffolding and data layer, builds up the core computation engine, then UI components, accessibility, and finally build/deploy. Each task builds on previous work so there is no orphaned code.

## Tasks

- [x] 0. Git and GitHub setup
  - [x] 0.1 Initialize git repository with personal account
    - Run `git init` in the workspace root
    - Configure repo-level git identity (NOT global) so work git is unaffected:
      - `git config user.name "[personal name]"`
      - `git config user.email "[personal email]"`
    - This uses repo-level `.git/config` — other workspaces keep using the global/work identity
    - _Prerequisites: none_

  - [x] 0.2 Create GitHub repository and connect remote
    - Create a new repository on GitHub (personal account) via browser or `gh` CLI
    - Add the remote: `git remote add origin https://github.com/[username]/[repo-name].git`
    - If using HTTPS with personal account while work uses SSH, configure a repo-level credential helper or use a GitHub personal access token for this repo only
    - _Prerequisites: 0.1_

  - [x] 0.3 Create .gitignore and initial commit
    - Create `.gitignore` with standard Node/Vite entries: `node_modules/`, `dist/`, `.DS_Store`, `*.local`
    - Stage all spec files and .gitignore
    - Create initial commit: `git commit -m "chore: initial commit with spec documents"`
    - Push to remote: `git push -u origin main`
    - _Prerequisites: 0.2_

- [x] 1. Project scaffolding and configuration
  - [x] 1.1 Initialize Vite + TypeScript project
    - Run `npm create vite@latest` with vanilla-ts template
    - Configure `tsconfig.json` with strict mode
    - Install dev dependencies: `vitest`, `fast-check`, `@fast-check/vitest`, `jsdom`
    - Configure `vitest.config.ts` with jsdom environment
    - Create directory structure: `src/`, `tests/unit/`, `tests/property/`, `assets/`, `data/`
    - Create `src/main.ts` entry point (empty shell)
    - _Requirements: 10.1, 10.2, 10.5_

  - [x] 1.2 Define core TypeScript interfaces and types
    - Create `src/types.ts` with all data model interfaces: `ArtistEntry`, `ReleaseEntry`, `DailyValueEntry`, `EmbedDateEntry`, `EmbedLink`, `ArtistType`, `ChartSource`, `EventType`, `ZoomLevel`
    - Create `src/models.ts` with runtime models: `ParsedArtist`, `ParsedRelease`, `ParsedEmbedDateEntry`, `ParsedEmbedLink`, `ChartSnapshot`, `RankedEntry`, `FeaturedReleaseInfo`, `DataStore`
    - _Requirements: 1.2, 1.5, 1.6_

  - [x] 1.3 Implement EventBus
    - Create `src/event-bus.ts` with `on`, `off`, `emit` methods
    - Typed event map for all events: `data:loaded`, `date:change`, `state:updated`, `play`, `pause`, `zoom:change`, `bar:click`, `panel:close`, `loading:progress`, `loading:complete`, `loading:error`
    - _Requirements: 1.1 (component communication)_

  - [x]* 1.4 Write unit tests for EventBus
    - Test subscribe, emit, unsubscribe, multiple handlers, emit with no listeners
    - _Requirements: 1.1_

  - [x] 1.5 Generate sample JSON data files
    - Create `data/` folder with ~8-10 dummy artist JSON files exercising all data model features:
      - Mix of all 5 Artist_Types (boy_group, girl_group, solo_male, solo_female, mixed_group)
      - Multiple generations (2, 3, 4, 5)
      - Artists with multiple releases (2-3 each) with overlapping date ranges
      - Daily values across ~30 dates using all 4 Chart_Sources with episode numbers
      - Values designed to produce ranking changes, ties, and overtakes over time
      - At least one artist with 3+ wins on the same source/release (to test Triple Crown)
      - Embed entries with YouTube, Apple Music, Instagram, TikTok URLs (using placeholder/example URLs)
      - Multiple embed groups per date with different Event_Types
      - Some embed links with descriptions, some without
      - At least one unknown Chart_Source value (to test warning behavior)
      - At least one artist with a missing logo path (to test placeholder)
    - Create placeholder logo files in `assets/logos/` (simple colored SVGs)
    - Create placeholder source logos in `assets/sources/` (simple labeled SVGs)
    - This data will be used for visual preview and testing throughout development; swap for real data later
    - _Prerequisites: 1.2 (types must be defined first)_

- [x] 2. Data layer — loading, validation, serialization
  - [x] 2.1 Implement Data_Loader with validation
    - Create `src/data-loader.ts`
    - `loadAll(basePath)`: fetch JSON files, parse each as `ArtistEntry`, validate required fields, validate `artistType` enum, validate `generation` as positive integer
    - Skip invalid entries with console warnings; log errors for unparseable files; log warnings for unknown `ChartSource` values
    - Continue loading on individual file failure
    - Slugify artist name and release title to produce `id` fields
    - Convert parsed data into `DataStore` with `artists` Map, sorted `dates` array, `startDate`, `endDate`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8, 1.9_

  - [x] 2.2 Implement serialize/deserialize round-trip
    - Add `serialize(artist: ArtistEntry): string` — pretty-print JSON
    - Add `deserialize(json: string): ArtistEntry` — parse JSON back
    - _Requirements: 1.10, 1.11_

  - [x]* 2.3 Write property test — Property 1: Serialization Round Trip
    - **Property 1: Serialization Round Trip**
    - Generate random valid `ArtistEntry` objects with fast-check; verify `deserialize(serialize(entry))` ≡ `entry`
    - **Validates: Requirements 1.10, 1.11**

  - [x]* 2.4 Write property test — Property 2: Validation Rejects Invalid Entries
    - **Property 2: Validation Rejects Invalid Entries**
    - Generate `ArtistEntry` objects with randomly invalidated fields (missing name, bad artistType, non-positive generation, no releases); verify rejection
    - **Validates: Requirements 1.4, 1.7, 1.8**

  - [x]* 2.5 Write unit tests for Data_Loader
    - Test invalid JSON handling (1.3), empty dataset, single file, missing required fields (1.4), invalid artistType (1.7), invalid generation (1.8), unknown ChartSource warning (1.9)
    - _Requirements: 1.3, 1.4, 1.7, 1.8, 1.9_

- [x] 3. Checkpoint — Data layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Core engine — cumulative values, ranking, featured releases
  - [x] 4.1 Implement ChartEngine.computeSnapshot
    - Create `src/chart-engine.ts`
    - `computeSnapshot(date, previousSnapshot?)`: compute daily values per artist (sum of all release `.value` fields), compute cumulative values from startDate through date, rank artists descending by cumulative value with stable sort for ties, identify featured release per artist
    - _Requirements: 1.5, 1.6, 1.12, 2.1, 2.2, 2.3, 2.4_

  - [x] 4.2 Implement ChartEngine.computeChartWins
    - `computeChartWins(dataStore)`: iterate all dates and sources, determine winner(s) per (date, source) pair, track crown levels per (artistId, releaseId, source) tuple, cap at 5
    - Return `Map<string, Map<string, { artistIds, crownLevels }>>` (date → source → winners)
    - _Requirements: 7.11_

  - [x]* 4.3 Write property test — Property 3: Daily Performance Sum Invariant
    - **Property 3: Daily Performance Sum Invariant**
    - Generate artists with multiple releases and random dates; verify daily value = sum of all release `.value` fields
    - **Validates: Requirements 1.5, 1.12**

  - [x]* 4.4 Write property test — Property 5: Cumulative Value Invariant
    - **Property 5: Cumulative Value Invariant**
    - Generate artist data across random date ranges; verify cumulative = sum of daily values from start through current date
    - **Validates: Requirements 2.1, 2.4**

  - [x]* 4.5 Write property test — Property 6: Ranking Descending Order
    - **Property 6: Ranking Descending Order**
    - Generate random cumulative value arrays; verify entries sorted descending
    - **Validates: Requirements 2.2**

  - [x]* 4.6 Write property test — Property 7: Stable Sort for Ties
    - **Property 7: Stable Sort for Ties**
    - Generate arrays with intentional duplicate cumulative values; verify tied artists maintain previous relative order
    - **Validates: Requirements 2.3**

  - [x]* 4.7 Write property test — Property 4: Featured Release Selection
    - **Property 4: Featured Release Selection**
    - Generate artists with multiple releases and varying daily values; verify highest-value release selected, or most recent non-zero when all zero
    - **Validates: Requirements 1.6**

  - [x]* 4.8 Write property test — Property 18: Chart Win Determination and Crown Level
    - **Property 18: Chart Win Determination and Crown Level**
    - Generate multiple artists with random daily values across dates and sources; verify winners are highest-value artists per (date, source), crown levels track total wins per (artistId, releaseId, source) capped at 5
    - **Validates: Requirements 7.11**

- [x] 5. Checkpoint — Core engine
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Utility functions
  - [x] 6.1 Implement tween and Roman numeral utilities
    - Create `src/utils.ts`
    - `tween(start, end, t)`: linear interpolation returning `start + (end - start) * t`
    - `toRomanNumeral(n)`: convert positive integer to "Gen I", "Gen II", etc.
    - `computeBarWidth(cumulativeValue, maxCumulativeValue)`: return proportional width (0 when max is 0)
    - `filterByZoom(entries, zoomLevel)`: return top-N or all entries
    - `positionToDate(position, dates)`: map scrubber position to date string
    - _Requirements: 3.3, 3.4, 4.7, 5.2, 6.5_

  - [x]* 6.2 Write property test — Property 9: Tween Interpolation
    - **Property 9: Tween Interpolation**
    - Generate random start, end, t ∈ [0,1]; verify `tween(s, e, t) === s + (e - s) * t`, t=0 → start, t=1 → end
    - **Validates: Requirements 3.4**

  - [x]* 6.3 Write property test — Property 10: Generation to Roman Numeral
    - **Property 10: Generation to Roman Numeral Conversion**
    - Generate random positive integers; verify correct "Gen " + Roman numeral output
    - **Validates: Requirements 4.7**

  - [x]* 6.4 Write property test — Property 8: Bar Width Proportionality
    - **Property 8: Bar Width Proportionality**
    - Generate random cumulative values with known max; verify proportional width, 0 when max is 0
    - **Validates: Requirements 3.3**

  - [x]* 6.5 Write property test — Property 11: Zoom Level Filtering
    - **Property 11: Zoom Level Filtering**
    - Generate snapshots of varying sizes + zoom levels; verify correct count and top-N selection
    - **Validates: Requirements 5.2**

  - [x]* 6.6 Write property test — Property 12: Scrubber Position to Date Mapping
    - **Property 12: Scrubber Position to Date Mapping**
    - Generate random sorted date arrays + positions; verify correct date returned, monotonically increasing
    - **Validates: Requirements 6.5**

- [x] 7. Checkpoint — Utilities
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Embed Renderer
  - [x] 8.1 Implement Embed_Renderer
    - Create `src/embed-renderer.ts`
    - URL pattern detection: YouTube (`youtube.com/watch`, `youtu.be/`), Apple Music (`music.apple.com/`), Instagram (`instagram.com/p/`, `instagram.com/reel/`), TikTok (`tiktok.com/`)
    - Transform to embed templates: YouTube → iframe with `/embed/`, Apple Music → iframe with `embed.music.apple.com/`, Instagram → blockquote + embed script, TikTok → blockquote + embed script
    - Sanitize URLs: strip dangerous protocols (`javascript:`, `data:`), reject non-matching URLs
    - Render fallback anchor for unrecognized URLs
    - Display `link.description` as caption when provided
    - Iframes use `sandbox` attribute; external links use `rel="noopener noreferrer" target="_blank"`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x]* 8.2 Write property test — Property 13: Embed URL Transformation
    - **Property 13: Embed URL Transformation**
    - Generate random valid URLs for each embed type; verify correct embed template with extracted content ID
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

  - [x]* 8.3 Write property test — Property 14: Malformed URL Fallback
    - **Property 14: Malformed URL Fallback**
    - Generate random non-matching strings; verify fallback anchor element produced
    - **Validates: Requirements 8.5**

  - [x]* 8.4 Write property test — Property 15: Permalink Sanitization
    - **Property 15: Permalink Sanitization**
    - Generate strings with XSS payloads (script tags, javascript: URLs, event handlers); verify no executable script content in output
    - **Validates: Requirements 8.6**

- [x] 9. Loading Screen
  - [x] 9.1 Implement LoadingScreen component
    - Create `src/loading-screen.ts`
    - `mount(container)`: render loading UI replacing main visualization area
    - `onFileProgress(loaded, total, artistNames)`: update progress text ("Loading... N/M files"), progress bar percentage, scroll artist names in credits-roll animation
    - `onComplete()`: smooth fade/slide transition, then destroy loading screen
    - `onError(message)`: display error message ("Unable to load chart data..." or "No chart data available.")
    - Listen to EventBus events: `loading:progress`, `loading:complete`, `loading:error`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x]* 9.2 Write property test — Property 17: Loading Progress Display
    - **Property 17: Loading Progress Display**
    - Generate random (loaded, total) pairs where 0 ≤ loaded ≤ total, total > 0; verify progress text contains both counts and progress bar value = loaded/total
    - **Validates: Requirements 12.2, 12.4**

  - [x]* 9.3 Write unit tests for LoadingScreen
    - Test loading screen replaces visualization area (12.1), file progress indicator (12.2), artist name scrolling (12.3), progress bar (12.4), transition to Chart_Race (12.5), error on total failure (12.6), empty dataset message (12.7)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

- [x] 10. Chart Race Renderer
  - [x] 10.1 Implement Chart_Race Renderer
    - Create `src/chart-race-renderer.ts`
    - `mount(container)`: create chart container, legend element
    - `update(snapshot, zoomLevel)`: render/update bars with CSS transitions on `transform` (translateY) and `width`
    - Bar height: viewport / 10 for Top 10 zoom; fixed ~40px with scroll for All
    - Bar width proportional to `cumulativeValue / maxCumulativeValue`
    - Numeric value tweening via `requestAnimationFrame` using `tween()` utility
    - Each bar displays: artist name, logo (`<img>` with CSS `drop-shadow` halo), generation Roman numeral, cumulative value, featured release title ("♪ title")
    - Bar background color from `ArtistType` color palette (Wong palette) with secondary indicator icon
    - Placeholder SVG on logo load error
    - Legend mapping each `ArtistType` to color + secondary indicator
    - Current date displayed prominently
    - `destroy()`: cleanup DOM and animation frames
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.2, 5.3, 5.4_

  - [x]* 10.2 Write unit tests for Chart_Race Renderer
    - Test bar rendering (artist name 4.1, logo 4.2, value display 4.3, placeholder on error 4.4, color mapping 4.5, legend 4.6, featured release 4.8, logo halo 4.9)
    - Test zoom level bar height scaling (5.4), vertical scroll when overflow (5.3)
    - _Requirements: 3.1, 3.2, 4.1–4.9, 5.3, 5.4_

- [x] 11. Playback Controller and Zoom Selector
  - [x] 11.1 Implement Playback_Controller
    - Create `src/playback-controller.ts`
    - `mount(container)`: render play/pause button with aria-labels, timeline scrubber (`<input type="range">`) with aria-label and aria-valuenow
    - `play()`: start interval advancing one date per ~1s, emit `play` and `date:change` events
    - `pause()`: clear interval, emit `pause`
    - `seekTo(date)`: update scrubber position and emit `date:change`
    - Scrubber drag: throttle updates via `requestAnimationFrame`, continuous bar updates during drag
    - Auto-pause at last date
    - Screen-reader-paced mode: detect via `prefers-reduced-motion`, await live region announcement Promise before advancing
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 11.1, 11.2, 11.10_

  - [x] 11.2 Implement Zoom_Selector
    - Create `src/zoom-selector.ts`
    - Render radio button group for Top 10 / All
    - Default to Top 10
    - Keyboard navigable (arrow keys)
    - Emit `zoom:change` on selection
    - _Requirements: 5.1, 5.2, 5.5, 11.3_

  - [x]* 11.3 Write unit tests for Playback_Controller
    - Test play/pause toggle (6.1–6.3), scrubber range (6.4), auto-pause at end (6.6), continuous update during drag (6.7), aria-labels (11.1, 11.2)
    - _Requirements: 6.1–6.8, 11.1, 11.2_

  - [x]* 11.4 Write unit tests for Zoom_Selector
    - Test default Top 10 (5.5), all options rendered (5.1), keyboard navigation (11.3)
    - _Requirements: 5.1, 5.5, 11.3_

- [x] 12. Checkpoint — UI components
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Detail Panel
  - [x] 13.1 Implement Detail_Panel
    - Create `src/detail-panel.ts`
    - `open(artistId, dataStore)`: render vertical timeline with alternating left/right entries
    - Each entry: date heading, Chart_Source logo (for known sources), episode number ("Ep N"), performance value, Event_Type label, inline embeds via Embed_Renderer
    - Multiple embed groups per date with different Event_Types rendered in sequence
    - Display embed link descriptions alongside embedded content
    - Chart_Win entries highlighted with escalating crown icon (levels 1–5, level 3 = Triple Crown)
    - Focus trap while open; return focus to triggering bar on close
    - Full-screen overlay on mobile (<768px), sidebar on desktop (≥768px)
    - Independent scroll within timeline content
    - Auto-open on pause (top-ranked artist), auto-close on play
    - Lazy-load embed iframes via IntersectionObserver
    - Freeze-then-resolve: on bar click during playback, pause first, then resolve click target
    - Bar tap target padding for mobile
    - `close()`: remove panel, restore focus
    - `destroy()`: cleanup
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 9.5, 12.8_

  - [x]* 13.2 Write unit tests for Detail_Panel
    - Test open/close (7.1–7.3, 7.8), timeline layout (7.4), content display with source logo + episode (7.5), multiple embed groups per date (7.5), embed descriptions (7.5), scroll (7.6), Chart_Win crown icons by level (7.11), freeze-then-resolve (7.9), tap target padding (7.10), lazy-load embeds (12.8), focus trap (11.4), mobile overlay vs desktop sidebar (9.5)
    - _Requirements: 7.1–7.11, 9.5, 11.4, 12.8_

- [x] 14. Accessibility layer
  - [x] 14.1 Implement LiveRegionAnnouncer and ScreenReaderPacedMode
    - Create `src/live-region.ts`
    - `mount(container)`: render visually hidden `<div role="log" aria-live="polite">`
    - `announce(message)`: return Promise resolving after estimated read time delay
    - Create `src/screen-reader-paced-mode.ts`
    - Activate via `prefers-reduced-motion` media query
    - Visually hidden control for top-N announcement count (1, 3, 5, 10), default 1
    - `formatAnnouncement(snapshot)`: format date + top-N artist names and cumulative values
    - Wire into Playback_Controller: await announcement before advancing in paced mode
    - _Requirements: 11.5, 11.10, 11.11, 11.12_

  - [x]* 14.2 Write property test — Property 16: Announcement Formatting
    - **Property 16: Announcement Formatting**
    - Generate random snapshots + announcement counts (1, 3, 5, 10); verify formatted string contains date and exactly min(N, total) artist names with cumulative values
    - **Validates: Requirements 11.5, 11.11**

  - [x]* 14.3 Write unit tests for accessibility
    - Test ARIA labels (11.1, 11.2), keyboard navigation (11.3), focus trap (11.4), colorblind palette verification (11.6–11.8), contrast ratio calculation (11.9), paced mode activation (11.10), default announcement count (11.12)
    - _Requirements: 11.1–11.12_

- [x] 15. Checkpoint — Detail panel and accessibility
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Responsive design and styling
  - [x] 16.1 Implement responsive CSS and layout
    - Create `src/styles.css` (or modular CSS files)
    - Mobile layout (<768px): appropriately sized bars, controls, full-screen Detail_Panel overlay
    - Desktop layout (≥768px): optimized bar sizes, sidebar Detail_Panel
    - Viewport support from 320px to 2560px
    - Wong colorblind-friendly palette for ArtistType colors with secondary indicator icons
    - WCAG 2.1 AA contrast ratios (4.5:1 normal text, 3:1 large text/UI)
    - CSS transitions for bar position (translateY) and width
    - Logo halo effect via CSS `drop-shadow`
    - Crown icon styles for levels 1–5
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 11.6, 11.7, 11.8, 11.9_

  - [x]* 16.2 Write unit tests for responsive design
    - Test mobile/desktop breakpoints (9.1–9.5)
    - _Requirements: 9.1–9.5_

- [ ] 17. Application wiring and integration
  - [ ] 17.1 Wire all components together in main.ts
    - Create EventBus instance
    - Initialize Data_Loader → show LoadingScreen → on complete, mount Chart_Race, Playback_Controller, Zoom_Selector
    - Connect EventBus events: `date:change` → ChartEngine → `state:updated` → Chart_Race Renderer
    - Connect `play`/`pause` → Playback_Controller ↔ Detail_Panel auto-open/close
    - Connect `zoom:change` → Chart_Race Renderer
    - Connect `bar:click` → Detail_Panel open (with freeze-then-resolve during playback)
    - Connect `loading:progress`/`loading:complete`/`loading:error` → LoadingScreen
    - Connect LiveRegionAnnouncer and ScreenReaderPacedMode
    - Create sample JSON data file(s) in `data/` for development/testing
    - _Requirements: 1.1, 3.1, 6.1, 7.1, 7.2, 7.3, 7.9, 12.1, 12.5_

  - [ ]* 17.2 Write integration tests
    - Test end-to-end flow: data load → loading screen → chart race → playback → detail panel
    - Test EventBus wiring between components
    - _Requirements: 1.1, 3.1, 6.1, 7.1_

- [ ] 18. Build and deploy configuration
  - [ ] 18.1 Configure Vite build and GitHub Actions
    - Configure `vite.config.ts` for static output build (`base` path for GitHub Pages)
    - Verify `npm run build` produces self-contained `dist/` directory
    - Create `.github/workflows/deploy.yml` GitHub Actions workflow: build on push to primary branch, deploy to GitHub Pages
    - _Requirements: 10.1, 10.3, 10.4_

  - [ ]* 18.2 Write build smoke tests
    - Verify build output exists and contains expected files (index.html, JS bundle, CSS)
    - Verify no framework dependencies in package.json
    - _Requirements: 10.1, 10.2, 10.3_

- [ ] 19. Final checkpoint — Full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at each major milestone
- Property tests validate the 18 correctness properties from the design document
- Unit tests cover specific examples, edge cases, and DOM behavior
- The tech stack is vanilla TypeScript + Vite + Vitest + fast-check throughout
