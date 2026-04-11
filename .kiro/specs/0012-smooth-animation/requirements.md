# Requirements Document

## Introduction

The K-Pop Chart Race animation currently pauses between daily snapshots. The playback interval is 1 second, but CSS transitions and value tweens complete in 0.4 seconds, leaving a 0.6-second gap where nothing moves. This feature aligns the transition durations with the playback interval so bars are continuously in motion throughout playback.

## Glossary

- **Chart_Race_Renderer**: The component (`ChartRaceRenderer`) that owns the bar visualization DOM subtree, applies CSS transitions for position and width, and tweens numeric values.
- **Playback_Controller**: The component (`PlaybackController`) that advances the date index on a 1-second interval and emits `date:change` events.
- **Bar_Wrapper**: The `.chart-race__bar-wrapper` element whose `transform` property is transitioned to animate vertical position changes.
- **Bar**: The `.chart-race__bar` element whose `width` property is transitioned to animate horizontal size changes.
- **Tween_Duration**: The constant (`TWEEN_DURATION`) controlling how long the numeric value counter animation runs via `requestAnimationFrame`.
- **Transition_Duration**: The CSS `transition` duration applied to Bar_Wrapper `transform` and Bar `width` properties.
- **Playback_Interval**: The 1-second `setInterval` period used by Playback_Controller to advance dates.

## Requirements

### Requirement 1: CSS Transition Duration Alignment

**User Story:** As a viewer, I want bar position and width transitions to span the full playback interval, so that the animation feels fluid and continuous without pauses between days.

#### Acceptance Criteria

1. THE Chart_Race_Renderer SHALL apply a Transition_Duration of 950 milliseconds to Bar_Wrapper `transform` transitions.
2. THE Chart_Race_Renderer SHALL apply a Transition_Duration of 950 milliseconds to Bar `width` transitions.
3. THE Chart_Race_Renderer SHALL use the `ease-in-out` timing function for both Bar_Wrapper `transform` and Bar `width` transitions.

### Requirement 2: Value Tween Duration Alignment

**User Story:** As a viewer, I want the numeric value counter to animate over the full playback interval, so that the number ticks up smoothly in sync with bar movement.

#### Acceptance Criteria

1. THE Chart_Race_Renderer SHALL set Tween_Duration to 950 milliseconds.
2. WHEN a new snapshot arrives, THE Chart_Race_Renderer SHALL animate the displayed cumulative value from the previous value to the new value over the full Tween_Duration.

### Requirement 3: Version Bump

**User Story:** As a maintainer, I want the package version updated to reflect this behavioral change.

#### Acceptance Criteria

1. THE package.json SHALL declare version `0.7.0`.
