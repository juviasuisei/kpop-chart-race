/**
 * Chart computation Web Worker entry point.
 *
 * Receives data and viewport parameters from the main thread, computes
 * visibility/dimming, z-index ordering, and maps cumulative values to
 * pixel coordinates. Returns draw commands grouped by canvas layer.
 *
 * All heavy computation (sorting 10K+ lines, coordinate mapping, LOD
 * downsampling) happens here to keep the main thread free for 60fps rendering.
 */

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  SerializedLineData,
  ComputeFrameMessage,
  LineDrawCommand,
  PixelPoint,
  Viewport,
  CanvasLayer,
} from "./messages.ts";

// --- Internal state ---
/** All date strings, indexed by position */
let allDates: string[] = [];
let lines: SerializedLineData[] = [];
let selectedLineIds: Set<string> = new Set();

// --- Constants ---
const FADE_START_DAYS = 7;
const BASE_FADE_END_DAYS = 28;
const Z_INDEX_DAY_MULTIPLIER = 1_000_000_000;
const MAX_DAYS = 36500;

// --- Helpers ---

/**
 * Compute the number of calendar days between two date indices.
 * Uses the actual date strings from allDates for accurate day counting.
 */
function calendarDaysBetween(fromIndex: number, toIndex: number): number {
  if (fromIndex >= toIndex) return 0;
  if (fromIndex < 0 || toIndex >= allDates.length) return 0;

  const fromDate = allDates[fromIndex];
  const toDate = allDates[toIndex];
  if (!fromDate || !toDate) return 0;

  // Parse YYYY-MM-DD strings to compute day difference
  const from = Date.parse(fromDate);
  const to = Date.parse(toDate);
  if (isNaN(from) || isNaN(to)) return toIndex - fromIndex; // fallback to index diff

  return Math.round((to - from) / 86400000);
}

/**
 * Binary search for the last change-point at or before a given date index.
 * Returns the cumulative value at that point (flat-line interpolation).
 */
