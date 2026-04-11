# Click Interaction Fix — Bugfix Design

## Overview

Two interaction bugs affect the chart race UI. First, clicking empty space in the chart area does not close the detail panel — users must use the close button, Escape key, or wait for playback to start. Second, `.chart-race__bar-wrapper` elements lack a pointer cursor, providing no visual affordance that they are clickable. The fix adds a click listener on the `.chart-race` wrapper that closes the panel when the click target is outside any bar wrapper, and adds `cursor: pointer` to bar wrappers in CSS.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — when the detail panel is open and the user clicks on empty space in the chart area (outside any `.chart-race__bar-wrapper`), the panel does not close; and when hovering over a bar wrapper, no pointer cursor is shown.
- **Property (P)**: The desired behavior — clicking empty space while the panel is open should close it; bar wrappers should show a pointer cursor on hover.
- **Preservation**: Existing bar-click behavior (opening the detail panel), Escape key dismissal, close button dismissal, and playback-triggered dismissal must remain unchanged.
- **`.chart-race`**: The top-level wrapper `<div>` created by `ChartRaceRenderer.mount()` in `src/chart-race-renderer.ts`.
- **`.chart-race__bar-wrapper`**: The per-artist row element that emits `bar:click` via the event bus when clicked.
- **`DetailPanel`**: The class in `src/detail-panel.ts` that manages the artist detail sidebar/overlay.
- **`EventBus`**: The typed pub/sub system in `src/event-bus.ts` used for decoupled component communication.

## Bug Details

### Bug Condition

The bug manifests in two ways: (1) when the detail panel is open and the user clicks on empty space in the chart area, the panel stays open because no listener handles clicks outside bar wrappers; (2) when the user hovers over a bar wrapper, the default cursor is shown instead of a pointer because the CSS rule is missing.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { event: MouseEvent, panelOpen: boolean }
  OUTPUT: boolean

  // Bug 1: click-to-dismiss missing
  IF input.event.type == 'click'
     AND input.event.target IS inside '.chart-race' element
     AND input.event.target IS NOT inside any '.chart-race__bar-wrapper'
     AND input.panelOpen == true
  THEN RETURN true

  // Bug 2: missing pointer cursor (always present for bar wrappers)
  IF input.event.type == 'hover'
     AND input.event.target IS '.chart-race__bar-wrapper'
  THEN RETURN true

  RETURN false
END FUNCTION
```

### Examples

- User clicks on the `.chart-race__bars` background while the detail panel is open → **Expected**: panel closes. **Actual**: panel stays open.
- User clicks on the `.chart-race__date` area while the detail panel is open → **Expected**: panel closes. **Actual**: panel stays open.
- User clicks on the `.chart-race__legend` area while the detail panel is open → **Expected**: panel closes. **Actual**: panel stays open.
- User hovers over a `.chart-race__bar-wrapper` → **Expected**: pointer cursor. **Actual**: default cursor.
- User clicks empty space when the panel is NOT open → **Expected**: nothing happens (no error). **Actual**: nothing happens (correct, must be preserved).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Clicking a `.chart-race__bar-wrapper` must continue to pause playback (if playing) and open the detail panel for that artist.
- Pressing Escape while the detail panel is open must continue to close it.
- Clicking the detail panel's close button must continue to close it.
- Starting playback while the detail panel is open must continue to close it automatically.
- Clicking empty space when the panel is not open must continue to do nothing (no errors, no side effects).

**Scope:**
All inputs that do NOT involve clicking empty chart space while the panel is open, or hovering over bar wrappers, should be completely unaffected by this fix. This includes:
- Clicks on bar wrappers (existing `bar:click` flow)
- Keyboard interactions (Escape, Tab focus trap)
- Playback controls (play/pause buttons, scrubber)
- Zoom selector interactions

## Hypothesized Root Cause

Based on the bug description and code analysis, the issues are:

1. **Missing click-outside listener**: `main.ts` wires `bar:click` events to open the detail panel and `play` events to close it, but there is no listener on the `.chart-race` wrapper element to detect clicks outside bar wrappers. The `ChartRaceRenderer` only attaches click handlers to individual `.chart-race__bar-wrapper` elements (in `createBarElement`), so clicks on the container background are unhandled.

2. **Missing CSS cursor rule**: `src/style.css` defines `.chart-race__bar-wrapper` with positioning and layout styles but does not include `cursor: pointer`, so the browser renders the default cursor on hover.

3. **No architectural gap**: The `EventBus` already has a `panel:close` event and `DetailPanel` already exposes `isOpen()` and `close()` methods. The infrastructure to support click-to-dismiss exists — it just needs to be wired up.

## Correctness Properties

Property 1: Bug Condition — Click Outside Closes Panel

_For any_ click event on the `.chart-race` wrapper where the click target is NOT inside a `.chart-race__bar-wrapper` and the detail panel is currently open, the click handler SHALL close the detail panel by calling `detailPanel.close()`.

**Validates: Requirements 2.1**

Property 2: Preservation — Bar Wrapper Click Still Opens Panel

_For any_ click event on a `.chart-race__bar-wrapper` element, the existing `bar:click` event bus flow SHALL continue to fire, pausing playback if active and opening the detail panel for the clicked artist, producing the same behavior as the original code.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/main.ts`

