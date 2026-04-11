# Implementation Plan: Asset and Source Updates

## Overview

Update source code to add two new chart sources (`m_countdown`, `show_music_core`), fix all source logo paths from `.svg` to `.png`, replace artist logo SVGs with PNG placeholders, update JSON data files, and bump version to 0.3.0.

## Tasks

- [x] 1. Update source code: types, data-loader, and detail-panel
  - [x] 1.1 Add `m_countdown` and `show_music_core` to the `ChartSource` union type in `src/types.ts`
    - Append `| "m_countdown" | "show_music_core"` to the existing union
    - _Requirements: 3.1, 4.1_

  - [x] 1.2 Add `m_countdown` and `show_music_core` to `KNOWN_CHART_SOURCES` in `src/data-loader.ts`
    - Add both strings to the `Set` initializer
    - _Requirements: 3.2, 4.2_

  - [x] 1.3 Update `SOURCE_LOGO_MAP` in `src/detail-panel.ts`
    - Change all 4 existing `.svg` paths to `.png`
    - Add `m_countdown: "assets/sources/m_countdown.png"` and `show_music_core: "assets/sources/show_music_core.png"`
    - _Requirements: 3.3, 4.3, 5.1, 5.2_

  - [ ]* 1.4 Write unit tests for new chart sources and updated logo paths
    - In `tests/unit/data-loader.test.ts`: add test that `validateArtistEntry` does NOT warn for `m_countdown` and `show_music_core` sources
    - In `tests/unit/detail-panel.test.ts`: add test that `SOURCE_LOGO_MAP` contains all 6 sources and every value ends with `.png`
    - _Requirements: 3.4, 4.4, 5.1, 5.2_

- [x] 2. Replace artist logo SVGs with PNGs and update JSON data files
  - [x] 2.1 Delete the 9 SVG files in `public/assets/logos/` and create 9 minimal 1×1 PNG placeholders with matching base names
    - Files: aria-bloom, crystal-dream, jay-storm, luna-park, neon-pulse, phoenix-rise, shadow-blade, stellar-nova, thunder-kings
    - _Requirements: 1.1, 1.3_

  - [x] 2.2 Update the `logo` field in all artist JSON data files from `.svg` to `.png`
    - 11 files in `public/data/`: aria-bloom, bts, crystal-dream, galaxy-seven, jay-storm, luna-park, neon-pulse, phoenix-rise, shadow-blade, stellar-nova, thunder-kings
    - Each `logo` value becomes `assets/logos/{slug}.png`
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 2.3 Write unit tests for asset and data file correctness
    - Verify all 9 PNG logo files exist in `public/assets/logos/` and no SVG files remain
    - Verify every JSON data file's `logo` field ends with `.png`
    - Verify `package.json` version is `0.3.0`
    - _Requirements: 1.1, 1.3, 2.1, 2.3, 6.1_

- [ ] 3. Bump version to 0.3.0
  - [ ] 3.1 Update `"version"` in `package.json` from `"0.2.3"` to `"0.3.0"`
    - _Requirements: 6.1, 6.2_

- [x] 4. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The user has already added `m_countdown.png` and `show_music_core.png` to `public/assets/sources/`
- The user has already replaced source SVGs with PNGs in `public/assets/sources/`
- Each task references specific requirements for traceability
