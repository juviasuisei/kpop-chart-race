# Crown Visual Escalation Fix Design

## Overview

The `CROWN_ICONS` map in `detail-panel.ts` uses repeated 👑 emoji for all crown levels, making them visually indistinguishable except by count. The design spec requires progressively more elaborate crown icons from level 1 (basic Win) to level 5 (Grand Crown). The fix replaces the repeated emoji approach with structured HTML elements that combine a crown emoji, level-specific CSS classes for size/color styling, and descriptive label text with decorative accents per level.

## Glossary

- **Bug_Condition (C)**: Any timeline entry with `crownLevel` between 1 and 5
- **Property (P)**: Each crown level renders a visually distinct element with unique size, color, and label
- **Preservation**: Non-crown timeline rendering, crown element class name, Triple Crown title attribute, and clamping behavior unchanged

## Bug Details

### Root Cause

The `CROWN_ICONS` constant in `src/detail-panel.ts` maps crown levels to strings of repeated 👑 emoji:

```typescript
const CROWN_ICONS: Record<number, string> = {
  1: "👑",
  2: "👑👑",
  3: "👑👑👑",
  4: "👑👑👑👑",
  5: "👑👑👑👑👑",
};
```

This is set as `textContent` on a plain `<div>`, with no CSS differentiation between levels. The only visual difference is the number of identical emoji, which does not meet the "progressively more elaborate" requirement.

### Fix Approach

Replace the `CROWN_ICONS` string map with a structured `CROWN_LEVELS` configuration that defines per-level: emoji content (with decorative accents), a human-readable label, and a CSS modifier class. The crown element rendering in `createTimelineEntry` will produce styled HTML with level-specific classes instead of plain text.

**Crown Level Configuration:**

| Level | CSS Class   | Icon Content | Label            | Color   | Font Size |
|-------|-------------|-------------|------------------|---------|-----------|
| 1     | `crown--1`  | 👑          | Win              | #a0a0a0 | 0.85rem   |
| 2     | `crown--2`  | 👑          | Double Win       | #d4a017 | 0.95rem   |
| 3     | `crown--3`  | 👑✨        | Triple Crown ✨  | #d4a017 | 1.1rem    |
| 4     | `crown--4`  | 👑💎        | Quad Crown       | #d4a017 | 1.2rem    |
| 5     | `crown--5`  | 👑💎✨      | Grand Crown      | #b8860b | 1.35rem   |

## Correctness Properties

Property 1: Visual Distinction Per Level

_For any_ crown level L in [1..5], the rendered crown element SHALL have a CSS class `crown--{L}` and contain label text unique to that level, ensuring each level is visually distinguishable.

**Validates: Requirements 2.1–2.6**

Property 2: Preservation — No Crown Entries Unchanged

_For any_ timeline entry with crownLevel 0, no crown element SHALL be rendered, identical to pre-fix behavior.

**Validates: Requirements 3.1**

Property 3: Preservation — Triple Crown Title

_For any_ timeline entry with crownLevel 3, the crown element SHALL have `title="Triple Crown"`.

**Validates: Requirements 3.2**

## Fix Implementation

### Changes Required

**File**: `src/detail-panel.ts`

1. Replace the `CROWN_ICONS` map with a `CROWN_LEVELS` configuration:

```typescript
interface CrownConfig {
  icon: string;
  label: string;
  cssClass: string;
}

const CROWN_LEVELS: Record<number, CrownConfig> = {
  1: { icon: "👑", label: "Win", cssClass: "crown--1" },
  2: { icon: "👑", label: "Double Win", cssClass: "crown--2" },
  3: { icon: "👑✨", label: "Triple Crown ✨", cssClass: "crown--3" },
  4: { icon: "👑💎", label: "Quad Crown", cssClass: "crown--4" },
  5: { icon: "👑💎✨", label: "Grand Crown", cssClass: "crown--5" },
};
```

2. Update the crown rendering in `createTimelineEntry` to produce structured HTML:

```typescript
if (item.crownLevel > 0) {
  const level = Math.min(item.crownLevel, 5) as 1 | 2 | 3 | 4 | 5;
  const config = CROWN_LEVELS[level];
  const crownEl = document.createElement("div");
  crownEl.className = `timeline-entry__crown ${config.cssClass}`;

  const iconSpan = document.createElement("span");
  iconSpan.className = "crown__icon";
  iconSpan.textContent = config.icon;
  crownEl.appendChild(iconSpan);

  const labelSpan = document.createElement("span");
  labelSpan.className = "crown__label";
  labelSpan.textContent = config.label;
  crownEl.appendChild(labelSpan);

  if (item.crownLevel === 3) {
    crownEl.title = "Triple Crown";
  }
  entry.appendChild(crownEl);
}
```

**File**: `src/style.css`

Add crown level CSS classes with escalating visual treatment:

```css
/* Crown level base */
.timeline-entry__crown {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 0.25rem;
}

.crown__icon {
  display: inline-block;
}

.crown__label {
  font-weight: 600;
}

/* Level 1: Basic — small, muted */
.crown--1 { font-size: 0.85rem; color: #a0a0a0; }

/* Level 2: Double Win — medium, gold */
.crown--2 { font-size: 0.95rem; color: #d4a017; }

/* Level 3: Triple Crown — larger, gold, sparkle */
.crown--3 { font-size: 1.1rem; color: #d4a017; font-weight: 700; }

/* Level 4: Quad Crown — larger, gold, jewel */
.crown--4 { font-size: 1.2rem; color: #d4a017; font-weight: 700; }

/* Level 5: Grand Crown — largest, dark gold, elaborate */
.crown--5 { font-size: 1.35rem; color: #b8860b; font-weight: 700; }
```

**File**: `tests/unit/detail-panel.test.ts`

Update test #10 (crown icons) to verify the new structured HTML output with level-specific CSS classes and labels instead of checking for repeated emoji text.

## Testing Strategy

### Unit Tests

- Verify crown level 1 renders with class `crown--1` and label "Win"
- Verify crown level 3 renders with class `crown--3`, label "Triple Crown ✨", and `title="Triple Crown"`
- Verify each level produces a unique CSS class
- Verify crownLevel 0 produces no crown element

### Preservation Checking

Run all existing `detail-panel.test.ts` tests (except the updated crown test) to confirm no regressions in panel open/close, timeline entries, embeds, accessibility attributes.
