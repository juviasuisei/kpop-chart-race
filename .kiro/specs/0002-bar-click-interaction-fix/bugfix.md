# Bugfix Requirements Document

## Introduction

Clicking or tapping on bars in the chart race visualization has no effect. The Detail_Panel should open when a bar is clicked (while paused) or when a bar is tapped during playback (freeze-then-resolve). This bug breaks Requirements 7.1 and 7.9 from the original spec. The root cause is that `ChartRaceRenderer` creates bar DOM elements but never attaches click event listeners and never emits `bar:click` events via the EventBus. The `bar:click` handler in `main.ts` is correctly wired but never triggered.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the Playback_Controller is paused and the user clicks a bar, THEN the system does nothing — no `bar:click` event is emitted and the Detail_Panel does not open for the clicked artist.

1.2 WHEN the Playback_Controller is playing and the user clicks/taps a bar, THEN the system does nothing — playback does not pause, no `bar:click` event is emitted, and the Detail_Panel does not open (freeze-then-resolve does not occur).

1.3 WHEN bar elements are created by `ChartRaceRenderer.createBarElement()`, THEN the system does not attach any click event listeners to the bar wrapper elements.

1.4 WHEN `ChartRaceRenderer` is instantiated, THEN the system does not provide it with an EventBus instance, so it has no mechanism to emit `bar:click` events.

### Expected Behavior (Correct)

2.1 WHEN the Playback_Controller is paused and the user clicks a bar, THEN the system SHALL emit a `bar:click` event with the corresponding `artistId`, causing the Detail_Panel to open for that artist.

2.2 WHEN the Playback_Controller is playing and the user clicks/taps a bar, THEN the system SHALL emit a `bar:click` event with the corresponding `artistId`, causing the Playback_Controller to pause (freeze-then-resolve) and the Detail_Panel to open for the tapped bar.

2.3 WHEN bar elements are created by `ChartRaceRenderer.createBarElement()`, THEN the system SHALL attach a click event listener to each bar wrapper element that emits a `bar:click` event with the artist's `artistId`.

2.4 WHEN `ChartRaceRenderer` is instantiated, THEN the system SHALL accept an EventBus instance (via constructor parameter) so it can emit `bar:click` events when bars are clicked.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the `bar:click` event is received in `main.ts` and the Playback_Controller is paused, THEN the system SHALL CONTINUE TO open the Detail_Panel for the specified artist (existing handler logic is unchanged).

3.2 WHEN the `bar:click` event is received in `main.ts` and the Playback_Controller is playing, THEN the system SHALL CONTINUE TO pause playback and then open the Detail_Panel (existing freeze-then-resolve handler logic is unchanged).

3.3 WHEN the `pause` event is emitted, THEN the system SHALL CONTINUE TO auto-open the Detail_Panel for the top-ranked artist.

3.4 WHEN the `play` event is emitted, THEN the system SHALL CONTINUE TO auto-close the Detail_Panel if it is open.

3.5 WHEN `ChartRaceRenderer.update()` is called with a new snapshot, THEN the system SHALL CONTINUE TO animate bar positions, widths, and numeric value tweening correctly.

3.6 WHEN `ChartRaceRenderer.destroy()` is called, THEN the system SHALL CONTINUE TO cancel pending animation frames and remove the DOM subtree.

3.7 WHEN bar elements are rendered, THEN the system SHALL CONTINUE TO display artist name, logo, generation, type indicator, cumulative value, and featured release correctly.

---

## Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type BarClickInteraction
  OUTPUT: boolean
  
  // Returns true when the user clicks/taps any bar element in the chart race
  RETURN X.eventType = "click" AND X.target IS a bar wrapper element in ChartRaceRenderer
END FUNCTION
```

## Fix Checking Property

```pascal
// Property: Fix Checking — Bar clicks emit bar:click events
FOR ALL X WHERE isBugCondition(X) DO
  result ← ChartRaceRenderer'.handleBarClick(X)
  ASSERT eventBus.emitted("bar:click", X.artistId)
END FOR
```

## Preservation Checking Property

```pascal
// Property: Preservation Checking — Non-click interactions unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

This ensures that all existing rendering, animation, playback, and event handling behavior remains identical for any interaction that is not a bar click.
