# Design Document: Chart Display Improvements

## Overview

This design covers four targeted improvements to the K-Pop Chart Race display layer (v0.8.0 → v0.9.0):

1. **Chart win deduplication** — prevent an artist with multiple releases on the same (date, source) from receiving duplicate chart wins by pre-filtering to the highest-value release per artist before winner determination.
2. **365-day activity filter** — in the top-10 zoom view, exclude artists (except rank 1) who have no `DailyValueEntry` in the 365 days preceding the snapshot date, keeping the focused view relevant.
3. **Rank badge** — display a `#N` badge before each bar's logo so viewers can instantly identify chart positions.
4. **Logo hiding in "all" zoom** — hide logo images when viewing all artists to prevent visual clipping on small bars.

All changes are additive or modify existing pure functions and DOM helpers. No new external dependencies are required.

## Architecture

The changes touch three layers of the existing architecture:

```mermaid
graph TD
    A[chart-engine.ts] -->|computeChartWins fix| B[DataStore.chartWins]
    C[utils.ts] -->|new filterByActivity| D[Filtered RankedEntry[]]
    E[chart-race-renderer.ts] -->|rank badge + logo toggle| F[DOM bars]
    G[style.css] -->|.bar__rank, .bar__logo--hidden| F
```

1. **chart-engine.ts** — `computeChartWins` gets a deduplication pre-processing step.
2. **utils.ts** — new `filterByActivity(entries, snapshotDate, dataStore, zoomLevel)` function wraps `filterByZoom` and adds the 365-day activity check for zoom 10.
3. **chart-race-renderer.ts** — `createBarElement` adds a rank badge span; `updateBarElement` updates rank text; `update()` toggles a CSS class on logos based on zoom level.
4. **style.css** — new `.bar__rank` and `.bar__logo--hidden` rules.

No changes to `models.ts`, `types.ts`, `data-loader.ts`, or `main.ts` are required beyond calling `filterByActivity` instead of `filterByZoom` in the renderer.

## Components and Interfaces

### 1. Chart Win Deduplication (`chart-engine.ts`)

Inside `computeChartWins`, before finding the max value per (date, source), add a deduplication step:

```typescript
// For each source's entries, keep only the highest-value release per artist
function deduplicateByArtist(
  entries: { artistId: string; releaseId: string; value: number }[]
): { artistId: string; releaseId: string; value: number }[] {
  const bestByArtist = new Map<string, { artistId: string; releaseId: string; value: number }>();
  for (const entry of entries) {
    const existing = bestByArtist.get(entry.artistId);
    if (!existing || entry.value > existing.value) {
      bestByArtist.set(entry.artistId, entry);
    }
    // Ties: first encountered wins (iteration order), so no change needed
  }
  return Array.from(bestByArtist.values());
}
```

This is called per source before the max-value winner determination. The crown level increment uses only the selected release per winning artist.

### 2. Activity Filter (`utils.ts`)

```typescript
export function filterByActivity(
  entries: RankedEntry[],
  snapshotDate: string,
  dataStore: DataStore,
  zoomLevel: ZoomLevel,
): RankedEntry[] {
  const base = filterByZoom(entries, zoomLevel);
  if (zoomLevel !== 10) return base;

  const cutoff = dateMinus365(snapshotDate); // YYYY-MM-DD string 365 days before

  return base.filter((entry, index) => {
    if (index === 0) return true; // rank 1 always included
    return hasRecentActivity(entry.artistId, cutoff, snapshotDate, dataStore);
  });
}
```

`hasRecentActivity` scans the artist's releases for any `dailyValues` key `d` where `cutoff <= d <= snapshotDate`.

`dateMinus365` computes the date string 365 days before the snapshot using `Date` arithmetic.

### 3. Rank Badge (`chart-race-renderer.ts`)

In `BarElement` interface, add `rankSpan: HTMLSpanElement`.

In `createBarElement`:
```typescript
const rankSpan = document.createElement("span");
rankSpan.className = "bar__rank";
rankSpan.textContent = `#${entry.rank}`;
bar.insertBefore(rankSpan, logo); // before logo
```

In `updateBarElement`:
```typescript
barEl.rankSpan.textContent = `#${entry.rank}`;
```

### 4. Logo Visibility Toggle (`chart-race-renderer.ts`)

In `update()`, after processing entries, toggle the CSS class:

```typescript
for (const [artistId, barEl] of this.bars) {
  if (visibleIds.has(artistId)) {
    barEl.logo.classList.toggle("bar__logo--hidden", zoomLevel === "all");
  }
}
```

### 5. CSS Additions (`style.css`)

```css
.bar__rank {
  font-size: 0.75rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  flex-shrink: 0;
  min-width: 1.5em;
  text-align: center;
}

