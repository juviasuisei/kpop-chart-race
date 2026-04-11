# Tasks: Detail Panel Overhaul

## Task 1: Extract colors to shared module

- [x] 1.1 Create `src/colors.ts` exporting `ARTIST_TYPE_COLORS: Record<ArtistType, string>` with the existing 5-color map
- [ ] 1.2 Update `src/chart-race-renderer.ts` to import `ARTIST_TYPE_COLORS` from `./colors.ts` and remove the local definition
- [ ] 1.3 Update `src/detail-panel.ts` to import `ARTIST_TYPE_COLORS` from `./colors.ts`
- [ ] 1.4 Verify no duplicate `ARTIST_TYPE_COLORS` definitions remain (grep check)

## Task 2: Update detail panel open() signature and main.ts call sites

- [ ] 2.1 Change `DetailPanel.open()` signature to `open(artistId: string, dataStore: DataStore, currentDate?: string): void`
- [ ] 2.2 Import `computeCumulativeValue` from `./chart-engine.ts` in `detail-panel.ts`
- [ ] 2.3 When `currentDate` is provided, compute cumulative value and store it for header rendering
- [ ] 2.4 Update `main.ts` `bar:click` handler to pass `currentSnapshot?.date` as third argument
- [ ] 2.5 Update `main.ts` `pause` handler to pass `currentSnapshot.date` as third argument

## Task 3: Rebuild sticky header

- [ ] 3.1 Restructure the header div: add `position: sticky; top: 0; z-index: 1` via a CSS class `detail-panel__header--sticky`
- [ ] 3.2 Render artist logo (80px) centered with `ARTIST_TYPE_COLORS` background (rounded rect) in the header
- [ ] 3.3 Render artist name (+ Korean name in parentheses if present) centered below logo
- [ ] 3.4 Render type label · generation roman numeral (+ debut date if present) centered below name
- [ ] 3.5 Render cumulative value with locale thousands separators and "pts" suffix (only when `currentDate` was provided)
- [ ] 3.6 Move close button to overlay the sticky header (keep existing z-index behavior)

## Task 4: Restructure timeline (date grouping, reverse chronological, single column)

- [ ] 4.1 Refactor `buildTimelineItems` to return `DateGroup[]` (grouped by date) instead of flat `TimelineItem[]`
- [ ] 4.2 Sort date groups in descending order (newest first)
- [ ] 4.3 Within each date group, sort chart performance items before embed-only items
- [ ] 4.4 Render one date header element per `DateGroup`, with all entries as children below it
- [ ] 4.5 Remove the `side` parameter from `createTimelineEntry` — all entries get full width, centered
- [ ] 4.6 Remove `timeline-entry--left` and `timeline-entry--right` class assignments

## Task 5: Update chart performance display (larger logos, pts suffix, crown above points)

- [ ] 5.1 Change source logo `<img>` from `width=20, height=20` to `width=80, height=80`
- [ ] 5.2 Render episode number as a separate block element centered below the source logo (instead of inline span)
- [ ] 5.3 Append " pts" to the value text content (e.g., "850 pts")
- [ ] 5.4 Move crown element rendering to appear before (above) the value element in DOM order

## Task 6: Crown sizing tiers

- [ ] 6.1 Add exported `getCrownHeight(level: number): number` function: levels 1–6 → 24, 7–9 → 48, 10+ → 72
- [ ] 6.2 Use `getCrownHeight` to set the crown icon `<img>` height attribute in `createTimelineEntry`
- [ ] 6.3 Update crown `<img>` width to `auto` so aspect ratio is preserved

## Task 7: CSS updates

- [ ] 7.1 Change `.detail-panel--desktop` width from `400px` to `500px`
- [ ] 7.2 Add `.detail-panel__header--sticky` styles: `position: sticky; top: 0; z-index: 1; background: #ffffff;`
- [ ] 7.3 Add sticky header layout styles: centered logo with colored background, centered text elements
- [ ] 7.4 Remove `.timeline-entry--left` and `.timeline-entry--right` CSS rules
- [ ] 7.5 Update `.timeline-entry` to full width centered layout (remove `width: 45%`, add `max-width: 100%`)
- [ ] 7.6 Update `.timeline-entry__source-logo` from `20px` to `80px`
- [ ] 7.7 Add crown tier CSS: `.crown__icon--tier-1 img { height: 24px }`, `.crown__icon--tier-2 img { height: 48px }`, `.crown__icon--tier-3 img { height: 72px }`
- [ ] 7.8 Add `.timeline-entry__episode` style for centered episode text below logo

## Task 8: Version bump to 0.8.0

- [ ] 8.1 Update `version` in `package.json` from `"0.7.0"` to `"0.8.0"`

## Task 9: Tests and checkpoint

- [ ] 9.1 Update existing unit tests in `tests/unit/detail-panel.test.ts`: remove left/right alternation test (#6), update value assertions to expect "pts" suffix, update header structure assertions for sticky header
- [ ] 9.2 Update existing property tests in `tests/property/detail-panel.property.test.ts` to work with new `open()` signature (add `currentDate` parameter)
- [ ] 9.3 [PBT] Property 1: Single-column layout — verify no timeline entry has left/right classes for any generated artist data
- [ ] 9.4 [PBT] Property 2: One date header per unique date — verify date header count equals unique date count
- [ ] 9.5 [PBT] Property 3: Reverse chronological date ordering — verify date headers appear in descending order
- [ ] 9.6 [PBT] Property 4: Chart performances before embeds — verify chart entries precede embed entries within each date group
- [ ] 9.7 [PBT] Property 5: Source logos at 80px — verify all source logo images have width=80 and height=80
- [ ] 9.8 [PBT] Property 6: Points display with "pts" suffix — verify all value elements end with "pts"
- [ ] 9.9 [PBT] Property 7: Crown above points — verify crown element precedes value element in DOM
- [ ] 9.10 [PBT] Property 8: Crown height tiers — verify getCrownHeight returns correct tier height for any positive level
- [ ] 9.11 [PBT] Property 9: Header background color matches artist type — verify logo background color matches ARTIST_TYPE_COLORS
- [ ] 9.12 [PBT] Property 10: Cumulative value matches computation — verify displayed value equals computeCumulativeValue output
- [ ] 9.13 Run full test suite (`vitest run`) and verify all tests pass
