# Implementation Plan: Data Model Enhancements

## Overview

Update the data model to add optional `korean_name` and `debut` fields, remove the `logo` field from JSON data files (deriving logo URL from filename), display the new fields in the detail panel header, and bump version to 0.4.0.

## Tasks

- [x] 1. Update types, models, and data-loader
  - [x] 1.1 Update `ArtistEntry` in `src/types.ts`
    - Remove the `logo` field
    - Add optional `korean_name?: string` and `debut?: string`
    - _Requirements: 1.1, 3.1, 5.1_

  - [x] 1.2 Update `ParsedArtist` in `src/models.ts`
    - Add optional `koreanName?: string` and `debut?: string`
    - _Requirements: 1.2, 3.2_

  - [x] 1.3 Update `toParseArtist` and `loadAll` in `src/data-loader.ts`
    - Add `filename` parameter to `toParseArtist`
    - Derive `logoUrl` from filename slug: `assets/logos/${slug}.png`
    - Map `korean_name` → `koreanName` and `debut` → `debut` (empty string → undefined)
    - Pass filename from `loadAll` call site
    - _Requirements: 1.2, 1.3, 3.2, 3.3, 5.2, 5.3, 7.1, 7.2_

  - [ ]* 1.4 Write unit tests for data-loader changes
    - Update `validEntry()` helper in `tests/unit/data-loader.test.ts` to remove `logo` field
    - Add test: `toParseArtist` with `korean_name` preserves value as `koreanName`
    - Add test: `toParseArtist` without `korean_name` sets `koreanName` to `undefined`
    - Add test: `toParseArtist` derives `logoUrl` from filename (`bts.json` → `assets/logos/bts.png`)
    - Add test: `toParseArtist` derives `logoUrl` from hyphenated filename (`aria-bloom.json` → `assets/logos/aria-bloom.png`)
    - Add test: `validateArtistEntry` accepts entries with and without `korean_name`/`debut`
    - _Requirements: 1.2, 1.3, 1.4, 3.2, 3.3, 3.4, 7.3, 7.4_

  - [ ]* 1.5 Write property tests for data-loader (Properties 1–3)
    - [ ]* 1.5.1 Property 1: Optional field preservation round-trip
      - **Property 1: Optional field preservation round-trip**
      - **Validates: Requirements 1.2, 1.3, 3.2, 3.3**
    - [ ]* 1.5.2 Property 2: Validation accepts optional fields
      - **Property 2: Validation accepts optional fields**
      - **Validates: Requirements 1.4, 3.4**
    - [ ]* 1.5.3 Property 3: Logo URL derived from filename
      - **Property 3: Logo URL derived from filename**
      - **Validates: Requirements 5.2, 5.3, 7.1, 7.2**

- [x] 2. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Update detail panel and display new fields
  - [x] 3.1 Update header in `src/detail-panel.ts` to show Korean name and debut
    - Show Korean name in parentheses after English name when `koreanName` is defined
    - Show debut date in meta line when `debut` is defined, e.g. `Boy Group · III (debut: 2013-06-13)`
    - Use `escapeHtml` on all user-provided strings
    - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3_

  - [ ]* 3.2 Write unit tests for detail panel header changes
    - Update `createTestDataStore` in `tests/unit/detail-panel.test.ts` to include `koreanName` and `debut`
    - Add test: header shows Korean name in parentheses when `koreanName` is defined
    - Add test: header shows only English name when `koreanName` is undefined
    - Add test: meta shows debut when `debut` is defined
    - Add test: meta shows only type and generation when `debut` is undefined
    - _Requirements: 2.1, 2.2, 4.1, 4.2_

  - [ ]* 3.3 Write property tests for detail panel (Properties 4–5)
    - [ ]* 3.3.1 Property 4: Conditional Korean name display
      - **Property 4: Conditional Korean name display**
      - **Validates: Requirements 2.1, 2.2**
    - [ ]* 3.3.2 Property 5: HTML escaping of user-provided strings
      - **Property 5: HTML escaping of user-provided strings**
      - **Validates: Requirements 2.3**

- [x] 4. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Remove `logo` field from JSON data files and bump version
  - [x] 5.1 Remove `logo` field from all JSON data files in `public/data/`
    - Remove the `"logo": "..."` line from each artist JSON file
    - Do NOT overwrite other fields — the user is actively adding data files
    - _Requirements: 6.1, 6.2_

  - [x] 5.2 Bump version in `package.json` from `0.3.0` to `0.4.0`
    - _Requirements: 8.1_

- [x] 6. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- bts.json already has `korean_name` and `debut` fields — no `logo` field to remove if already cleaned
- The user is actively adding data files — be careful not to overwrite their changes when editing JSON files
- Property tests go in `tests/property/data-loader.property.test.ts` (P1–3) and `tests/property/detail-panel.property.test.ts` (P4–5)
