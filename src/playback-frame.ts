/**
 * Pure helpers for the line-chart playback animation loop.
 *
 * Extracted so the end-of-playback / scrubber-sync logic can be unit tested
 * without the canvas + requestAnimationFrame machinery in LineChartController.
 */

export interface FrameAdvance {
  /** Clamped floating-point animation position for this frame. */
  position: number;
  /** Integer date index derived from the position. */
  index: number;
  /** True once the animation has reached (or passed) the last date. */
  reachedEnd: boolean;
  /**
   * Whether this frame should emit a `date:change`. On the final frame we emit
   * even when the integer index did not change, otherwise the scrubber (driven
   * by date:change) never advances to the last position and stops short of the
   * right edge.
   */
  shouldEmit: boolean;
}

/**
 * Resolve one animation frame: clamp the raw position to the valid range,
 * derive the integer index, and decide whether a date:change should fire.
 *
 * @param rawPosition   the advanced (possibly overshot) float position
 * @param prevIndex     the integer index before this frame
 * @param maxIndex      the last valid date index (dates.length - 1)
 */
export function resolveFrameAdvance(
  rawPosition: number,
  prevIndex: number,
  maxIndex: number,
): FrameAdvance {
  const reachedEnd = rawPosition >= maxIndex;
  const position = reachedEnd ? maxIndex : rawPosition;
  const index = Math.max(0, Math.floor(position));
  // Emit when the integer index moved, OR on the final frame so the scrubber
  // lands exactly on maxIndex even if prevIndex already equals it.
  const shouldEmit = index >= 0 && (index !== prevIndex || reachedEnd);
  return { position, index, reachedEnd, shouldEmit };
}

/**
 * Global race playback speed-up. Every pace in the race animation (base
 * dates/sec, the faster first step, the empty-day boost, and the 1-5 key
 * speed presets) is scaled by this ONE constant. 1 = original pace, 6 = default (6x faster).
 */
export const RACE_SPEED_MULTIPLIER = 6;

/** Original first-step (D0 to D1) speed in dates per second. */
export const FIRST_STEP_SPEED = 2.0;
/** Extra boost through dates with no chart data. */
export const EMPTY_DAY_MULTIPLIER = 2.5;

/**
 * Upper bound on how far the position may advance in one frame. Keeping it at
 * one date guarantees every date is processed (date:change emitted, line
 * extended one day at a time) even at high multipliers or after a frame stall.
 * Do not raise above 1: that reintroduces skipped date:change events (lost wins,
 * labels, dots). Trade-off: pace tops out at one date per frame, and a stall
 * loses time instead of catching up.
 */
export const MAX_FRAME_ADVANCE = 1;

/**
 * How far (in date-index units) the animation position advances for one frame.
 *
 * @param deltaMs        wall-clock ms since the previous frame
 * @param baseSpeed      user-selected speed in dates/sec (before scaling)
 * @param isFirstStep    true while position < 1 (D0 to D1)
 * @param nextDateEmpty  true when the next date has no chart data
 */
export function computeFrameAdvance(
  deltaMs: number,
  baseSpeed: number,
  isFirstStep: boolean,
  nextDateEmpty: boolean,
): number {
  const speed = isFirstStep ? FIRST_STEP_SPEED : baseSpeed;
  const boost = nextDateEmpty ? EMPTY_DAY_MULTIPLIER : 1.0;
  const advance = (deltaMs / 1000) * speed * boost * RACE_SPEED_MULTIPLIER;
  return Math.min(advance, MAX_FRAME_ADVANCE);
}
