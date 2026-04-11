# Requirements Document

## Introduction

This feature bundles three related changes that unblock data entry work for the K-Pop Chart Race application. The changes are: (1) converting dummy artist logo files from SVG to PNG format, (2) adding two new music show chart sources (`m_countdown` and `show_music_core`), and (3) fixing source logo references in code from `.svg` to `.png` extensions. A minor version bump from 0.2.3 to 0.3.0 accompanies these changes.

## Glossary

- **Artist_Logo**: A PNG image file in `public/assets/logos/` representing a K-pop artist, referenced by the `logo` field in artist JSON data files.
- **Source_Logo**: A PNG image file in `public/assets/sources/` representing a music show chart source.
- **Data_File**: A JSON file in `public/data/` containing one `ArtistEntry` with a `logo` field that holds the relative path to the Artist_Logo.
- **ChartSource_Type**: The TypeScript union type in `src/types.ts` that enumerates all valid music show chart source identifiers.
- **SOURCE_LOGO_MAP**: The record in `src/detail-panel.ts` that maps ChartSource identifiers to Source_Logo file paths.
- **KNOWN_CHART_SOURCES**: The set in `src/data-loader.ts` that lists recognized ChartSource values for validation warnings.
- **Data_Loader**: The module (`src/data-loader.ts`) responsible for fetching, validating, and combining JSON data files into a DataStore.
- **Detail_Panel**: The module (`src/detail-panel.ts`) that renders the artist timeline sidebar with embedded media and source logos.
- **Chart_Race_Renderer**: The module (`src/chart-race-renderer.ts`) that renders the main bar chart visualization.

## Requirements

### Requirement 1: Convert Artist Logo Files from SVG to PNG

**User Story:** As a data contributor, I want the dummy artist logo files to be PNG format, so that I can replace them with real PNG logos without changing file extensions or code references.

#### Acceptance Criteria

1. THE build system SHALL include 9 Artist_Logo files in `public/assets/logos/` with `.png` extensions, one for each dummy artist (aria-bloom, crystal-dream, jay-storm, luna-park, neon-pulse, phoenix-rise, shadow-blade, stellar-nova, thunder-kings).
2. WHEN the application loads an Artist_Logo, THE Data_Loader SHALL resolve the `logo` field to a path ending in `.png`.
3. THE application SHALL NOT contain any Artist_Logo files with `.svg` extensions in `public/assets/logos/`.

### Requirement 2: Update Logo Path References in Data Files

**User Story:** As a data contributor, I want the JSON data files to reference `.png` logo paths, so that artist logos display correctly after the format change.

#### Acceptance Criteria

1. THE Data_File for each artist SHALL contain a `logo` field value with the pattern `assets/logos/{artist-slug}.png`.
2. WHEN the Data_Loader loads a Data_File, THE Data_Loader SHALL resolve the `logo` field to a valid `.png` file path.
3. FOR ALL Data_Files in `public/data/`, THE `logo` field SHALL NOT reference a `.svg` file extension.

### Requirement 3: Add m_countdown as a Valid Chart Source

**User Story:** As a data contributor, I want `m_countdown` recognized as a valid chart source, so that I can enter M Countdown chart data without triggering validation warnings.

#### Acceptance Criteria

1. THE ChartSource_Type SHALL include `m_countdown` as a valid union member.
2. THE KNOWN_CHART_SOURCES set in the Data_Loader SHALL include `m_countdown`.
3. THE SOURCE_LOGO_MAP in the Detail_Panel SHALL map `m_countdown` to the path `assets/sources/m_countdown.png`.
4. WHEN a Data_File contains a DailyValueEntry with source `m_countdown`, THE Data_Loader SHALL NOT emit a warning for an unknown ChartSource.

### Requirement 4: Add show_music_core as a Valid Chart Source

**User Story:** As a data contributor, I want `show_music_core` recognized as a valid chart source, so that I can enter Show! Music Core chart data without triggering validation warnings.

#### Acceptance Criteria

1. THE ChartSource_Type SHALL include `show_music_core` as a valid union member.
2. THE KNOWN_CHART_SOURCES set in the Data_Loader SHALL include `show_music_core`.
3. THE SOURCE_LOGO_MAP in the Detail_Panel SHALL map `show_music_core` to the path `assets/sources/show_music_core.png`.
4. WHEN a Data_File contains a DailyValueEntry with source `show_music_core`, THE Data_Loader SHALL NOT emit a warning for an unknown ChartSource.

### Requirement 5: Fix Source Logo References from SVG to PNG

**User Story:** As a user viewing the detail panel timeline, I want source logos to load correctly, so that I can see which music show each chart entry came from.

#### Acceptance Criteria

1. THE SOURCE_LOGO_MAP in the Detail_Panel SHALL map all existing sources (inkigayo, the_show, show_champion, music_bank) to paths ending in `.png`.
2. THE SOURCE_LOGO_MAP SHALL NOT contain any path values ending in `.svg`.
3. WHEN the Detail_Panel renders a timeline entry with a known source, THE Detail_Panel SHALL display the corresponding Source_Logo image from `assets/sources/{source}.png`.

### Requirement 6: Version Bump

**User Story:** As a maintainer, I want the package version bumped to 0.3.0, so that this feature release is properly versioned following semver conventions.

#### Acceptance Criteria

1. THE `package.json` file SHALL contain version `0.3.0`.
2. THE version change SHALL follow semver minor bump convention (from 0.2.3 to 0.3.0).
