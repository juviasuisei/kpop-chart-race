# Requirements: Crown SVG Rework

## Introduction
Rework the crown/win icon system to use custom SVG files instead of emoji icons. Apply Korean lucky red color to all SVGs, remove attribution text from CC-licensed SVGs, create a CREDITS.md file, update the crown system to support unbounded levels with SVG-based icons, and update all related code and tests.

## Requirements

### Requirement 1: SVG Processing
- Remove `<text>` attribution elements from crown-1.svg through crown-9.svg
- Replace all black fills/strokes with Korean lucky red `#C8102E` in all 12 SVGs
- Preserve `fill="none"` attributes unchanged

### Requirement 2: Credits File
- Create CREDITS.md in project root with proper attribution for CC BY 3.0 icons (1-9) and note for licensed icons (10-12)

### Requirement 3: Crown System Update
- Replace emoji-based CROWN_LEVELS with SVG-based CrownConfig using svgPath, label, cssClass
- Levels 1-12 map to crown-1.svg through crown-12.svg
- Levels 13+ repeat crown-12.svg with multiple icons (count = level - 11)
- Labels: "Win", "2x Win", "3x Win (Triple Crown)", etc.
- Remove crown level cap at 5 from ChartEngine

### Requirement 4: CSS Update
- Simplify crown CSS: remove crown--1 through crown--5 classes
- Add `.crown__icon img` sizing (24px height)

### Requirement 5: Test Updates
- Update detail-panel tests for SVG-based crown rendering
- Verify `<img>` tags, labels, and Triple Crown title attribute

### Requirement 6: Sample Data Update
- Extend Thunder Kings data with wins up to level 14 for testing

### Requirement 7: Version Bump
- Update package.json version to 0.2.0
- Verify all tests pass