**Location**: After the existing `eventBus.on("bar:click", ...)` wiring block.

**Specific Changes**:
1. **Add click-outside listener**: After the renderer is mounted (so `.chart-race` exists in the DOM), query for the `.chart-race` element and attach a click listener. In the handler, check if the click target is inside a `.chart-race__bar-wrapper` using `closest('.chart-race__bar-wrapper')`. If it is NOT, and `detailPanel.isOpen()` returns true, call `detailPanel.close()`.

2. **Event propagation consideration**: The bar wrapper click handlers use `eventBus.emit('bar:click', ...)` which triggers `detailPanel.open(...)`. The new click-outside handler on `.chart-race` will also fire for bar wrapper clicks (due to event bubbling). However, since `closest('.chart-race__bar-wrapper')` will return the wrapper element for those clicks, the handler will correctly skip them — no `stopPropagation()` needed.

**File**: `src/style.css`

**Rule**: `.chart-race__bar-wrapper`

**Specific Changes**:
3. **Add cursor pointer**: Add `cursor: pointer;` to the existing `.chart-race__bar-wrapper` rule block.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that mount the chart race renderer, open the detail panel, then simulate click events on the `.chart-race` wrapper outside any bar wrapper. Run these tests on the UNFIXED code to observe that the panel remains open.

**Test Cases**:
1. **Click on bars container background**: Simulate clicking `.chart-race__bars` while panel is open (will fail on unfixed code — panel stays open)
2. **Click on date display**: Simulate clicking `.chart-race__date` while panel is open (will fail on unfixed code — panel stays open)
3. **Click on legend area**: Simulate clicking `.chart-race__legend` while panel is open (will fail on unfixed code — panel stays open)
4. **Cursor style check**: Inspect computed style of `.chart-race__bar-wrapper` for `cursor: pointer` (will fail on unfixed code — returns `default`)

**Expected Counterexamples**:
- Detail panel remains open after clicking empty chart space
- Possible cause: no click listener on `.chart-race` wrapper element

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  // Click-to-dismiss
  IF input.event.type == 'click' AND input.panelOpen == true
     AND input.target NOT inside '.chart-race__bar-wrapper'
  THEN
    result := handleChartClick_fixed(input.event)
    ASSERT detailPanel.isOpen() == false
  END IF

  // Cursor style
  IF input.event.type == 'hover' AND input.target IS '.chart-race__bar-wrapper'
  THEN
    ASSERT getComputedStyle(input.target).cursor == 'pointer'
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT behavior_original(input) == behavior_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for bar wrapper clicks, Escape key, close button, and playback events, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Bar wrapper click preservation**: Verify clicking a bar wrapper still emits `bar:click` and opens the detail panel after the fix
2. **Escape key preservation**: Verify pressing Escape while the panel is open still closes it
3. **Close button preservation**: Verify clicking the close button still closes the panel
4. **Playback close preservation**: Verify emitting `play` on the event bus still closes the panel
5. **No-panel click preservation**: Verify clicking empty space when the panel is NOT open produces no errors or side effects

### Unit Tests

- Test that clicking outside a bar wrapper when the panel is open calls `detailPanel.close()`
- Test that clicking outside a bar wrapper when the panel is NOT open does nothing
- Test that clicking a bar wrapper does NOT trigger the close logic
- Test that `.chart-race__bar-wrapper` has `cursor: pointer` in CSS

### Property-Based Tests

- Generate random click targets within the `.chart-race` element (both inside and outside bar wrappers) with random panel states, and verify: if outside + panel open → panel closes; if inside bar wrapper → panel stays open / opens for that artist
- Generate random sequences of open/close/click-outside actions and verify panel state consistency

### Integration Tests

- Test full flow: click bar wrapper to open panel → click empty space → panel closes → click another bar wrapper → panel opens for new artist
- Test that click-outside dismissal works in both mobile (full-screen overlay) and desktop (sidebar) layouts
- Test interaction with playback: open panel via bar click → start playback → panel closes → pause → panel opens → click outside → panel closes
