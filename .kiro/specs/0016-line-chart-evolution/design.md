# Design: Line Chart Evolution

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Main Thread                           │
│                                                             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ Toolbar  │  │ FilterState  │  │  LineChartController  │ │
│  │ & Search │  │   Manager    │  │  (orchestrates views) │ │
│  └──────────┘  └──────────────┘  └───────────────────────┘ │
│                                           │                 │
│                    ┌──────────────────────┬┘                │
│                    ▼                      ▼                  │
│  ┌─────────────────────────┐  ┌────────────────────────┐   │
│  │   CanvasRenderer        │  │   InteractionLayer     │   │
│  │   (draws lines)         │  │   (hit detection,      │   │
│  │                         │  │    hover, click)       │   │
│  │   - Background canvas   │  └────────────────────────┘   │
│  │   - Foreground canvas   │                                │
│  │   - Highlight canvas    │                                │
│  └─────────────────────────┘                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
        │ postMessage                    ▲ postMessage
        ▼                                │
┌─────────────────────────────────────────────────────────────┐
│                        Web Worker                            │
│                                                             │
│  ┌────────────────────┐  ┌─────────────────────────────┐   │
│  │  ChartComputer     │  │  LineGeometryBuilder        │   │
│  │  (snapshots,       │  │  (converts ranks/values     │   │
│  │   rankings,        │  │   to pixel coordinates,     │   │
│  │   visibility)      │  │   level-of-detail,          │   │
│  └────────────────────┘  │   viewport culling)         │   │
│                          └─────────────────────────────────┘│
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  OffscreenCanvas Renderer (where supported)         │    │
│  │  (renders background/dim layer in worker)           │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Y-Axis: Raw Cumulative Points

The Y-axis represents raw cumulative points (not rank). Lines only go up over time. This means:
- The actual gap between artists/songs is visible (not just relative position)
- Top entries will be far above newcomers — this is intentional and represents reality
- The visibility/dimming system handles clutter at the bottom
- Zoom presets on Y-axis may be needed to focus on mid-tier competition (future consideration)

## Canvas Layer Architecture

Three stacked `<canvas>` elements (or OffscreenCanvas equivalents):

| Layer | Contents | Update Frequency |
|-------|----------|-----------------|
| **Background** | Lines at 0–50% opacity (dimming/inactive). Rendered as a static bitmap. | Only on filter change or time window scroll |
| **Foreground** | Active lines (>50% opacity, not selected). Animated. | Every animation frame |
| **Highlight** | Selected line(s) + event dots + popovers. | On selection change or dot hover |

This separation means the expensive background layer (potentially thousands of lines) only redraws when necessary, not every frame.

## Visibility & Z-Index System

### Visibility Computation

```typescript
interface LineVisibility {
  lineId: string;           // artistId or releaseKey
  opacity: number;          // 0.0 – 1.0
  zIndex: number;           // draw order (higher = on top)
  layer: "background" | "foreground" | "highlight";
  lastActivityDate: string; // YYYY-MM-DD
  lifetimePoints: number;   // cumulative total
}

function computeVisibility(
  lineId: string,
  currentDate: string,
  lastActivityDate: string,
  lifetimePoints: number,
  filterCount: number,       // number of active non-default filters
  isArtistFilterActive: boolean,
  isSelected: boolean,
): LineVisibility {
  if (isSelected) {
    return { opacity: 1.0, zIndex: Infinity, layer: "highlight", ... };
  }

  if (isArtistFilterActive) {
    // Artist filter override: always visible
    return { opacity: 1.0, zIndex: computeZIndex(...), layer: "foreground", ... };
  }

  const daysSinceActivity = dateDiffDays(lastActivityDate, currentDate);
  const ceiling = 28 * Math.pow(2, filterCount); // 28, 56, 112, ...
  const fadeStart = 7;

  let opacity: number;
  if (daysSinceActivity <= fadeStart) {
    opacity = 1.0;
  } else if (daysSinceActivity >= ceiling) {
    opacity = 0.0;
  } else {
    opacity = 1.0 - (daysSinceActivity - fadeStart) / (ceiling - fadeStart);
  }

  const layer = opacity > 0.5 ? "foreground" : "background";
  return { opacity, zIndex: computeZIndex(...), layer, ... };
}

function computeZIndex(daysSinceActivity: number, lifetimePoints: number): number {
  // Lower daysSinceActivity = higher z-index
  // Tie-break: higher lifetime points = higher z-index
  // Use a composite score: (MAX_DAYS - daysSinceActivity) * LARGE_MULTIPLIER + lifetimePoints
  return (36500 - daysSinceActivity) * 1_000_000_000 + lifetimePoints;
}
```

### Draw Order

