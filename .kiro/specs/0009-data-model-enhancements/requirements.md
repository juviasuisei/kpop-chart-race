# Requirements Document

## Introduction

This feature enhances the K-Pop Chart Race data model with three changes: adding an optional `korean_name` field for displaying Korean artist names, adding an optional `debut` date field for showing debut information, and removing the `logo` field from JSON data files in favor of deriving the logo path from the filename slug. These changes simplify data entry and enrich the detail panel display. Version bump: 0.3.0 → 0.4.0.

## Glossary

- **ArtistEntry**: The TypeScript interface in `src/types.ts` representing the raw JSON schema for a single artist data file.
- **ParsedArtist**: The runtime model in `src/models.ts` produced after parsing and validating an ArtistEntry.
- **Data_Loader**: The module (`src/data-loader.ts`) responsible for fetching, validating, and converting JSON data files into a DataStore.
- **Detail_Panel**: The modal/sidebar UI component (`src/detail-panel.ts`) that displays an artist's timeline and metadata.
- **Filename_Slug**: The basename of a JSON data file without the `.json` extension (e.g., `bts` from `bts.json`, `aria-bloom` from `aria-bloom.json`).
- **Chart_Race_Renderer**: The main visualization component (`src/chart-race-renderer.ts`) that renders animated bars using `logoUrl` from ParsedArtist.

## Requirements

### Requirement 1: Add optional korean_name field to ArtistEntry

**User Story:** As a data contributor, I want to include a Korean name for each artist in the JSON data file, so that the application can display both English and Korean names.

#### Acceptance Criteria

1. THE ArtistEntry interface SHALL include an optional `korean_name` field of type string.
2. WHEN a JSON data file contains a `korean_name` field with a non-empty string value, THE Data_Loader SHALL preserve the `korean_name` value in the resulting ParsedArtist.
3. WHEN a JSON data file omits the `korean_name` field or provides an empty string, THE Data_Loader SHALL set the `korean_name` value to undefined on the resulting ParsedArtist.
4. THE Data_Loader SHALL accept a JSON data file as valid regardless of whether the `korean_name` field is present or absent.

### Requirement 2: Display korean_name in the Detail Panel header

**User Story:** As a viewer, I want to see the artist's Korean name in parentheses after the English name in the detail panel header, so that I can learn the original Korean name.

#### Acceptance Criteria

1. WHEN the Detail_Panel opens for an artist whose ParsedArtist has a defined `korean_name`, THE Detail_Panel SHALL display the Korean name in parentheses after the English name in the header (e.g., "BTS (방탄소년단)").
2. WHEN the Detail_Panel opens for an artist whose ParsedArtist has no `korean_name`, THE Detail_Panel SHALL display only the English name in the header without parentheses.
3. THE Detail_Panel SHALL escape all HTML special characters in the `korean_name` value before rendering.

### Requirement 3: Add optional debut field to ArtistEntry

**User Story:** As a data contributor, I want to include a debut date for each artist in the JSON data file, so that the application can display when the artist debuted.

#### Acceptance Criteria

1. THE ArtistEntry interface SHALL include an optional `debut` field of type string in ISO 8601 date format (YYYY-MM-DD).
2. WHEN a JSON data file contains a `debut` field with a valid date string, THE Data_Loader SHALL preserve the `debut` value in the resulting ParsedArtist.
3. WHEN a JSON data file omits the `debut` field or provides an empty string, THE Data_Loader SHALL set the `debut` value to undefined on the resulting ParsedArtist.
4. THE Data_Loader SHALL accept a JSON data file as valid regardless of whether the `debut` field is present or absent.

### Requirement 4: Display debut date in the Detail Panel header

**User Story:** As a viewer, I want to see the artist's debut date alongside the generation info in the detail panel sticky header, so that I can understand when the artist started their career.

#### Acceptance Criteria

1. WHEN the Detail_Panel opens for an artist whose ParsedArtist has a defined `debut`, THE Detail_Panel SHALL display the debut date in the artist meta area alongside the generation label, formatted as "Gen IV (debut: 2013-06-13)".
2. WHEN the Detail_Panel opens for an artist whose ParsedArtist has no `debut`, THE Detail_Panel SHALL display only the generation label without debut information (e.g., "Boy Group · III").
3. THE Detail_Panel SHALL render the debut text in a smaller font size relative to the generation label.

### Requirement 5: Remove logo field from ArtistEntry and derive logo path from filename

**User Story:** As a data contributor, I want the logo path to be automatically derived from the JSON filename, so that I do not need to manually specify a logo path in every data file.

#### Acceptance Criteria

1. THE ArtistEntry interface SHALL NOT include a `logo` field.
2. WHEN the Data_Loader processes a JSON data file, THE Data_Loader SHALL derive the logo path by extracting the Filename_Slug from the JSON filename and constructing the path `assets/logos/{Filename_Slug}.png`.
3. THE Data_Loader SHALL set the `logoUrl` field on the resulting ParsedArtist to the derived logo path.
4. THE Chart_Race_Renderer SHALL continue to read the `logoUrl` field from RankedEntry without modification.

### Requirement 6: Remove logo field from all JSON data files

**User Story:** As a data contributor, I want the `logo` field removed from all existing JSON data files, so that the data files are consistent with the new schema.

#### Acceptance Criteria

1. WHEN a JSON data file is loaded, THE Data_Loader SHALL ignore any `logo` field present in the JSON data (backward compatibility during migration).
2. Each JSON data file in `public/data/` SHALL NOT contain a `logo` field after migration.

### Requirement 7: Pass filename context to the parsing pipeline

**User Story:** As a developer, I want the Data_Loader to pass the filename to the artist parsing function, so that the logo path can be derived from the filename slug.

#### Acceptance Criteria

1. THE Data_Loader SHALL pass the JSON filename (e.g., `bts.json`) to the artist parsing function when converting an ArtistEntry to a ParsedArtist.
2. THE Data_Loader SHALL extract the Filename_Slug by removing the `.json` extension from the filename.
3. WHEN the filename is `bts.json`, THE Data_Loader SHALL produce a Filename_Slug of `bts` and a logo path of `assets/logos/bts.png`.
4. WHEN the filename is `aria-bloom.json`, THE Data_Loader SHALL produce a Filename_Slug of `aria-bloom` and a logo path of `assets/logos/aria-bloom.png`.

### Requirement 8: Version bump

**User Story:** As a developer, I want the package version updated to 0.4.0, so that the release reflects the data model changes.

#### Acceptance Criteria

1. THE package.json `version` field SHALL be updated from `0.3.0` to `0.4.0`.
