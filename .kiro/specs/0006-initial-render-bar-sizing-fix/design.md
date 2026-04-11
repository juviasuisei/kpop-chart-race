# Initial Render Bar Sizing Fix — Bugfix Design

## Overview

On initial render, bars collapse to zero height and stack at `translateY(0px)` because `update()` is called synchronously after `mount()`, before the browser lays out the `.chart-race__bars` container. This means `clientHeight` is 0, producing a `barHeight` of 0. Additionally, tied entries can appear at different visual widths because the CSS `min-width: 2rem` and flex children (text content) can override the data-driven percentage width when the container is effectively zero-width.

The fix defers the initial `date:change` emission until after layout is complete (via `requestAnimationFrame`) and ensures `.chart-race__bar` width is absolute/not influenced by flex children.

## Glossary

- **Bug_Condition (C)**: The initial render frame where `update()` is called before the browser has laid out the bars container, causing `clientHeight === 0`
- **Property (P)**: Bars are correctly sized and positioned from the first visible frame, with tied entries at equal visual widths
- **Preservation**: All subsequent `update()` calls (after layout), zoom changes, bar clicks, playback, and resize behavior remain unchanged
- **`ChartRaceRenderer.update()`**: The method in `src/chart-race-renderer.ts` that computes bar height from `this.barsContainer.clientHeight / 10` and sets bar widths via `computeBarWidth`
- **`main()`**: The entry point in `src/main.ts` that emits the initial `date:change` synchronously after mounting components
- **`computeBarWidth()`**: Pure function in `src/utils.ts` returning `(cumulativeValue / maxCumulativeValue) * 100`

## Bug Details

### Bug Condition

The bug manifests when the application performs its initial render. The `mount()` call appends DOM elements to the container, but the browser has not yet performed layout. The immediately following `eventBus.emit("date:change", ...)` triggers `update()`, which reads `this.barsContainer.clientHeight` — returning 0 because no layout pass has occurred. Additionally, the `.chart-race__bar` element uses `display: flex` with no explicit width constraint beyond the percentage, so `min-width: 2rem` and text content can inflate the bar beyond its data-driven width when the container is narrow or zero-width.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { renderCall: RenderCallContext }
  OUTPUT: boolean

  RETURN input.renderCall.isFirstUpdateAfterMount === true
         AND input.renderCall.barsContainerClientHeight === 0
         OR (input.renderCall.isFirstUpdateAfterMount === true
             AND input.renderCall.barWidthInfluencedByContent === true)
END FUNCTION
```

### Examples

- Initial render with 10 entries at zoom level 10: `barHeight = 0 / 10 = 0`, all bars at `translateY(0px)` with `height: 0px` — expected: bars distributed vertically across the container
- Two entries with cumulative value 500 each (tied): one bar renders wider than the other due to longer artist name pushing flex content — expected: both bars at identical visual width
- Initial render with zoom "all": `barHeight = BAR_HEIGHT_ALL = 40` (unaffected by clientHeight) but bar widths still incorrect due to container not laid out — expected: correct widths from first frame
- Subsequent `update()` call after layout: `clientHeight` returns correct value, bars render properly — this is NOT the bug condition

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Subsequent `update()` calls during playback must continue to compute bar heights correctly using `clientHeight / 10` for zoom level 10
- Zoom level "all" must continue to use `BAR_HEIGHT_ALL` (40px) and enable vertical scrolling
- Entries with different cumulative values must continue to render at proportionally different widths
- Bar click must continue to pause playback and open the detail panel
- Window resize must continue to correctly recompute bar dimensions on the next `update()` call
- `computeBarWidth()` must remain a pure function returning `(cumulativeValue / maxCumulativeValue) * 100`

**Scope:**
All inputs that do NOT involve the first `update()` call before layout should be completely unaffected by this fix. This includes:
- All `update()` calls after the initial layout pass
- Zoom changes
- Bar click interactions
- Playback start/pause/resume
- Window resize events

## Hypothesized Root Cause

Based on the bug description, the most likely issues are:

1. **Synchronous emit after mount**: In `src/main.ts`, the line `eventBus.emit("date:change", dataStore.dates[0])` executes synchronously after `renderer.mount(app)`. The browser has not performed a layout pass between these two calls, so `clientHeight` is 0.

2. **CSS flex layout inflating bar width**: The `.chart-race__bar` rule uses `display: flex` with `min-width: 2rem`. When the percentage-based `width` style resolves to a small value (due to zero or near-zero container width), the flex children (logo, name, gen label) and `min-width` can push the rendered width beyond the intended data-driven percentage, causing tied entries to appear at different widths depending on text content length.

3. **No guard against zero clientHeight**: `ChartRaceRenderer.update()` does not check whether `clientHeight` is 0 before computing `barHeight`. It blindly divides by 10, producing 0.

## Correctness Properties

Property 1: Bug Condition — Bars correctly sized on initial render

_For any_ initial render where `mount()` has been called and the first `update()` is triggered, the fixed code SHALL ensure that `barsContainer.clientHeight` is non-zero before computing bar positions, resulting in bars with correct non-zero heights and proper vertical distribution from the first visible frame.

**Validates: Requirements 2.1, 2.3**

Property 2: Bug Condition — Tied entries render at equal width

_For any_ set of entries with equal cumulative values rendered in the same snapshot, the fixed code SHALL render those bars at the same visual width, determined purely by `computeBarWidth` percentage, unaffected by text content length or CSS minimum widths.

**Validates: Requirements 2.2**

Property 3: Preservation — Subsequent updates unaffected

_For any_ `update()` call that occurs after the initial layout pass (i.e., `isBugCondition` is false), the fixed code SHALL produce the same bar heights, positions, and widths as the original code, preserving all existing playback, zoom, click, and resize behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/main.ts`

