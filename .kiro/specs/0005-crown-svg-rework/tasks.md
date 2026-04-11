# Tasks: Crown SVG Rework

- [x] 1. Process SVG files — remove attribution text and apply lucky red color
  - [x] 1.1 Remove `<text>` elements from crown-1.svg through crown-9.svg
  - [x] 1.2 Replace all black fills/strokes with #C8102E in all 12 SVGs
- [x] 2. Create CREDITS.md in project root
- [x] 3. Update Crown_Level type and remove cap in ChartEngine
  - [x] 3.1 Remove `Math.min(totalWins, 5)` in src/chart-engine.ts computeChartWins
- [x] 4. Update crown system in detail-panel.ts
  - [x] 4.1 Replace CROWN_LEVELS config with SVG-based CrownConfig
  - [x] 4.2 Update createTimelineEntry rendering for SVG icons and unbounded levels
- [x] 5. Update CSS — simplify crown classes
- [x] 6. Update Thunder Kings sample data with wins up to level 14
- [x] 7. Update tests in tests/unit/detail-panel.test.ts
- [x] 8. Bump version to 0.2.0 and run tests
