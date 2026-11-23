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

/** Per-day step of the fade ramp for a filter count (1 / ramp length). */
function fadeStep(filterCount: number): number {
  const fc = Number.isFinite(filterCount) ? Math.min(10, Math.max(0, Math.floor(filterCount))) : 0;
  return 1 / (BASE_FADE_END_DAYS * Math.pow(2, fc) - FADE_START_DAYS);
}

/**
 * Level after `m` activity-free days that follow an activity day, starting
 * from level `v0` (the level on the activity day itself).
 *
 * After activity the line rises toward 1 at one step per day and, once back at
 * 1, holds until FADE_START_DAYS have passed since the activity, then falls.
 * A fade-in that is still under way is never cut short by the grace timer
 * (falling waits for max(FADE_START_DAYS, days the rise needed)), so a line
 * that was hidden always fades fully in over the same ramp it faded out on.
 * For v0 = 1 this is exactly the legacy fade-out.
 */
function advanceFreeDays(v0: number, m: number, step: number): number {
  if (m <= 0) return v0;
  const need = Math.max(0, Math.ceil((1 - v0) / step - 1e-9));
  const riseDays = Math.min(m, need);
  const vMid = Math.min(1, v0 + riseDays * step);
  const riseEnd = riseDays === need ? need : m;
  const fallDays = Math.max(0, m - Math.max(FADE_START_DAYS, riseEnd));
  return Math.max(0, vMid - fallDays * step);
}

/**
 * Level on each activity day, after that day's own step. `activityDays` must
 * be ascending calendar-day numbers; non-increasing or non-finite entries are
 * ignored. A line starts fully visible.
 */
export function buildActivityLevels(activityDays: ArrayLike<number>, filterCount: number): Float64Array {
  const n = activityDays.length;
  const levels = new Float64Array(n);
  const step = fadeStep(filterCount);
  let v = 1;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const gap = activityDays[i] - activityDays[i - 1];
      if (!(gap > 0)) { levels[i] = v; continue; } // duplicate / unsorted / NaN: no-op
      v = advanceFreeDays(v, gap - 1, step);
      v = Math.min(1, v + step); // the activity day itself
    }
    levels[i] = v;
  }
  return levels;
}

/** Index of the last element <= value in an ascending array, or -1. */
export function lastIndexAtOrBefore(sorted: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Opacity at `currentDay` from precomputed levels (one binary search, O(1) tail). */
export function activityOpacityFromLevels(
  activityDays: ArrayLike<number>,
  levels: Float64Array,
  currentDay: number,
  filterCount: number,
): number {
  const j = lastIndexAtOrBefore(activityDays, currentDay);
  if (j < 0) return 1.0;
  const v = advanceFreeDays(levels[j], currentDay - activityDays[j], fadeStep(filterCount));
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1.0;
}

/**
 * Opacity of a line as of `currentDay`, given the calendar-day numbers of all
 * its activity (ascending). Fades out AND back in, as a pure function of the
 * date (no animation state), so scrubbing to any date gives the right value.
 * Only activity on or before `currentDay` counts (causal). The fade-in ramp
 * has the same length as the fade-out ramp (ceiling - FADE_START_DAYS).
 */
export function computeActivityOpacity(
  activityDays: ArrayLike<number>,
  currentDay: number,
  filterCount: number,
): number {
  return activityOpacityFromLevels(activityDays, buildActivityLevels(activityDays, filterCount), currentDay, filterCount);
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
  /**
   * Precomputed fade level from computeActivityOpacity (fade-out and fade-in).
   * When omitted, the legacy daysSinceActivity fade-out is used.
   */
  activityOpacity?: number;
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
  if (input.activityOpacity !== undefined) return input.activityOpacity;
  return computeInactivityOpacity(input.daysSinceActivity, input.filterCount);
}
