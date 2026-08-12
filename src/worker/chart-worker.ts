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
  const { startDateIndex, endDateIndex, width, height } = viewport;
  const dateRange = endDateIndex - startDateIndex;

  // Compute chart area in CSS pixels (canvas context has DPR transform applied)
  const padding = { top: 40, right: 160, bottom: 40, left: 0 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const effectiveMax = maxValue || 1;

  // Special case: single date (first day) — draw line from 0 at left to value at right
  if (dateRange <= 0) {
    const val = getValueAtDate(changePoints, endDateIndex);
    if (val <= 0) return { points: [], values: [] };
    const leftX = padding.left;
    const rightX = padding.left + chartW;
    const bottomY = padding.top + chartH; // Y = 0
    const valueY = padding.top + chartH - (val / effectiveMax) * chartH;
    return {
      points: [{ x: leftX, y: bottomY }, { x: rightX, y: valueY }],
      values: [0, val],
    };
  }

  // Collect points within viewport range
  const points: PixelPoint[] = [];
  const values: number[] = [];

  // Only add a starting point at the left edge if the line was already active
  // BEFORE the viewport start (i.e., it has accumulated value from prior activity)
  const startValue = getValueAtDate(changePoints, startDateIndex);
  const lineStartsBeforeViewport = changePoints.length > 0 && changePoints[0][0] < startDateIndex;
  if (startValue > 0 && lineStartsBeforeViewport) {
    points.push({
      x: padding.left,
      y: padding.top + chartH - (startValue / effectiveMax) * chartH,
    });
    values.push(startValue);
  }

  // If the line starts WITHIN the viewport, add a zero point just before
  // its first change-point so it animates up from the bottom
  const firstInViewport = changePoints.find(([idx]) => idx >= startDateIndex && idx <= endDateIndex);
  if (firstInViewport && !lineStartsBeforeViewport) {
    const zeroDateIdx = Math.max(startDateIndex, firstInViewport[0] - 1);
    const xRatio = (zeroDateIdx - startDateIndex) / dateRange;
    points.push({
      x: padding.left + xRatio * chartW,
      y: padding.top + chartH, // Y = 0 value = bottom of chart
    });
    values.push(0);
  }

  // Add each change-point within the viewport
  for (const [dateIdx, value] of changePoints) {
    if (dateIdx < startDateIndex) continue;
    if (dateIdx > endDateIndex) break;

    const xRatio = (dateIdx - startDateIndex) / dateRange;
    points.push({
      x: padding.left + xRatio * chartW,
      y: padding.top + chartH - (value / effectiveMax) * chartH,
    });
    values.push(value);
  }

  // Add the value at viewport end (extend flat line to the right edge)
  // Only if the line already has points drawn in the viewport
  if (points.length > 0) {
    const endValue = getValueAtDate(changePoints, endDateIndex);
    const lastPoint = points[points.length - 1];
    const endX = padding.left + chartW;
    // Only add end point if it differs from the last plotted point
    if (Math.abs(lastPoint.x - endX) > 1) {
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

  // Dynamic Y-axis: compute max only from data up to current date
  const frameMaxValue = computeMaxAtDate(effectiveDateIndex);

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

    // Skip lines that haven't started yet
    if (line.changePoints[0][0] > effectiveDateIndex) continue;

    const daysSinceActivity = calendarDaysBetween(lastActivity, effectiveDateIndex);
    const lifetimePoints = getValueAtDate(line.changePoints, effectiveDateIndex);
    if (lifetimePoints <= 0) continue;

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

    // Apply selection dimming: if any line is selected, non-selected lines get ×0.2
    if (selectedLineIds.size > 0 && !isSelected) {
      opacity *= 0.2;
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