function getValueAtDate(changePoints: [number, number][], dateIndex: number): number {
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
 * Find the last date index where this line had activity (last change-point date).
 */
function getLastActivityDateIndex(changePoints: [number, number][]): number {
  if (changePoints.length === 0) return -1;
  return changePoints[changePoints.length - 1][0];
}

/**
 * Compute opacity based on days since last activity and filter ceiling.
 */
function computeOpacity(daysSinceActivity: number, filterCount: number): number {
  const ceiling = BASE_FADE_END_DAYS * Math.pow(2, filterCount);
  if (daysSinceActivity <= FADE_START_DAYS) return 1.0;
  if (daysSinceActivity >= ceiling) return 0.0;
  return 1.0 - (daysSinceActivity - FADE_START_DAYS) / (ceiling - FADE_START_DAYS);
}

/**
 * Compute z-index for draw ordering.
 * Lower daysSinceActivity = higher z-index (drawn on top).
 * Tie-break: higher lifetime points = higher z-index.
 */
function computeZIndex(daysSinceActivity: number, lifetimePoints: number): number {
  return (MAX_DAYS - daysSinceActivity) * Z_INDEX_DAY_MULTIPLIER + lifetimePoints;
}

/**
 * Determine which layer a line belongs to based on its state.
 */
function assignLayer(opacity: number, isSelected: boolean): CanvasLayer {
  if (isSelected) return "highlight";
  return opacity > 0.5 ? "foreground" : "background";
}

/**
 * Extract visible points for a line within the viewport, mapping to pixel coords.
 * Returns both pixel points and corresponding cumulative values.
 */
function buildPixelPoints(
  changePoints: [number, number][],
  viewport: Viewport,
  maxValue: number,
): { points: PixelPoint[]; values: number[] } {
  const { startDateIndex, endDateIndex, width, height, progressToNext } = viewport;

  // Compute chart area in CSS pixels (canvas context has DPR transform applied)
  const padding = { top: 40, right: 160, bottom: 40, left: 0 };
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

  // Helper: map a date index to x pixel position
  const dateToX = (dateIdx: number): number => {
    const ratio = (dateIdx - startDateIndex) / totalDateSpan;
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
    const nextValue = nextDateIndex < allDates.length
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

  return { points, values };
}

// Y-axis max recomputed per frame via computeMaxAtDate()

function recomputeGlobalMax(): void {
  // Called on init; kept for potential static-view use
}

/**
 * Compute the max cumulative value across all lines up to a given date index.
 * This is used for dynamic Y-axis scaling during animation.
 */
function computeMaxAtDate(dateIndex: number): number {
  let max = 0;
  for (const line of lines) {
    if (line.changePoints.length === 0) continue;
    const val = getValueAtDate(line.changePoints, dateIndex);
    if (val > max) max = val;
  }
  return max || 1;
}

// --- Frame computation ---

function computeFrame(msg: ComputeFrameMessage): void {
  const startTime = performance.now();
  const { requestId, currentDateIndex, viewport, visibility } = msg;

  // Clamp currentDateIndex to available range
  const effectiveDateIndex = Math.min(currentDateIndex, allDates.length - 1);

  // Dynamic Y-axis: compute max interpolated between current and next date
  const currentMax = computeMaxAtDate(effectiveDateIndex);
  const nextMax = effectiveDateIndex + 1 < allDates.length
    ? computeMaxAtDate(effectiveDateIndex + 1)
    : currentMax;
  const frameMaxValue = currentMax + (nextMax - currentMax) * viewport.progressToNext;

  const background: LineDrawCommand[] = [];
  const foreground: LineDrawCommand[] = [];
  const highlight: LineDrawCommand[] = [];

  interface ScoredLine {
    cmd: LineDrawCommand;
    layer: CanvasLayer;
    zIndex: number;
  }

  const scored: ScoredLine[] = [];

  for (const line of lines) {
    const lastActivity = getLastActivityDateIndex(line.changePoints);
    if (lastActivity < 0) continue; // No data

    // Include lines that haven't started yet but WILL start at the next date
    // (so we can interpolate their tip from 0 toward their first value)
    const firstAppearance = line.changePoints[0][0];
    const isUpcoming = firstAppearance === effectiveDateIndex + 1 && viewport.progressToNext > 0;

    if (firstAppearance > effectiveDateIndex && !isUpcoming) continue;

    const daysSinceActivity = calendarDaysBetween(lastActivity, effectiveDateIndex);
    const lifetimePoints = getValueAtDate(line.changePoints, effectiveDateIndex);

    // Skip lines with 0 lifetime points UNLESS they're upcoming (about to appear)
    if (lifetimePoints <= 0 && !isUpcoming) continue;

    const isSelected = selectedLineIds.has(line.lineId);

    // Compute visibility
    let opacity: number;
    if (isSelected) {
      opacity = 1.0;
    } else if (visibility.artistFilterActive) {
      opacity = 1.0;
    } else {
      opacity = computeOpacity(daysSinceActivity, visibility.filterCount);
    }

    if (opacity <= 0 && !isSelected) continue;

    // Apply selection dimming: if any line is selected, non-selected lines get ×0.08
    if (selectedLineIds.size > 0 && !isSelected) {
      opacity *= 0.08;
    }

    const layer = assignLayer(opacity, isSelected);
    const zIndex = isSelected ? Infinity : computeZIndex(daysSinceActivity, lifetimePoints);

    // Build pixel coordinates
    const { points, values } = buildPixelPoints(line.changePoints, viewport, frameMaxValue);
    if (points.length < 2) continue;

    const lineWidth = isSelected ? 3 : 1.5;

    scored.push({
      cmd: {
        lineId: line.lineId,
        points,
        values,
        color: line.color,
        opacity,
        lineWidth,
      },
      layer,
      zIndex,
    });
  }

  // Sort by z-index ascending (lowest drawn first)
  scored.sort((a, b) => a.zIndex - b.zIndex);

  // Distribute to layers
  for (const { cmd, layer } of scored) {
    switch (layer) {
      case "background":
        background.push(cmd);
        break;
      case "foreground":
        foreground.push(cmd);
        break;
      case "highlight":
        highlight.push(cmd);
        break;
    }
  }

  const computeTimeMs = performance.now() - startTime;

  const result: WorkerToMainMessage = {
    type: "frame-result",
    requestId,
    background,
    foreground,
    highlight,
    totalLines: scored.length,
    computeTimeMs,
  };

  self.postMessage(result);
}

// --- Message handler ---

// Signal ready immediately on worker startup
const startupReady: WorkerToMainMessage = { type: "worker-ready" };
self.postMessage(startupReady);

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case "init-data": {
      allDates = msg.dates;
      lines = msg.lines;
      selectedLineIds = new Set();
      recomputeGlobalMax();

      const ready: WorkerToMainMessage = { type: "worker-ready" };
      self.postMessage(ready);
      break;
    }

    case "compute-frame": {
      computeFrame(msg);
      break;
    }

    case "update-viewport": {
      // Viewport-only update — recompute with last known params
      // For now just acknowledge; full implementation in Phase 2
      const ready: WorkerToMainMessage = { type: "worker-ready" };
      self.postMessage(ready);
      break;
    }

    case "selection-change": {
      selectedLineIds = new Set(msg.selectedLineIds);
      break;
    }
  }
};
