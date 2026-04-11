# Bar Click Interaction Bugfix Design

## Overview

Clicking or tapping bars in the chart race visualization does nothing. The `ChartRaceRenderer` creates bar DOM elements but never attaches click event listeners and has no reference to the `EventBus`, so `bar:click` events are never emitted. The fix adds an `EventBus` constructor parameter to `ChartRaceRenderer`, attaches click listeners to each bar wrapper in `createBarElement()`, emits `bar:click` with the `artistId` on click, and cleans up listeners in `destroy()`. The existing `bar:click` handler in `main.ts` is already wired correctly and will work once events are emitted.

## Glossary

- **Bug_Condition (C)**: The user clicks/taps a bar wrapper element in the chart race — no `bar:click` event is emitted
- **Property (P)**: When a bar is clicked, a `bar:click` event with the correct `artistId` is emitted via the EventBus
- **Preservation**: All existing rendering, animation, playback wiring, and non-click event handling must remain unchanged
- **ChartRaceRenderer**: The class in `src/chart-race-renderer.ts` that owns the visualization DOM subtree (bars, legend, date display)
- **EventBus**: The typed pub/sub system in `src/event-bus.ts` used for decoupled component communication
- **bar:click**: An event defined in `EventMap` that carries an `artistId: string` payload

## Bug Details

### Bug Condition

The bug manifests when a user clicks or taps any bar element in the chart race visualization. `ChartRaceRenderer` does not accept an `EventBus` instance and does not attach click event listeners to bar wrapper elements, so there is no mechanism to emit `bar:click` events.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type UserInteraction
  OUTPUT: boolean

  RETURN input.eventType = "click"
         AND input.target IS a .chart-race__bar-wrapper element
         AND renderer HAS NO click listener on that element
         AND renderer HAS NO eventBus reference
END FUNCTION
```

### Examples

- User clicks bar for "Luna Park" while paused → Expected: Detail_Panel opens for Luna Park. Actual: Nothing happens.
- User taps bar for "Jay Storm" during playback → Expected: Playback pauses, Detail_Panel opens for Jay Storm. Actual: Nothing happens.
- User clicks bar for "Artist C" after zoom change → Expected: `bar:click` emitted with `artist-c`. Actual: No event emitted.
- User clicks the legend or date display (not a bar) → Expected: Nothing happens. Actual: Nothing happens (correct, unchanged).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Bar rendering: artist name, logo, generation numeral, type indicator, cumulative value, and featured release display correctly
- Bar animation: position transitions via `translateY`, width percentages, and numeric value tweening continue to work
- Legend rendering: 5 artist type entries with correct colors and indicators
- `destroy()` continues to cancel pending animation frames and remove the DOM subtree
- `mount()` continues to create `.chart-race`, `.chart-race__date`, `.chart-race__bars`, and legend elements
- Zoom level handling: `overflowY` toggling for "all" vs top-10 zoom
- Existing `bar:click` handler in `main.ts` (freeze-then-resolve logic) remains unchanged
- `pause` → auto-open Detail_Panel for top-ranked artist remains unchanged
- `play` → auto-close Detail_Panel remains unchanged

**Scope:**
All inputs that do NOT involve clicking a bar wrapper element should be completely unaffected by this fix. This includes:
- Mouse clicks on legend items, date display, or other non-bar elements
- All keyboard interactions
- Playback control interactions (play/pause buttons, scrubber)
- Zoom selector interactions
- `date:change`, `state:updated`, `zoom:change`, `pause`, `play` event flows

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is clear:

1. **No EventBus reference**: `ChartRaceRenderer` constructor takes no parameters. It has no way to emit events. The class needs an `EventBus` parameter stored as a private field.

2. **No click listeners on bar wrappers**: `createBarElement()` builds the DOM structure (wrapper → bar, valueSpan, releaseSpan) but never calls `addEventListener('click', ...)` on the wrapper element.

3. **No listener cleanup**: `destroy()` cancels animation frames and removes DOM nodes but has no click listeners to clean up (because none were attached).

4. **Missing EventBus in `main.ts` instantiation**: `main.ts` creates `new ChartRaceRenderer()` without passing the `eventBus`, so even after adding the parameter, the call site must be updated.

## Correctness Properties

Property 1: Bug Condition - Bar Click Emits bar:click Event

_For any_ bar wrapper element rendered by `ChartRaceRenderer` that is clicked, the fixed renderer SHALL emit a `bar:click` event via the EventBus with the correct `artistId` corresponding to that bar.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Non-Click Rendering Behavior Unchanged

_For any_ interaction that is NOT a click on a bar wrapper element, the fixed `ChartRaceRenderer` SHALL produce exactly the same DOM output, animations, and behavior as the original unfixed version, preserving all existing rendering, animation, and lifecycle functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/chart-race-renderer.ts`

