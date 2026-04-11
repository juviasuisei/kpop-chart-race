# Bugfix Requirements Document

## Introduction

Crown icons in the Detail_Panel timeline are visually identical across all crown levels. The `CROWN_ICONS` map in `detail-panel.ts` uses repeated 👑 emoji (e.g., "👑👑👑" for level 3) instead of progressively more elaborate visual treatments per level. This violates the design spec (Requirement 7.11) which calls for each successive Crown_Level to display a "progressively more elaborate crown icon." Users cannot distinguish crown levels at a glance, undermining the visual escalation that communicates achievement progression from a basic Win to the Grand Crown.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a timeline entry has Crown_Level 1 THEN the system displays "👑" (a single crown emoji with no visual distinction indicating it is the basic level).

1.2 WHEN a timeline entry has Crown_Level 2 THEN the system displays "👑👑" (two identical crown emoji repeated), which is not a visually distinct or more elaborate icon.

1.3 WHEN a timeline entry has Crown_Level 3 (Triple Crown) THEN the system displays "👑👑👑" (three identical crown emoji repeated), which does not convey the significance of the Triple Crown achievement.

1.4 WHEN a timeline entry has Crown_Level 4 THEN the system displays "👑👑👑👑" (four identical crown emoji repeated), which is not visually distinguishable as a more ornate crown.

1.5 WHEN a timeline entry has Crown_Level 5 (Grand Crown) THEN the system displays "👑👑👑👑👑" (five identical crown emoji repeated), which does not convey the maximum tier achievement.

1.6 WHEN crown icons are rendered at any level THEN the system applies no CSS styling differentiation (size, color, or decoration) between levels, making them indistinguishable apart from count.

### Expected Behavior (Correct)

2.1 WHEN a timeline entry has Crown_Level 1 THEN the system SHALL display a basic crown representation with a "Win" label, styled small and in a muted color (gray/silver tone).

2.2 WHEN a timeline entry has Crown_Level 2 THEN the system SHALL display a visually distinct crown representation with a "Double Win" label, styled slightly larger and in a gold tone.

2.3 WHEN a timeline entry has Crown_Level 3 (Triple Crown) THEN the system SHALL display a distinctly elaborate crown representation with a "Triple Crown ✨" label, styled larger with a gold color and sparkle accent to convey the significance of the achievement.

2.4 WHEN a timeline entry has Crown_Level 4 THEN the system SHALL display a more ornate crown representation with a "Quad Crown" label, styled larger still with a gold color and jewel accent (💎).

2.5 WHEN a timeline entry has Crown_Level 5 (Grand Crown) THEN the system SHALL display the most elaborate crown representation with a "Grand Crown" label, styled at the largest size with gold color, jewel, and sparkle accents.

2.6 WHEN crown icons are rendered THEN each Crown_Level SHALL be visually distinguishable from all other levels through a combination of size, color, and decorative elements, without relying solely on emoji repetition count.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a timeline entry has no chart win (Crown_Level 0) THEN the system SHALL CONTINUE TO display no crown icon for that entry.

3.2 WHEN a timeline entry has Crown_Level 3 THEN the system SHALL CONTINUE TO set the `title` attribute to "Triple Crown" on the crown element.

3.3 WHEN the Detail_Panel opens for an artist with chart wins THEN the system SHALL CONTINUE TO render crown elements with the CSS class `timeline-entry__crown`.

3.4 WHEN the Detail_Panel renders timeline entries THEN the system SHALL CONTINUE TO display date headings, source info, episode numbers, performance values, and embeds correctly alongside crown icons.

3.5 WHEN crown levels exceed 5 THEN the system SHALL CONTINUE TO clamp to level 5 display (the maximum tier).

---

## Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type TimelineEntry
  OUTPUT: boolean

  // The bug affects all timeline entries that have a crown level >= 1
  // because all levels use indistinguishable repeated emoji
  RETURN X.crownLevel >= 1 AND X.crownLevel <= 5
END FUNCTION
```

## Fix Checking Property

```pascal
// Property: Fix Checking — Each crown level is visually distinct
FOR ALL X WHERE isBugCondition(X) DO
  crownHTML ← renderCrown(X.crownLevel)
  ASSERT crownHTML contains level-specific CSS class "crown--{X.crownLevel}"
  ASSERT crownHTML contains level-specific label text
  ASSERT FOR ALL Y WHERE Y.crownLevel != X.crownLevel DO
    renderCrown(X.crownLevel) != renderCrown(Y.crownLevel)
  END FOR
END FOR
```

## Preservation Checking Property

```pascal
// Property: Preservation Checking — Non-crown timeline behavior unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```