.bar__logo--hidden {
  display: none;
}
```

Mobile responsive override for `.bar__rank` font-size at `< 768px`.

## Data Models

No new data models are introduced. Existing interfaces are extended minimally:

- `BarElement` (internal to `chart-race-renderer.ts`) gains a `rankSpan: HTMLSpanElement` field.
- `filterByActivity` accepts the existing `DataStore` and `RankedEntry[]` types.
- `computeChartWins` internal logic changes but its return type `Map<string, Map<string, { artistIds: string[]; crownLevels: Map<string, number> }>>` remains unchanged.


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Chart Win Deduplication and Crown Correctness

*For any* set of artists where one or more artists have multiple releases with `DailyValueEntry` records on the same (date, source) pair, `computeChartWins` SHALL produce winner sets where each artist is represented by at most one release (the highest-value one), and crown level increments SHALL apply only to that selected release. Non-selected releases SHALL have no crown increments for that (date, source).

**Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6**

### Property 2: Activity Filter Correctness at Zoom 10

*For any* ranked entry list, snapshot date, and data store, when `filterByActivity` is called with zoom level 10, the result SHALL always include the rank-1 entry, and SHALL include entries ranked 2+ only if the corresponding artist has at least one `DailyValueEntry` key `d` where `dateMinus365(snapshotDate) <= d <= snapshotDate`.

**Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6**

### Property 3: Activity Filter Is Identity at Zoom "all"

*For any* ranked entry list, snapshot date, and data store, when `filterByActivity` is called with zoom level `"all"`, the result SHALL equal the input list unchanged.

**Validates: Requirements 2.4**

### Property 4: Rank Badge Reflects Entry Rank

*For any* `RankedEntry` with rank N, the bar element's rank badge span SHALL contain the text `#N`, and this text SHALL update when the entry's rank changes on subsequent snapshots.

**Validates: Requirements 3.1, 3.2**

### Property 5: Logo Visibility Matches Zoom Level

*For any* set of bar elements rendered at a given zoom level, each bar's logo element SHALL have the `bar__logo--hidden` CSS class present if and only if the zoom level is `"all"`.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

## Error Handling

- **`filterByActivity` with empty entries**: Returns an empty array. No special handling needed.
- **`filterByActivity` with missing artist in dataStore**: If an artist ID from a `RankedEntry` is not found in `dataStore.artists`, treat them as having no recent activity (exclude from zoom 10 unless rank 1).
- **`dateMinus365` edge cases**: Uses `Date` arithmetic which handles leap years correctly. The function produces a valid YYYY-MM-DD string for any valid input date.
- **`computeChartWins` with no releases on a date**: The existing loop simply skips dates with no `DailyValueEntry` records. The dedup step operates on an already-filtered list, so empty inputs produce empty outputs.
- **Rank badge with rank 0**: Should not occur since ranks are 1-based after `computeSnapshot`, but if it did, displays `#0`. No crash.

## Testing Strategy

### Property-Based Tests (fast-check, minimum 100 iterations each)

Using the existing `fast-check` + `vitest` setup (`@fast-check/vitest`).

| Property | Target Function | File |
|---|---|---|
| Property 1: Dedup + Crown | `computeChartWins` | `tests/property/chart-engine.property.test.ts` |
| Property 2: Activity Filter (zoom 10) | `filterByActivity` | `tests/property/chart-engine.property.test.ts` |
| Property 3: Activity Filter (zoom all) | `filterByActivity` | `tests/property/chart-engine.property.test.ts` |
| Property 4: Rank Badge | `createBarElement` / `updateBarElement` | `tests/property/renderer.property.test.ts` |
| Property 5: Logo Visibility | `update()` | `tests/property/renderer.property.test.ts` |

Each property test tagged with: `Feature: 0014-chart-display-improvements, Property N: <title>`

### Unit Tests (example-based)

- Tie-breaking in dedup (first release encountered wins) — Req 1.3
- `dateMinus365` with leap year boundary
- Rank badge CSS class is `bar__rank` — Req 3.3
- Logo toggle uses CSS class not `style.display` — Req 4.5
- Zoom transitions (10 → all, all → 10) — Req 4.3, 4.4

### Integration Checkpoint

- Full playback with real data files, verify no console errors
- Visual check: rank badges visible, logos hidden in "all" zoom
- Version badge shows `v0.9.0`
