# Requirements Document

## Introduction

Add a title header area to the top-left of the K-Pop Chart Race visualization. The header displays the application title, the current package version number, and a dynamically populated note indicating the earliest date from which chart data points are included. This provides users with immediate context about what they are viewing and the data coverage period.

## Glossary

- **Title_Header**: A DOM element group positioned in the top-left of the chart race area containing the app title, version badge, and data note.
- **Chart_Race_Renderer**: The component (`ChartRaceRenderer`) responsible for creating and managing the chart race DOM subtree, including bars, date display, and legend.
- **DataStore**: The central data store object built from all loaded JSON files, containing `artists`, `dates`, `startDate`, and `endDate` properties.
- **Version_Badge**: A small inline text element displaying the current application version from `package.json` (e.g., "v0.6.0").
- **Data_Note**: A text element beneath the title displaying the earliest data date, informing users of the data coverage start point.
- **Start_Date**: The `startDate` property on the DataStore, representing the earliest date found across all loaded data files.

## Requirements

### Requirement 1: Display Application Title

**User Story:** As a user, I want to see the application title prominently in the chart race area, so that I immediately know what application I am viewing.

#### Acceptance Criteria

1. WHEN the Chart_Race_Renderer mounts, THE Title_Header SHALL render the text "K-Pop Chart Race" in a prominent, readable font within the top-left region of the chart race area.
2. THE Title_Header SHALL remain visible and not overlap or interfere with the date display positioned in the top-right of the chart race area.
3. THE Title_Header SHALL be styled with a font size and weight that visually distinguishes the title from other chart elements.

### Requirement 2: Display Version Number

**User Story:** As a user, I want to see the current version number next to the title, so that I can identify which version of the application I am using.

#### Acceptance Criteria

1. WHEN the Chart_Race_Renderer mounts, THE Version_Badge SHALL render the current `package.json` version prefixed with "v" (e.g., "v0.6.0") adjacent to the application title.
2. THE Version_Badge SHALL use a smaller font size than the application title to establish visual hierarchy.
3. THE Version_Badge SHALL import the version string from `package.json` at build time using Vite's JSON import capability.

### Requirement 3: Display Earliest Data Date Note

**User Story:** As a user, I want to see a note explaining from which date the chart data begins, so that I understand the data coverage period.

#### Acceptance Criteria

1. WHEN data loading completes and the Start_Date is available, THE Data_Note SHALL render the text "Includes points earned from {startDate} forward" beneath the title, where `{startDate}` is replaced with the actual `DataStore.startDate` value.
2. THE Data_Note SHALL use a smaller, subdued font style to differentiate the note from the title text.
3. IF the Start_Date is not available or is an empty string, THEN THE Data_Note SHALL not render any text.

### Requirement 4: Layout and Positioning

**User Story:** As a user, I want the title header to be positioned consistently in the top-left without disrupting the chart visualization, so that the chart remains usable and readable.

#### Acceptance Criteria

1. THE Title_Header SHALL be positioned in the top-left of the chart race container, before or overlaying the chart bars area.
2. THE Title_Header SHALL not interfere with the existing date display element in the top-right.
3. WHILE the viewport width is less than 768px, THE Title_Header SHALL reduce font sizes proportionally to remain readable without causing layout overflow.
4. THE Title_Header SHALL use CSS classes following the existing `chart-race__` BEM naming convention.

### Requirement 5: Version Bump

**User Story:** As a developer, I want the package version to be bumped from 0.5.0 to 0.6.0, so that the new feature release is properly versioned.

#### Acceptance Criteria

1. WHEN this feature is implemented, THE `package.json` version field SHALL be updated from "0.5.0" to "0.6.0".
