# Bugfix Requirements Document

## Introduction

Two related layout bugs in the Detail_Panel's timeline view cause visual breakage: (1) the vertical timeline line (`::before` pseudo-element) stops short when lazy-loaded embeds expand the scrollable content, and (2) right-side timeline entries with embedded media overflow and get clipped by the panel edge. Both bugs degrade the timeline reading experience, especially for artists with many embeds.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN embeds lazy-load via IntersectionObserver inside `.detail-panel__timeline` and expand the scrollable content height, THEN the `::before` vertical timeline line does not extend to cover the full content because it uses `position: absolute` with `top: 0; bottom: 0` on the scroll container, which is sized to the viewport height rather than the scroll height.

1.2 WHEN timeline entries with class `timeline-entry--right` contain embedded iframes or blockquotes, THEN the embed content overflows the entry's 45% width bounds and gets clipped by the panel's `overflow: hidden`, cutting off the right edge of the embed.

1.3 WHEN an iframe is rendered inside a `.timeline-entry__embed-group`, THEN the iframe has no max-width constraint and can exceed the timeline entry's width.

### Expected Behavior (Correct)

2.1 WHEN embeds lazy-load and expand the scrollable content inside `.detail-panel__timeline`, THEN the vertical timeline line SHALL extend to cover the full scrollable content height, remaining visible from the first entry to the last regardless of dynamic content expansion.

2.2 WHEN timeline entries with class `timeline-entry--right` contain embedded iframes or blockquotes, THEN the embed content SHALL be constrained within the entry's width bounds without clipping or overflow.

2.3 WHEN an iframe is rendered inside a `.timeline-entry__embed-group`, THEN the iframe SHALL have `max-width: 100%` and responsive sizing so it fits within the timeline entry.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the Detail_Panel opens for an artist with no embeds, THEN the system SHALL CONTINUE TO display the vertical timeline with alternating left/right entries and the central line correctly.

3.2 WHEN the user scrolls the timeline content, THEN the system SHALL CONTINUE TO enable independent scrolling within the timeline via `overflow-y: auto`.

3.3 WHEN timeline entries are rendered with class `timeline-entry--left`, THEN the system SHALL CONTINUE TO position them at 45% width aligned to the left side.

3.4 WHEN the Detail_Panel is opened on mobile (viewport < 768px), THEN the system SHALL CONTINUE TO render as a full-screen overlay.

3.5 WHEN the Detail_Panel is opened on desktop (viewport >= 768px), THEN the system SHALL CONTINUE TO render as a 400px sidebar.

---

## Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type DetailPanelRender
  OUTPUT: boolean

  // Bug 1: Timeline line stops short when embeds expand content
  // Bug 2: Right-side embeds overflow entry bounds
  RETURN X.hasLazyLoadedEmbeds AND X.embedsHaveExpanded
         OR X.timelineEntry.side = "right" AND X.entryContainsEmbed
END FUNCTION
```

## Fix Checking Property

```pascal
// Property: Fix Checking — Timeline line covers full content
FOR ALL X WHERE X.hasLazyLoadedEmbeds DO
  ASSERT timelineLine.height >= scrollableContent.height
END FOR

// Property: Fix Checking — Embeds constrained within entry
FOR ALL X WHERE X.entryContainsEmbed DO
  ASSERT embed.renderedWidth <= entry.clientWidth
END FOR
```

## Preservation Checking Property

```pascal
// Property: Preservation Checking — Non-embed layout unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```
