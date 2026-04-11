# Bugfix Requirements Document

## Introduction

Two related interaction bugs affect the chart race UI. First, clicking on empty space in the chart area does not close the detail panel — the panel can only be dismissed via the close button, Escape key, or when playback starts. Second, the bar wrappers that open the detail panel on click do not show a pointer cursor on hover, giving no visual affordance that they are interactive.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the detail panel is open AND the user clicks on empty space in the chart area (outside any `.chart-race__bar-wrapper`) THEN the system does nothing and the panel remains open

1.2 WHEN the user hovers over a `.chart-race__bar-wrapper` element THEN the system displays the default cursor instead of a pointer cursor

### Expected Behavior (Correct)

2.1 WHEN the detail panel is open AND the user clicks on empty space in the chart area (outside any `.chart-race__bar-wrapper`, value text, or release text) THEN the system SHALL close the detail panel

2.2 WHEN the user hovers over a `.chart-race__bar-wrapper` element THEN the system SHALL display a pointer (hand) cursor indicating the element is clickable

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user clicks on a `.chart-race__bar-wrapper` element THEN the system SHALL CONTINUE TO open the detail panel for that artist

3.2 WHEN the detail panel is open AND the user presses the Escape key THEN the system SHALL CONTINUE TO close the detail panel

3.3 WHEN the detail panel is open AND the user clicks the close button THEN the system SHALL CONTINUE TO close the detail panel

3.4 WHEN playback starts while the detail panel is open THEN the system SHALL CONTINUE TO close the detail panel automatically

3.5 WHEN the detail panel is not open AND the user clicks on empty space in the chart area THEN the system SHALL CONTINUE TO do nothing (no errors, no side effects)