Lines are sorted by `zIndex` ascending (lowest z drawn first = furthest back). Within a layer, all lines are drawn in z-index order. The three layers guarantee that no background line ever appears above a foreground line.

## Level-of-Detail (LOD)

| Zoom Level | X Resolution | Max Data Points per Line |
|------------|-------------|------------------------|
| All Time (30yr) | Quarterly | ~120 |
| Decade | Monthly | ~120 |
| Year | Weekly | ~52 |
| 90 days | Daily | 90 |

Default on load: most recent 90 days. Playing the animation resets to the beginning of all data and runs forward.

Downsampling strategy: For quarterly/monthly, take the cumulative value at end-of-period. For weekly, take the value at end-of-week. Since Y is raw cumulative (monotonically increasing), end-of-period values are always correct — no aliasing or misleading smoothing.

## Interaction Design

### Hit Detection

Since canvas has no built-in hit detection:
- Maintain a spatial index (grid-based) mapping pixel regions → line IDs
- Hit radius is device-aware: 8px on desktop (pointer: fine), 24–32px on touch devices
- On mousemove/touchmove, look up the nearest line within the tolerance
- **Single line within radius:** Show a hover tooltip with artist/song name + current cumulative value
- **Multiple lines within radius (cluster):** Show a disambiguation popup — a small floating list of candidate names near the tap/click point. User picks from the list to select.
- On click/tap (after disambiguation if needed), select that line → trigger highlight mode

### Highlight Mode (replaces detail drawer)

When a line is selected:
1. All other lines dim proportionally — each line's current opacity is multiplied by 0.2 (so 100% → 20%, 80% → 16%, 10% → 2%). This preserves the relative dimming hierarchy.
2. Selected line triples its base thickness on the highlight canvas
3. Event dots appear along the line at their date positions. One dot per date, using the highest-priority event type for the dot shape. Priority order: win > live performance > chart appearance > MV > release. The popover shows all events for that date regardless of which dot shape is displayed.
   - 👑 Chart win (crown icon, reuse existing SVGs)
   - 🎤 Live performance (small dot)
   - 📊 Chart appearance (tick mark)
   - 🎬 MV release (diamond)
   - 🎵 Album/single release (circle, filled)
4. Hovering a dot shows a popover with:
   - Event type + date
   - Embedded YouTube player (for MVs and live performances)
   - Apple Music link (for album releases)
5. Click elsewhere or press Escape to deselect

### Time Navigation

- **Playback controls** (reuse existing PlaybackController concept): play/pause, speed control
- **Scrubber**: draggable along X-axis to jump to any date
- **Zoom presets**: buttons for All/Decade/Year/Quarter/90d
- **Pan**: drag on chart area when paused to scroll through time
- **Pinch-to-zoom** on touch devices

## Episode Browser Design

Separate view, not integrated into the line chart.

### Layout by Orientation

**Landscape (desktop & mobile landscape):** Horizontal timeline scrolling left-to-right. Oldest episodes on the left, newest on the right. Starts scrolled all the way to the right (most recent).

```
← older                                              newer →
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ Ep   │ │ Ep   │ │ Ep   │ │ Ep   │ │ Ep   │ │ Ep   │ ◄ start here
│ 1281 │ │ 1282 │ │ 1283 │ │ 1284 │ │ 1285 │ │ 1286 │
│ Inki │ │ M CD │ │ Chmp │ │ Inki │ │ Inki │ │ Inki │
└──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘
```

**Portrait (mobile portrait):** Vertical scroll, reverse chronological (newest at top, oldest at bottom). Starts at top (most recent).

```
┌─────────────────────────────────────────────┐
│ Episode 1286 — Oct 12, 2025  [Inkigayo]     │ ◄ start here
│ ┌─────────────────────────────────────────┐ │
│ │  🏆 Winner: aespa — Rich Man            │ │
│ │  1. aespa — Rich Man (4605)      ▶️     │ │
│ │  2. ...                                  │ │
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ Episode 1285 — Sep 28, 2025  [Inkigayo]     │
│ ┌─────────────────────────────────────────┐ │
│ ┌─────────────────────────────────────────┐ │
│ │  🏆 Winner: ...                          │ │
│ │  ...                                     │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

- Infinite-scroll / virtualized list (only render visible episodes)
- Each episode is collapsible (shows winner + top 3 by default, expand for full chart)
- Winner displays the appropriate crown SVG (matching their cumulative win count level)
- Live performance videos collapsed by default, expandable inline
- Filter by show source (tabs or dropdown)
- Clicking artist name → artist drawer; clicking song name → song drawer

## Data Flow for Line Chart

```
[DataStore] 
    → Worker: computeLineData(dates, artists/releases, filters)
    → Returns: Map<lineId, { cumulativeValues: SparseTimeSeries, lastActivity: string, ltdPoints: number }>
    
