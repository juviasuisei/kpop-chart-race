# Design: Crown SVG Rework

## Overview
Replace the emoji-based crown system with custom SVG icons. Each crown level (1-12) maps to a distinct SVG file. Levels beyond 12 display multiple crown-12 icons. All SVGs are colored Korean lucky red (#C8102E). Crown levels are now unbounded.

## CrownConfig Interface
```typescript
interface CrownConfig {
  svgPath: string;  // path to SVG file
  label: string;
  cssClass: string;
}
```

## Crown Level Mapping
- Level 1: crown-1.svg, "Win"
- Level 2: crown-2.svg, "2x Win"
- Level 3: crown-3.svg, "3x Win (Triple Crown)"
- Level 4-12: crown-N.svg, "Nx Win" (with Triple Crown note at 6, 9, 12)
- Level 13+: multiple crown-12.svg icons (count = level - 11), "Nx Win"

## Rendering Logic
- Levels 1-12: single `<img>` tag with corresponding SVG
- Levels 13+: multiple `<img>` tags of crown-12.svg
- Label text always shown next to icon(s)

## ChartEngine Change
- Remove `Math.min(totalWins, 5)` cap in computeChartWins

## CSS Changes
- Remove `.crown--1` through `.crown--5` classes
- Add `.crown__icon img { height: 24px; width: auto; }`

## Testing Framework
- Vitest with jsdom
- fast-check for property-based tests
