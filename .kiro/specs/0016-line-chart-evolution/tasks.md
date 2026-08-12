# Tasks: Line Chart Evolution

## Phase 0: Visual Prototype (static, no animation)

- [x] 0.1 Create a standalone prototype page (`/prototype.html`) with a single canvas rendering a static frame
- [x] 0.2 Render ~20–30 hardcoded lines with varying cumulative heights (raw points Y-axis)
- [x] 0.3 Demonstrate dimming/z-index system: recently active lines bright and on top, old ones faded behind
- [x] 0.4 Show a selected/highlighted line state: thicker, brighter, others at 20% opacity
- [x] 0.5 Render event dots on the highlighted line (different shapes for release, MV, live performance, win)
- [x] 0.6 Show hover state: line thickens slightly, tooltip with name + value appears
- [x] 0.7 Show a popover attached to an event dot with placeholder media embed
- [x] 0.8* Experiment with color palette, line thickness, dot sizes — iterate based on review

## Phase 1: Performance Foundation

- [x] 1.1 Create Web Worker infrastructure with typed message passing between main thread and worker
- [x] 1.2 Implement CanvasRenderer with 3-layer canvas system (background, foreground, highlight)
- [x] 1.3 Build spatial index for canvas hit detection (grid-based, 8px tolerance)
- [x] 1.4 Implement basic line drawing on canvas with polyline path rendering
- [x] 1.5 Add OffscreenCanvas support with fallback for browsers that don't support it
- [x] 1.6 Implement sparse change-point data structure for cumulative values
- [x] 1.7 Build lazy time-range loader (fetch ranges on demand, LRU eviction, ≤30MB budget)
- [x] 1.8* Set up performance benchmarks (measure frame time with 1K, 5K, 10K lines)

## Phase 2: Line Chart — Songs Mode

- [ ] 2.1 Implement cumulative value computation in worker (change-point based, sparse)
- [ ] 2.2 Implement visibility/dimming computation (7-day grace, linear fade to ceiling, filter multiplier)
- [ ] 2.3 Implement z-index draw ordering (recency primary, LTD points tie-break)
- [ ] 2.4 Build level-of-detail system (monthly/weekly/daily resolution based on zoom)
- [ ] 2.5 Implement viewport culling (only compute/draw visible time window)
- [ ] 2.6 Build animation loop with sliding time window (auto-scroll during playback)
- [ ] 2.7 Integrate playback controls (play/pause/speed/scrubber) with canvas line view
- [ ] 2.8 Implement time navigation: zoom presets (All/Decade/Year/Quarter/90d) and pan-on-drag
- [ ] 2.9 Wire up existing filters (generation, source) to line chart with visibility ceiling adjustment
- [ ] 2.10* Add pinch-to-zoom on touch devices

## Phase 3: Inline Interaction (replaces detail drawer)

- [ ] 3.1 Implement click-to-highlight: selected line thickens, others drop to 20% opacity
- [ ] 3.2 Render event dots on highlighted line (release, MV, live performance, chart win)
- [ ] 3.3 Build popover component for event dots (date, type, embedded YouTube/Apple Music)
- [ ] 3.4 Add search/autocomplete to find and highlight specific songs
- [ ] 3.5 Support multiple simultaneous highlights (compare mode)
- [ ] 3.6 Implement Escape/click-away to deselect
- [ ] 3.7 Remove old detail-panel.ts and drawer infrastructure
- [ ] 3.8 Remove old bar race renderer (chart-race-renderer.ts) and related DOM code

## Phase 4: Line Chart — Artists Mode

- [ ] 4.1 Implement aggregate cumulative computation per artist (sum all releases)
- [ ] 4.2 Wire artist mode toggle to use same canvas infrastructure with artist-level data
- [ ] 4.3 Implement artist filter override (all lines visible at 100% when specific artist selected)
- [ ] 4.4* Add artist logo rendering near line endpoint or on hover

## Phase 5: Episode Browser

- [ ] 5.1 Extract episode data from existing dailyValues (group by source + episode number + date)
- [ ] 5.2 Build virtualized scrollable episode list component
- [ ] 5.3 Implement show source tabs/filter with show logos
- [ ] 5.4 Build expandable episode cards (winner, top chart, embedded performances)
- [ ] 5.5 Link episode entries to performance videos from embeds data
- [ ] 5.6* Add episode deep-linking (URL encodes show + episode number)

## Phase 6: Polish

- [ ] 6.1 Refresh yearly view styling to match new design language
- [ ] 6.2 Add keyboard shortcuts (Space: play/pause, arrows: step, Escape: deselect, number keys: speed)
- [ ] 6.3 Encode view state in URL (view, filters, time window, highlighted lines)
- [ ] 6.4 Mobile touch gesture polish (swipe timeline, responsive layout)
- [ ] 6.5* Accessibility: screen reader announcements for line chart state changes
