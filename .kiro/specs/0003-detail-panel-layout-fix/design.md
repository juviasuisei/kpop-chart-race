# Detail Panel Layout Fix Design

## Overview

Two CSS layout bugs in the Detail_Panel timeline: (1) the vertical timeline line (`::before` pseudo-element on `.detail-panel__timeline`) uses absolute positioning relative to the scroll container's viewport height, so it stops short when lazy-loaded embeds expand the content; (2) embeds inside right-side timeline entries overflow the 45% width entry and get clipped. The fix restructures the timeline to use an inner wrapper for the line and constrains embed dimensions within entries.

## Glossary

- **Bug_Condition (C)**: Timeline content expands from lazy-loaded embeds OR right-side entries contain embeds that overflow
- **Property (P)**: Timeline line covers full scrollable content; embeds fit within entry bounds
- **Preservation**: Existing timeline layout, scrolling, alternating sides, mobile/desktop rendering unchanged
- **Timeline line**: The `::before` pseudo-element that draws the vertical center line in the timeline
- **Inner wrapper**: A new `<div>` inside `.detail-panel__timeline` that wraps all timeline entries and hosts the `::before` line

## Bug Details

### Bug 1: Timeline Line Stops Short

The `.detail-panel__timeline` has `overflow-y: auto` and `position: relative`. Its `::before` uses `position: absolute; top: 0; bottom: 0` which binds to the container's viewport height, not the scroll height. When embeds lazy-load and expand content, the line doesn't grow.

**Fix**: Add an inner wrapper `<div class="detail-panel__timeline-inner">` inside the timeline container. Move the `::before` from `.detail-panel__timeline` to `.detail-panel__timeline-inner`. The inner wrapper has `position: relative` and grows with content naturally, so the `::before` with `top: 0; bottom: 0` covers the full content height.

### Bug 2: Right-Side Embeds Clipped

Timeline entries are 45% width. Embeds (iframes, blockquotes) inside them have no width constraints and can exceed the entry bounds. The panel's `overflow: hidden` clips them.

**Fix**: Add `overflow: hidden` to `.timeline-entry` and `max-width: 100%` to iframes and blockquotes within embed groups. This ensures all embed content respects the entry's width.

## Hypothesized Root Cause

1. `::before` on `.detail-panel__timeline` (the scroll container) is absolutely positioned relative to the container's visible height, not its scroll height
2. No `max-width` or `overflow` constraints on embed content within timeline entries

## Correctness Properties

Property 1: Timeline Line Full Coverage

_For any_ Detail_Panel with timeline entries (with or without embeds), the vertical timeline line SHALL extend from the top of the first entry to the bottom of the last entry, covering the full scrollable content height.

**Validates: Requirements 2.1**

Property 2: Embed Width Containment

_For any_ timeline entry containing an iframe or blockquote embed, the rendered embed width SHALL NOT exceed the timeline entry's client width.

**Validates: Requirements 2.2, 2.3**

Property 3: Preservation - Existing Layout Unchanged

_For any_ Detail_Panel rendering without embeds, the timeline layout (alternating left/right entries, scrolling, mobile/desktop modes) SHALL be identical to the pre-fix behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

**File**: `src/style.css`

1. Remove `::before` from `.detail-panel__timeline`
2. Add `.detail-panel__timeline-inner` with `position: relative; min-height: 100%`
3. Add `::before` on `.detail-panel__timeline-inner` with `position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; background: #d0d0d0; transform: translateX(-50%)`
4. Add `overflow: hidden` to `.timeline-entry`
5. Add `.timeline-entry iframe, .timeline-entry blockquote` rule with `max-width: 100%; box-sizing: border-box`
6. Add `.timeline-entry iframe` rule with `height: auto` for responsive sizing

**File**: `src/detail-panel.ts`

1. In `open()`, after creating the `timeline` div, create an inner wrapper `div` with class `detail-panel__timeline-inner`
2. Append all timeline entries to the inner wrapper instead of directly to the timeline container
3. Append the inner wrapper to the timeline container

## Testing Strategy

### Unit Tests

- Verify the inner wrapper element exists inside `.detail-panel__timeline`
- Verify all timeline entries are children of `.detail-panel__timeline-inner`
- Verify existing tests still pass (panel open/close, entry rendering, embed placeholders)

### Preservation Checking

Run all existing `detail-panel.test.ts` tests to confirm no regressions in:
- Panel creation and removal
- Artist name display
- Timeline entry alternation
- Date headings, source info, performance values
- Crown icons
- Embed placeholders
- Accessibility attributes