[On each animation frame]
    → Worker: computeVisibleFrame(currentDate, viewport, visibilityParams)
    → Returns: { background: DrawCommand[], foreground: DrawCommand[], zOrder: string[] }
    
[Main thread CanvasRenderer]
    → Draws background layer (if dirty)
    → Draws foreground layer (every frame during animation)
    → Draws highlight layer (if selection active)
```

### Memory & Lazy Loading Strategy

**Problem:** 10K songs × 11K dates (30 years daily) × 4 bytes = ~440MB if stored densely. Not feasible on mobile.

**Solution: Sparse storage + lazy time-range loading.**

1. **Sparse representation:** A song only has data on dates it actually appeared on a chart (typically 5–30 days per promotion cycle). Store as sorted arrays of `{ date, cumulativeValue }` change-points. Between change-points the value is constant (flat line). For 10K songs averaging 20 data points each, that's ~200K entries — trivial.

2. **Lazy time-range loading:** Data is partitioned by time range (e.g., by year or quarter). On initial load, only fetch the most recent time window. As the user scrolls/pans backward or selects "All Time", fetch older ranges on demand.

   ```
   /data/ranges/2025-Q3.json   ← loaded by default (most recent)
   /data/ranges/2025-Q2.json   ← fetched when user pans back
   /data/ranges/2024.json      ← fetched on demand
   /data/ranges/2020-2023.json ← aggregated older data
   /data/ranges/pre-2020.json  ← aggregated oldest data
   ```

3. **Progressive detail:** Distant time ranges can be pre-aggregated (weekly/monthly points) to keep payloads small. When the user zooms into a specific older period, fetch the full daily resolution for just that range.

4. **Memory budget:** Target ≤30MB on mobile for the active working set. Evict older ranges from memory when not in the current viewport (LRU cache with configurable limit).

**Optimization:** Store cumulative values as change-points (date + value pairs). A song that holds steady for 200 days stores one entry, not 200. The renderer interpolates flat lines between change-points.

## Migration Plan

The old bar race views are not maintained during development. We build the new line chart system directly, replacing the old renderer. The existing yearly bar chart view stays as-is until Phase 6 polish.

### Phase 0: Visual Prototype
- Static HTML page with a single canvas frame
- Hardcoded data (~20–30 lines) to demonstrate the visual language
- Shows: dimming, z-ordering, highlight state, event dots, hover tooltip, popover
- Purpose: review and iterate on visual design before building the real system
- No animation, no Workers, no data loading

### Phase 1: Performance Foundation
- Web Worker infrastructure (message passing, typed transfers)
- Canvas renderer skeleton (3-layer system)
- Sparse change-point data structure
- Lazy time-range loader with LRU eviction (≤30MB mobile budget)
- Spatial index for hit detection
- Basic line drawing with static data

### Phase 2: Line Chart — Songs Mode
- Cumulative value computation in worker (sparse change-points)
- Visibility/dimming system
- Z-index draw ordering
- Animation loop with sliding time window
- LOD system
- Playback controls integration
- Time navigation (zoom presets, pan)

### Phase 3: Inline Interaction
- Click-to-highlight (replaces detail drawer)
- Event dot overlay on selected line
- Popover with embedded media
- Search/pick to highlight
- Remove old detail panel and bar race renderer

### Phase 4: Line Chart — Artists Mode  
- Aggregate cumulative computation per artist
- Same infrastructure, different data pipeline
- Artist filter override for visibility

### Phase 5: Episode Browser
- Episode data extraction from existing dailyValues
- Virtualized list component
- Show source tabs
- Expandable episode cards with embedded media

### Phase 6: Polish
- Yearly view visual refresh
- Keyboard shortcuts
- Touch gestures (pinch-to-zoom, swipe-to-pan)
- URL state encoding
- Accessibility

## File Structure (New/Modified)

```
src/
  worker/
    chart-worker.ts          # Web Worker entry point
    line-data-computer.ts    # Rank computation, visibility, z-index
    geometry-builder.ts      # Pixel coordinate generation, LOD, culling
  canvas/
    canvas-renderer.ts       # 3-layer canvas manager
    line-drawer.ts           # Actual line path drawing
    interaction-layer.ts     # Hit detection, hover, click
    spatial-index.ts         # Grid-based spatial lookup
    event-dots.ts            # Dot overlay for highlight mode
    popover.ts               # Event detail popover
  views/
    line-chart-controller.ts # Orchestrates Songs/Artists line views
    episode-browser.ts       # Episode archive view
  # Existing files modified:
  main.ts                    # Rewired to use LineChartController
  toolbar.ts                 # New view options, search input
  filter-state-manager.ts    # New filter types (highlight, time window)
  types.ts                   # Extended FilterState, new LineVisibility type
  playback-controller.ts     # Adapted for canvas-based views
```