**Class**: `ChartRaceRenderer`

**Specific Changes**:
1. **Add EventBus import**: Import `EventBus` from `./event-bus.ts`
2. **Add constructor parameter**: Accept `EventBus` as a constructor parameter and store it as `private eventBus: EventBus`
3. **Attach click listener in `createBarElement()`**: Add `wrapper.addEventListener('click', ...)` that calls `this.eventBus.emit('bar:click', entry.artistId)`. Store the listener reference for cleanup.
4. **Clean up listeners in `destroy()`**: Remove click event listeners from all bar wrappers before removing DOM nodes. Track listeners via a `Map<string, () => void>` or store on the `BarElement` interface.
5. **Update `BarElement` interface**: Add an optional `clickHandler` field to store the bound listener for removal.

**File**: `src/main.ts`

**Specific Changes**:
1. **Pass EventBus to renderer**: Change `new ChartRaceRenderer()` to `new ChartRaceRenderer(eventBus)`

**File**: `tests/unit/chart-race-renderer.test.ts`

**Specific Changes**:
1. **Import EventBus**: Add import for `EventBus`
2. **Update constructor calls**: Change all `new ChartRaceRenderer()` to `new ChartRaceRenderer(eventBus)` with a test EventBus instance
3. **Add click event tests**: New tests verifying that clicking a bar wrapper emits `bar:click` with the correct `artistId`

**File**: `tests/unit/integration.test.ts`

**Specific Changes**:
1. **Update constructor calls**: Change `new ChartRaceRenderer()` to `new ChartRaceRenderer(eventBus)` (EventBus already imported)

**File**: `tests/unit/responsive.test.ts`

**Specific Changes**:
1. **Import EventBus** (already imported in file)
2. **Update constructor call**: Change `new ChartRaceRenderer()` to `new ChartRaceRenderer(new EventBus())`

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test Plan**: Write tests that create a `ChartRaceRenderer`, render bars, simulate click events on bar wrappers, and assert that `bar:click` events are emitted. Run on UNFIXED code to observe failures.

**Test Cases**:
1. **Single bar click**: Render one bar, click its wrapper, assert `bar:click` emitted with correct `artistId` (will fail on unfixed code)
2. **Multiple bars click**: Render multiple bars, click each, assert correct `artistId` per bar (will fail on unfixed code)
3. **Click after re-render**: Update snapshot, click bar, assert event still emitted (will fail on unfixed code)

**Expected Counterexamples**:
- No `bar:click` event is emitted because no click listener exists on bar wrappers
- Root cause confirmed: `ChartRaceRenderer` has no `EventBus` reference and no `addEventListener` calls

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed renderer emits `bar:click` with the correct `artistId`.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := ChartRaceRenderer_fixed.handleClick(input)
  ASSERT eventBus.lastEmitted("bar:click") = input.artistId
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed renderer produces the same DOM output and behavior as the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT ChartRaceRenderer_original(input) = ChartRaceRenderer_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many snapshot/zoom combinations automatically
- It catches edge cases in bar rendering that manual tests might miss
- It provides strong guarantees that DOM output is unchanged for non-click interactions

**Test Plan**: Run existing renderer tests on fixed code to verify all pass unchanged. Write property-based tests generating random snapshots and verifying DOM structure matches.

**Test Cases**:
1. **Mount structure preservation**: Verify `.chart-race`, `.chart-race__date`, `.chart-race__bars`, legend all created identically
2. **Bar rendering preservation**: Verify artist name, logo, generation, type indicator, value, release all render correctly
3. **Animation preservation**: Verify `translateY` positioning and width percentages unchanged
4. **Destroy preservation**: Verify DOM cleanup and animation frame cancellation still works
5. **Zoom handling preservation**: Verify `overflowY` toggling for "all" vs top-10

### Unit Tests

- Test that clicking a bar wrapper emits `bar:click` with the correct `artistId`
- Test that clicking different bars emits the correct `artistId` for each
- Test that `destroy()` removes click listeners (no events emitted after destroy)
- Test that all existing renderer tests pass with the new constructor signature

### Property-Based Tests

- Generate random `ChartSnapshot` entries and verify each rendered bar emits `bar:click` with the matching `artistId` on click
- Generate random snapshots and verify DOM structure (bar count, class names, text content) matches expected output identically to unfixed behavior for non-click scenarios

### Integration Tests

- Test full flow: render bars → click bar → verify `bar:click` event → verify Detail_Panel opens
- Test freeze-then-resolve: playback playing → click bar → verify pause + Detail_Panel open
- Test that existing integration tests pass with updated constructor calls