**Function**: `main()`

**Specific Changes**:
1. **Defer initial date:change emission**: Wrap the initial `eventBus.emit("date:change", dataStore.dates[0])` in a `requestAnimationFrame` callback. This ensures the browser has performed at least one layout pass after `mount()` appends elements to the DOM, so `clientHeight` returns the actual container height.
   ```typescript
   if (dataStore.dates.length > 0) {
     requestAnimationFrame(() => {
       eventBus.emit("date:change", dataStore.dates[0]);
     });
   }
   ```

---

**File**: `src/style.css`

**Rule**: `.chart-race__bar`

**Specific Changes**:
2. **Prevent text content from inflating bar width**: Add `overflow: hidden` (already present) and change the width model so the bar's inline `width` style is treated as an absolute constraint rather than a minimum. Remove `min-width: 2rem` and add `flex-shrink: 0` to prevent flex layout from overriding the percentage width. Alternatively, set `max-width` equal to the inline width or use `width` with `!important`-free absolute positioning.

   The minimal fix: replace `min-width: 2rem` with `min-width: 0` (or remove it) so that the percentage width from `computeBarWidth` is the sole determinant of rendered width. The `overflow: hidden` already clips content that exceeds the bar.

---

**File**: `src/chart-race-renderer.ts` (optional defensive guard)

**Function**: `update()`

**Specific Changes**:
3. **Guard against zero clientHeight** (defense-in-depth): If `containerHeight` is 0 and zoom is 10, skip the update or schedule a retry. This prevents the collapsed state even if `requestAnimationFrame` timing is unreliable in edge cases.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that mount the renderer, call `update()` synchronously (simulating the current behavior), and assert bar dimensions. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **Zero clientHeight test**: Mount renderer, immediately call `update()` with a snapshot — assert `barHeight` is non-zero (will fail on unfixed code)
2. **Tied entries width test**: Mount renderer with two entries of equal cumulative value but different name lengths — assert both `.chart-race__bar` elements have identical `offsetWidth` (will fail on unfixed code)
3. **Bar position test**: Mount renderer, immediately call `update()` — assert bars are NOT all at `translateY(0px)` (will fail on unfixed code)
4. **Deferred emit test**: Verify that `date:change` is NOT emitted synchronously after mount in the fixed code (will fail on unfixed code)

**Expected Counterexamples**:
- `barHeight` computes to 0 because `clientHeight` is 0
- Bars with identical data render at different widths due to text content
- Possible causes: synchronous emit timing, CSS min-width override

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := mountAndUpdate_fixed(input)
  ASSERT result.barHeight > 0
  ASSERT result.bars ARE vertically distributed
  ASSERT tiedEntries HAVE equal rendered width
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT update_original(input) = update_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many snapshots with varying entry counts, cumulative values, and zoom levels
- It catches edge cases like single-entry snapshots, max-value entries, and zoom transitions
- It provides strong guarantees that post-layout behavior is unchanged

**Test Plan**: Observe behavior on UNFIXED code for post-layout updates, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Post-layout update preservation**: Verify that calling `update()` when `clientHeight > 0` produces correct bar heights and positions (same as original)
2. **Zoom change preservation**: Verify switching between zoom 10 and "all" continues to work correctly
3. **Bar click preservation**: Verify clicking a bar still emits `bar:click` and pauses playback
4. **computeBarWidth purity preservation**: Verify `computeBarWidth` returns identical results for all inputs

### Unit Tests

- Test that `requestAnimationFrame` is used to defer initial `date:change` emission
- Test that `update()` with a mocked `clientHeight > 0` produces correct `barHeight`
- Test that tied entries produce bars with identical computed width styles
- Test that removing `min-width: 2rem` does not break bars with very small percentages (they clip via overflow)

### Property-Based Tests

- Generate random `ChartSnapshot` instances with varying entry counts and cumulative values; verify bar heights and positions are correct when `clientHeight > 0`
- Generate random pairs of entries with equal cumulative values; verify rendered width styles are identical
- Generate random zoom levels and snapshots; verify preservation of existing behavior for post-layout updates

### Integration Tests

- Test full application startup flow: mount → requestAnimationFrame fires → bars render correctly
- Test that playback after initial render works identically to before the fix
- Test that resize during the deferred frame does not cause visual glitches
