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
