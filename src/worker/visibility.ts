/**
 * Pure, side-effect-free visibility helpers for the line chart.
 *
 * Extracted from chart-worker.ts so the #1-immunity and inactivity-fade
 * rules can be unit tested without the Web Worker runtime (module-level
 * state + self.postMessage). The worker imports these; behavior is
 * identical to the previous inline implementation.
 */

/** Days of full visibility before the inactivity fade begins. */
export const FADE_START_DAYS = 7;
/** Base number of days at which an inactive line is fully faded out. */
export const BASE_FADE_END_DAYS = 28;

/**
 * Opacity from the inactivity fade alone (ignoring #1 immunity, selection,
 * and artist-filter overrides -- those are applied by resolveLineOpacity).
 *
 * Full opacity for the first FADE_START_DAYS, then a linear ramp down to 0
 * at the ceiling. The ceiling widens with each active filter so that, when
 * the user has narrowed the field, lines stay visible longer.
 */
export function computeInactivityOpacity(daysSinceActivity: number, filterCount: number): number {
  const ceiling = BASE_FADE_END_DAYS * Math.pow(2, filterCount);
  if (daysSinceActivity <= FADE_START_DAYS) return 1.0;
  if (daysSinceActivity >= ceiling) return 0.0;
  return 1.0 - (daysSinceActivity - FADE_START_DAYS) / (ceiling - FADE_START_DAYS);
}

/** A line's identity paired with its cumulative value at the current date. */
export interface LineValue {
  lineId: string;
  value: number;
}

/**
 * Identify the current #1 line: the single line with the highest cumulative
 * value at the current date. Returns null when no line has a positive value.
 *
 * This is intentionally recomputed from current values (not remembered from
 * a prior frame), so the instant another line's value exceeds the leader,
 * the former leader stops being #1 -- which is what makes its inactivity
 * fade "immediately kick in" once it is surpassed. Ties resolve to the
 * first line encountered with the max value; a mere tie is not "surpassing"
 * and does not unseat the incumbent.
 */
export function findFirstPlaceLineId(lineValues: ReadonlyArray<LineValue>): string | null {
  let firstPlaceLineId: string | null = null;
  let firstPlaceValue = 0;
  for (const { lineId, value } of lineValues) {
    if (value > firstPlaceValue) {
      firstPlaceValue = value;
      firstPlaceLineId = lineId;
    }
  }
  return firstPlaceLineId;
}

/** Inputs to the per-line opacity decision. */
export interface LineOpacityInput {
  /** Whether this line is currently selected/highlighted. */
  isSelected: boolean;
  /** Whether this line is the current #1 (see findFirstPlaceLineId). */
  isFirstPlace: boolean;
  /**
   * Whether this line belongs to the pinned artist (Artists-mode filter).
   * Treated like #1 for visibility: never dims. Distinct from isSelected so it
   * does not get the clicked-line highlight styling.
   */
  isPinnedArtist: boolean;
  /** Whether an artist filter is active (forces everything visible). */
  artistFilterActive: boolean;
  /** Days since this line last had chart activity. */
  daysSinceActivity: number;
  /** Number of active non-default filters (widens the fade ceiling). */
  filterCount: number;
}

/**
 * Resolve a line's opacity, applying the visibility overrides in priority
 * order before falling back to the inactivity fade:
 *
 *   1. Selected (clicked) lines are always fully visible.
 *   2. The pinned artist's line is always fully visible -- treated like #1,
 *      but without the clicked-line highlight styling. Kept immune so the
 *      user can always track the artist they filtered to.
 *   3. The current #1 line is always fully visible -- immune from the
 *      inactivity fade for as long as it stays #1. Because #1 is decided
 *      per frame from current values, this immunity vanishes the moment the
 *      line is surpassed, and the normal fade applies again immediately.
 *   4. When an artist filter is active, everything is fully visible.
 *   5. Otherwise, the inactivity fade applies.
 */
export function resolveLineOpacity(input: LineOpacityInput): number {
  if (input.isSelected) return 1.0;
  if (input.isPinnedArtist) return 1.0; // pinned artist never dims
  if (input.isFirstPlace) return 1.0; // #1 never dims from inactivity (until surpassed)
  if (input.artistFilterActive) return 1.0;
  return computeInactivityOpacity(input.daysSinceActivity, input.filterCount);
}
