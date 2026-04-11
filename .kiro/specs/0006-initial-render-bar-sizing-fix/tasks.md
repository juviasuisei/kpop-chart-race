# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** — Initial Render Bar Sizing
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to the concrete failing case: mount renderer, call `update()` synchronously (before layout), assert bars are correctly sized
  - Test file: `tests/property/renderer.property.test.ts` (append to existing file)
  - Use `fast-check` with `@fast-check/vitest` following existing patterns in the file
  - Generate random `ChartSnapshot` instances with 1–10 entries (varying cumulative values, artist types, name lengths)
  - For each generated snapshot at zoom level 10:
    - Mount `ChartRaceRenderer` into a container
    - Call `update(snapshot, 10)` synchronously (simulating the bug condition where `clientHeight === 0`)
    - Assert: each bar wrapper has `height` parsed as a number > 0 (from `barEl.wrapper.style.height`)
    - Assert: bars are vertically distributed — no two bars share the same `translateY` value (unless there's only one bar)
  - For tied entries (two entries with identical `cumulativeValue` but different `artistName` lengths):
    - Assert: both `.chart-race__bar` elements have the same `style.width` value
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (bars have `height: 0px`, all at `translateY(0px)`, tied bars may differ in width due to `min-width: 2rem`)
  - Document counterexamples found to understand root cause
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** — Post-Layout Update Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Test file: `tests/property/renderer.property.test.ts` (append to existing file)
  - Use `fast-check` with `@fast-check/vitest` following existing patterns in the file
  - Observe on UNFIXED code: when `clientHeight > 0` (post-layout), `update()` computes correct bar heights and positions
  - Observe: `computeBarWidth` returns `(cumulativeValue / maxCumulativeValue) * 100` for all inputs
  - Observe: zoom "all" uses fixed `BAR_HEIGHT_ALL = 40` and sets `overflowY: auto`
  - Observe: zoom 10 uses `containerHeight / 10` and sets `overflowY: hidden`
  - Observe: bar click emits `bar:click` with correct `artistId`
  - Write property-based tests:
    - Generate random snapshots with 1–15 entries and random zoom levels (10 or "all")
    - Mock `barsContainer.clientHeight` to return a positive value (e.g., 500) to simulate post-layout state
    - For zoom 10: assert each bar wrapper `height` equals `containerHeight / 10`
    - For zoom "all": assert each bar wrapper `height` equals `40` and `overflowY` is `auto`
    - For all entries: assert bar `style.width` equals `computeBarWidth(entry.cumulativeValue, maxCumulative) + '%'`
    - For all entries: assert bar wrapper `transform` equals `translateY((rank-1) * barHeight + 'px')`
    - Assert: `computeBarWidth(v, max)` equals `(v / max) * 100` for all positive `max` (pure function preservation)
  - Verify tests PASS on UNFIXED code (these test post-layout behavior which already works)
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix for initial render bar sizing bug

  - [x] 3.1 Implement the fix
    - **File `src/main.ts`**: Wrap the initial `eventBus.emit("date:change", dataStore.dates[0])` in a `requestAnimationFrame` callback so the browser completes layout before the first `update()` runs
    - Change:
      ```typescript
      if (dataStore.dates.length > 0) {
        requestAnimationFrame(() => {
          eventBus.emit("date:change", dataStore.dates[0]);
        });
      }
      ```
    - **File `src/style.css`**: In the `.chart-race__bar` rule, replace `min-width: 2rem` with `min-width: 0` so bar width is purely determined by the data-driven percentage from `computeBarWidth`
    - **File `src/chart-race-renderer.ts`**: Add a defensive guard in `update()` — if `containerHeight === 0` and `zoomLevel === 10`, schedule a retry via `requestAnimationFrame` and return early, preventing the collapsed state even if timing is unreliable
    - **File `package.json`**: Bump version from `0.2.1` to `0.2.2` (patch bump for bugfix)
    - _Bug_Condition: isBugCondition(input) where input.renderCall.isFirstUpdateAfterMount === true AND input.renderCall.barsContainerClientHeight === 0_
    - _Expected_Behavior: Bars have non-zero height, are vertically distributed, and tied entries have equal width from the first visible frame_
    - _Preservation: Subsequent update() calls, zoom changes, bar clicks, playback, and resize behavior remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** — Initial Render Bar Sizing
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (bars correctly sized and positioned)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed — bars have non-zero height, are vertically distributed, tied entries have equal width)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** — Post-Layout Update Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in post-layout behavior)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite (`vitest run`) to verify all existing and new tests pass
  - Ensure no regressions in existing unit tests (`tests/unit/chart-race-renderer.test.ts`) or property tests (`tests/property/renderer.property.test.ts`)
  - Ensure all other test files continue to pass
  - Ask the user if questions arise
