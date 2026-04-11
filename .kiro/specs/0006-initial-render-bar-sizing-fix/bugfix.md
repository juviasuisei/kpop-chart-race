# Bugfix Requirements Document

## Introduction

At initial render (before playback starts), bar heights and widths are incorrect. Two related symptoms share a root cause: the renderer's `update()` method is called synchronously after `mount()`, before the browser has laid out the bars container. This means `clientHeight` returns 0 (or an incorrect value), producing a `barHeight` of 0 and collapsing all bars to the same vertical position. Additionally, tied entries (same cumulative value) can appear as different visual widths because the CSS `min-width: 2rem` on `.chart-race__bar` and internal text content can override the data-driven percentage width when the container dimensions are not yet established.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the application performs its initial render (first `date:change` emitted synchronously after `mount()`) THEN the system computes `barHeight` as `this.barsContainer.clientHeight / 10` which evaluates to 0 (or an incorrect value) because the container has not been laid out yet, causing all bars to stack at `translateY(0px)` with zero height

1.2 WHEN two or more entries have the same cumulative value at initial render AND the container has not been laid out yet THEN the system renders bars at different visual widths despite `computeBarWidth` returning the same percentage, because the CSS `min-width: 2rem` and internal text content (artist name, generation label) can push individual bars to different rendered widths when the percentage-based width is ineffective at zero or near-zero container width

1.3 WHEN the application starts and the bars container has not completed layout THEN the system uses `clientHeight` of 0 for bar positioning calculations, resulting in all bar wrappers having `height: 0px` and `transform: translateY(0px)` making the chart visually collapsed

### Expected Behavior (Correct)

2.1 WHEN the application performs its initial render THEN the system SHALL compute `barHeight` using the actual laid-out height of the bars container, ensuring bars are correctly sized and vertically distributed across the container from the first frame

2.2 WHEN two or more entries have the same cumulative value at initial render THEN the system SHALL render those bars at the same visual width, with the width being purely determined by the data-driven percentage from `computeBarWidth` and not influenced by text content length or CSS minimum widths

2.3 WHEN the application starts THEN the system SHALL ensure the bars container has valid layout dimensions before computing bar positions, so that bar wrappers have correct non-zero heights and are positioned at their proper vertical offsets from the first visible frame

### Unchanged Behavior (Regression Prevention)

3.1 WHEN playback is running and `update()` is called on subsequent frames (after initial layout is complete) THEN the system SHALL CONTINUE TO compute bar heights and positions correctly using `clientHeight / 10` for zoom level 10

3.2 WHEN the zoom level is changed to "all" THEN the system SHALL CONTINUE TO use the fixed `BAR_HEIGHT_ALL` (40px) for bar height and enable vertical scrolling

3.3 WHEN entries have different cumulative values THEN the system SHALL CONTINUE TO render bars at proportionally different widths based on `computeBarWidth`

3.4 WHEN a bar is clicked during playback THEN the system SHALL CONTINUE TO pause playback and open the detail panel for that artist

3.5 WHEN the window is resized after initial render THEN the system SHALL CONTINUE TO correctly recompute bar dimensions on the next `update()` call
