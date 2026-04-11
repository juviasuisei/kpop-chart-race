# Tasks

- [x] 1. Replace CROWN_ICONS with structured CROWN_LEVELS config in detail-panel.ts
  - [x] 1.1 Replace the `CROWN_ICONS` string map with a `CROWN_LEVELS` config object containing icon, label, and cssClass per level
  - [x] 1.2 Update the crown rendering logic in `createTimelineEntry` to produce structured HTML with icon span, label span, and level-specific CSS class
- [x] 2. Add crown level CSS styles in style.css
  - [x] 2.1 Update `.timeline-entry__crown` base styles to use flexbox layout
  - [x] 2.2 Add `.crown--1` through `.crown--5` CSS classes with escalating size, color, and weight
- [x] 3. Update tests for new crown rendering
  - [x] 3.1 Update crown icon test in `tests/unit/detail-panel.test.ts` to verify level-specific CSS classes and label text instead of repeated emoji
  - [x] 3.2 Run all existing tests to confirm no regressions
