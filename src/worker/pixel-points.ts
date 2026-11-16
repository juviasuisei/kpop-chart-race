/**
 * Pure pixel-point construction for one line, split out of chart-worker.ts so
 * it can be unit tested (the worker entry posts messages on import).
 */

import type { PixelPoint, Viewport } from "./messages.ts";

/**
 * Binary search for the last change-point at or before a given date index.
 * Returns the cumulative value at that point (flat-line interpolation).
 */
export function getValueAtDate(changePoints: [number, number][], dateIndex: number): number {
  if (changePoints.length === 0) return 0;

  let lo = 0;
  let hi = changePoints.length - 1;

  // Before first change-point → value is 0
  if (dateIndex < changePoints[0][0]) return 0;

  // Binary search for last entry ≤ dateIndex
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (changePoints[mid][0] <= dateIndex) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return changePoints[lo][1];
}

/**
 * Extract visible points for a line within the viewport, mapping to pixel coords.
 * Returns both pixel points and corresponding cumulative values.
 */
export function buildPixelPoints(
  changePoints: [number, number][],
  viewport: Viewport,
  maxValue: number,
  totalDates: number,
): { points: PixelPoint[]; values: number[] } {
  const { startDateIndex, endDateIndex, width, height, progressToNext } = viewport;
  const scrollOffset = viewport.scrollOffset ?? 0;

  // Compute chart area in CSS pixels (canvas context has DPR transform applied)
  const padding = { top: 40, right: 210, bottom: 40, left: 0 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const effectiveMax = maxValue || 1;

  // The x-axis maps [startDateIndex, endDateIndex + 1] to [0, chartW].
  // This reserves space at the right edge for the animated line tip.
  // endDateIndex maps to a position slightly LEFT of the right edge.
  // The tip extends from endDateIndex toward endDateIndex+1 by progressToNext.
  const totalDateSpan = endDateIndex + 1 - startDateIndex;

  // Special case: first frame (totalDateSpan <= 1)
  if (totalDateSpan <= 1) {
    const val = getValueAtDate(changePoints, endDateIndex);
    if (val <= 0) return { points: [], values: [] };
    // Animate from zero: tip position and value both interpolate with progress
    const tipX = padding.left + progressToNext * chartW;
    const tipValue = val * progressToNext; // rise from 0 to full value
    const bottomY = padding.top + chartH;
    const tipY = padding.top + chartH - (tipValue / effectiveMax) * chartH;
    return {
      points: [{ x: padding.left, y: bottomY }, { x: Math.max(tipX, padding.left + 2), y: tipY }],
      values: [0, Math.round(tipValue)],
    };
  }

  // Helper: map a date index to x pixel position. scrollOffset slides the whole
  // domain left by a fractional day so the chart scrolls smoothly during
  // playback (see Viewport.scrollOffset). The tip's forward progressToNext
  // cancels this offset, keeping the leading edge pinned near the right.
  const dateToX = (dateIdx: number): number => {
    const ratio = (dateIdx - startDateIndex - scrollOffset) / totalDateSpan;
    return padding.left + ratio * chartW;
  };

  // Collect points within viewport range
  const points: PixelPoint[] = [];
  const values: number[] = [];

  // Determine where this line starts relative to the viewport
  const firstChangeIdx = changePoints[0][0];
  const lineStartsBeforeViewport = firstChangeIdx < startDateIndex;

  if (lineStartsBeforeViewport) {
    const startValue = getValueAtDate(changePoints, startDateIndex);
    if (startValue > 0) {
      points.push({
        x: padding.left,
        y: padding.top + chartH - (startValue / effectiveMax) * chartH,
      });
      values.push(startValue);
    }
  } else {
    // Line starts within the viewport — add zero-origin point
    const zeroDateIdx = firstChangeIdx - 1;
    if (zeroDateIdx >= startDateIndex) {
      points.push({ x: dateToX(zeroDateIdx), y: padding.top + chartH });
    } else {
      points.push({ x: padding.left, y: padding.top + chartH });
    }
    values.push(0);
  }

  // Add each change-point up to and including endDateIndex
  for (const [dateIdx, value] of changePoints) {
    if (dateIdx < startDateIndex) continue;
    if (dateIdx > endDateIndex) break;

    points.push({
      x: dateToX(dateIdx),
      y: padding.top + chartH - (value / effectiveMax) * chartH,
    });
    values.push(value);
  }

  // Animated tip: extend from endDateIndex value toward endDateIndex+1 value
  // The tip x-position advances from dateToX(endDateIndex) toward dateToX(endDateIndex+1)
  if (points.length > 0 && progressToNext > 0) {
    const endValue = getValueAtDate(changePoints, endDateIndex);
    const nextDateIndex = endDateIndex + 1;
    const nextValue = nextDateIndex < totalDates
      ? getValueAtDate(changePoints, nextDateIndex)
      : endValue;

    // Interpolate value between current end and next
    const tipValue = endValue + (nextValue - endValue) * progressToNext;
    // Tip x position: between endDateIndex and endDateIndex+1 positions
    const tipX = dateToX(endDateIndex) + (dateToX(endDateIndex + 1) - dateToX(endDateIndex)) * progressToNext;

    points.push({
      x: tipX,
      y: padding.top + chartH - (tipValue / effectiveMax) * chartH,
    });
    values.push(Math.round(tipValue));
  } else if (points.length > 0 && progressToNext === 0) {
    // No progress — just extend flat to endDateIndex position (already there from the loop)
    // Ensure the last point is at endDateIndex position for the label
    const lastPt = points[points.length - 1];
    const endX = dateToX(endDateIndex);
    const endValue = getValueAtDate(changePoints, endDateIndex);
    if (Math.abs(lastPt.x - endX) > 1) {
      points.push({
        x: endX,
        y: padding.top + chartH - (endValue / effectiveMax) * chartH,
      });
      values.push(endValue);
    }
  }

  // Clamp all Y values to stay within chart bounds (never below x-axis)
  const maxY = padding.top + chartH;
  for (const pt of points) {
    if (pt.y > maxY) pt.y = maxY;
  }

  return { points, values };
}
