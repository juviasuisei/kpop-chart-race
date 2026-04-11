# Design Document: Display Behavior Enhancements

## Overview

Three targeted changes to improve the initial user experience of the K-Pop Chart Race application:

1. Filter zero-value artists from chart snapshots so only artists with earned points appear.
2. Start the app paused at the latest date instead of the first, showing current rankings immediately.
3. Ensure bar height is always `containerHeight / 10` at zoom 10, regardless of visible entry count.

All changes are small, localized edits to existing modules with no new files or architectural shifts.

## Architecture

No architectural changes. The existing event-driven pipeline remains:

```
main.ts → date:change → chart-engine.ts (computeSnapshot) → state:updated → chart-race-renderer.ts (update)
                                                                           → playback-controller.ts
```

Changes touch three modules:

| Module | Change |
|---|---|
| `src/chart-engine.ts` | Filter `cumulativeValue === 0` entries before rank assignment in `computeSnapshot` |
| `src/main.ts` | Emit last date instead of first on initial render |
| `src/playback-controller.ts` | Initialize scrubber at end; reset to index 0 on play when at last date |

## Components and Interfaces

### chart-engine.ts — `computeSnapshot`

Current behavior: builds entries for all artists, sorts, assigns ranks 1..N.

New behavior: after building the unsorted array, filter out entries where `cumulativeValue === 0`, then sort and assign ranks. This is a single `.filter()` call inserted before the sort.

```typescript
// Insert before the sort:
const nonZero = unsorted.filter(e => e.cumulativeValue > 0);
// Then sort and rank nonZero instead of unsorted
```

The `previousMap` lookup still uses all artists (including those previously zero) so that `previousCumulativeValue` and `previousRank` are correctly populated when an artist transitions from 0 to non-zero.

### main.ts — Initial date emission

Current: `eventBus.emit("date:change", dataStore.dates[0])`
New: `eventBus.emit("date:change", dataStore.dates[dataStore.dates.length - 1])`

### playback-controller.ts — Initial state and play-from-end behavior

1. In `mount()`, set `this.currentIndex = this.dates.length - 1` and update scrubber value/label to match.
2. In `play()`, add a check: if `this.currentIndex >= this.dates.length - 1`, reset to 0, update scrubber/label, and emit `date:change` for `this.dates[0]` before starting the interval.

### chart-race-renderer.ts — Bar height verification

The existing code already computes `barHeight = containerHeight / 10` when `zoomLevel === 10`. It divides by the constant 10, not by `visibleEntries.length`. No change needed — the behavior is already correct.

## Data Models

No changes to data models. `ChartSnapshot`, `RankedEntry`, `DataStore`, and all other types remain unchanged. The only difference is that `ChartSnapshot.entries` will contain fewer items (zero-value artists excluded).


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Zero-value exclusion invariant

*For any* DataStore and any date in the sorted dates array, the ChartSnapshot produced by `computeSnapshot` SHALL contain only entries where `cumulativeValue > 0`, and ranks SHALL form a contiguous sequence `[1, 2, ..., entries.length]`.

**Validates: Requirements 1.1, 1.2, 1.3, 1.5**

### Property 2: Bar height independence from entry count at zoom 10

*For any* ChartSnapshot with 1 to 10 entries and any positive containerHeight, when the renderer updates at zoom level 10, every bar wrapper SHALL have height equal to `containerHeight / 10`.

**Validates: Requirements 3.1, 3.2, 3.4**

## Error Handling

| Scenario | Handling |
|---|---|
| All artists have zero cumulative value | `computeSnapshot` returns `{ date, entries: [] }`. Renderer shows no bars. No crash. |
| Empty dates array | Existing guard in `main.ts` (`if (dataStore.dates.length > 0)`) prevents emission. No change needed. |
| Play pressed when already at last date | `play()` resets index to 0 and emits `date:change` for first date before starting interval. |
| containerHeight is 0 (pre-layout) | Existing fallback: `containerHeight > 0 ? containerHeight / 10 : 50`. No change needed. |

## Testing Strategy

### Property-Based Tests (fast-check, minimum 100 iterations)

Two new property tests in `tests/property/`:

1. **Property 1** — Generate random DataStores (2-8 artists, 1-5 dates, random daily values including zeros), compute snapshots, assert every entry has `cumulativeValue > 0` and ranks are `[1..N]`.
2. **Property 2** — Generate random snapshots with 1-10 entries, mock `containerHeight` to a random positive value, call `renderer.update()` at zoom 10, assert all bar wrapper heights equal `containerHeight / 10`.

Each test tagged with: `Feature: 0010-display-behavior-enhancements, Property N: <title>`

### Unit Tests

- **Start at last date**: Verify `main.ts` emits `dates[dates.length - 1]` on initial render.
- **Playback controller initialization**: Verify scrubber starts at last index, label shows last date, state is paused.
- **Play from end resets**: Verify pressing play when at last date resets index to 0, emits `date:change` for first date, then starts interval.
- **Bar height at zoom "all"**: Already covered by existing tests (40px fixed height).

### Existing Test Coverage

The existing property tests for ranking order (Property 6), stable sort (Property 7), and renderer bar sizing (Bugfix 0006) continue to apply. The zero-value filter is additive — it reduces the entry set but doesn't change the sort/rank logic for remaining entries.
