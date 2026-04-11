# Design Document

## Overview

This feature bundles three related housekeeping changes to unblock data entry for the K-Pop Chart Race application:

1. Replace 9 dummy SVG artist logo files with PNG placeholders in `public/assets/logos/`.
2. Update the `logo` field in all 10 artist JSON data files from `.svg` to `.png` paths.
3. Add two new music show chart sources (`m_countdown` and `show_music_core`) to the `ChartSource` type, `KNOWN_CHART_SOURCES`, and `SOURCE_LOGO_MAP`.
4. Fix all existing `SOURCE_LOGO_MAP` entries from `.svg` to `.png` (the actual source logo PNGs already exist in `public/assets/sources/`).
5. Bump `package.json` version from `0.2.3` to `0.3.0`.

No new modules, APIs, or architectural changes are needed. All changes are edits to existing files or 1:1 file replacements.

## Architecture

No architectural changes. The existing module structure remains:

```
src/types.ts          ← ChartSource union type
src/data-loader.ts    ← KNOWN_CHART_SOURCES validation set
src/detail-panel.ts   ← SOURCE_LOGO_MAP record
public/data/*.json    ← artist data files with logo field
public/assets/logos/  ← artist logo image files
public/assets/sources/← source logo image files (already PNG)
package.json          ← version field
```

## Components and Interfaces

### 1. ChartSource Type (`src/types.ts`)

Add two new union members to the existing type:

```typescript
export type ChartSource =
  | "inkigayo"
  | "the_show"
  | "show_champion"
  | "music_bank"
  | "m_countdown"        // NEW
  | "show_music_core";   // NEW
```

### 2. KNOWN_CHART_SOURCES (`src/data-loader.ts`)

Add the two new sources to the validation set:

```typescript
const KNOWN_CHART_SOURCES: ReadonlySet<string> = new Set([
  "inkigayo",
  "the_show",
  "show_champion",
  "music_bank",
  "m_countdown",        // NEW
  "show_music_core",    // NEW
]);
```

### 3. SOURCE_LOGO_MAP (`src/detail-panel.ts`)

Update all existing entries from `.svg` to `.png` and add the two new sources:

```typescript
const SOURCE_LOGO_MAP: Record<string, string> = {
  inkigayo: "assets/sources/inkigayo.png",
  the_show: "assets/sources/the_show.png",
  show_champion: "assets/sources/show_champion.png",
  music_bank: "assets/sources/music_bank.png",
  m_countdown: "assets/sources/m_countdown.png",         // NEW
  show_music_core: "assets/sources/show_music_core.png",  // NEW
};
```

### 4. Artist Logo Files (`public/assets/logos/`)

Delete the 9 existing `.svg` files and create 9 minimal PNG placeholder files with the same base names:

| Remove | Add |
|---|---|
| `aria-bloom.svg` | `aria-bloom.png` |
| `crystal-dream.svg` | `crystal-dream.png` |
| `jay-storm.svg` | `jay-storm.png` |
| `luna-park.svg` | `luna-park.png` |
| `neon-pulse.svg` | `neon-pulse.png` |
| `phoenix-rise.svg` | `phoenix-rise.png` |
| `shadow-blade.svg` | `shadow-blade.png` |
| `stellar-nova.svg` | `stellar-nova.png` |
| `thunder-kings.svg` | `thunder-kings.png` |

Each PNG will be a minimal valid 1×1 pixel PNG (placeholder to be replaced by real logos later).

### 5. Data File Logo Paths (`public/data/*.json`)

Update the `logo` field in each of the 10 artist JSON files (including `bts.json` which currently references `aria-bloom.svg`):

| File | Old value | New value |
|---|---|---|
| `aria-bloom.json` | `assets/logos/aria-bloom.svg` | `assets/logos/aria-bloom.png` |
| `bts.json` | `assets/logos/aria-bloom.svg` | `assets/logos/aria-bloom.png` |
| `crystal-dream.json` | `assets/logos/crystal-dream.svg` | `assets/logos/crystal-dream.png` |
| `galaxy-seven.json` | *(to verify)* | `assets/logos/{slug}.png` |
| `jay-storm.json` | `assets/logos/jay-storm.svg` | `assets/logos/jay-storm.png` |
| `luna-park.json` | `assets/logos/luna-park.svg` | `assets/logos/luna-park.png` |
| `neon-pulse.json` | `assets/logos/neon-pulse.svg` | `assets/logos/neon-pulse.png` |
| `phoenix-rise.json` | `assets/logos/phoenix-rise.svg` | `assets/logos/phoenix-rise.png` |
| `shadow-blade.json` | `assets/logos/shadow-blade.svg` | `assets/logos/shadow-blade.png` |
| `stellar-nova.json` | `assets/logos/stellar-nova.svg` | `assets/logos/stellar-nova.png` |
| `thunder-kings.json` | `assets/logos/thunder-kings.svg` | `assets/logos/thunder-kings.png` |

### 6. Version Bump (`package.json`)

Change `"version": "0.2.3"` to `"version": "0.3.0"`.

## Data Models

No data model changes. The `ArtistEntry` interface and `DailyValueEntry` interface remain unchanged. The `ChartSource` type gains two new string literal members but the runtime shape is the same (a string).

## Error Handling

No new error handling needed. The existing `validateArtistEntry` function already warns on unknown chart sources via `KNOWN_CHART_SOURCES`. Adding the two new sources to that set simply suppresses warnings for valid data.

The `Chart_Race_Renderer` already has an `onerror` fallback on logo `<img>` elements that swaps in a placeholder SVG data URI, so broken PNG paths would degrade gracefully.

## Testing Strategy

### Why Property-Based Testing Does Not Apply

This feature consists entirely of:
- Static file replacements (SVG → PNG)
- String literal changes in source code and JSON data
- Adding members to a TypeScript union type, a `Set`, and a `Record`
- A version string bump

There are no functions with varying input/output behavior, no transformations, no algorithms, and no input space to explore. Property-based testing is not applicable.

### Recommended Test Approach

Example-based unit tests and smoke tests are the right fit:

1. **ChartSource type coverage** — Verify that `m_countdown` and `show_music_core` are accepted by `KNOWN_CHART_SOURCES` (no warning emitted) and that `SOURCE_LOGO_MAP` contains entries for all 6 sources.
2. **SOURCE_LOGO_MAP paths** — Verify every value in `SOURCE_LOGO_MAP` ends with `.png` and none end with `.svg`.
3. **Data file logo paths** — For each JSON file in `public/data/`, verify the `logo` field ends with `.png`.
4. **Data_Loader validation** — Verify that `validateArtistEntry` does not warn for entries using `m_countdown` or `show_music_core` as a source.
5. **Version check** — Verify `package.json` version is `0.3.0`.
6. **Asset existence** — Verify that all 9 PNG logo files exist in `public/assets/logos/` and no SVG logo files remain.

These are all concrete, single-assertion checks — no randomization needed.
