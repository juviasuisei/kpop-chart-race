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
): { points: PixelPoint[]; values: number[] } {
  const { startDateIndex, endDateIndex, width, height } = viewport;
  const dateRange = endDateIndex - startDateIndex;
  if (dateRange <= 0) return { points: [], values: [] };

  // Compute chart area in CSS pixels (canvas context has DPR transform applied)
  const padding = { top: 40, right: 160, bottom: 40, left: 0 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Find max value across all visible lines for Y scaling
  // (We use a pre-computed global max — simplified here, will be refined)
  const maxValue = globalMaxValue || 1;

  // Collect points within viewport range
  const points: PixelPoint[] = [];
  const values: number[] = [];

  // Add the value at viewport start (interpolated)
  const startValue = getValueAtDate(changePoints, startDateIndex);
  if (startValue > 0 || changePoints.length > 0) {
    points.push({
      x: padding.left,
      y: padding.top + chartH - (startValue / maxValue) * chartH,
    });
    values.push(startValue);
  }

  // Add each change-point within the viewport
  for (const [dateIdx, value] of changePoints) {
    if (dateIdx < startDateIndex) continue;
    if (dateIdx > endDateIndex) break;

    const xRatio = (dateIdx - startDateIndex) / dateRange;
    points.push({
      x: padding.left + xRatio * chartW,
      y: padding.top + chartH - (value / maxValue) * chartH,
    });
    values.push(value);
  }

  // Add the value at viewport end (extend flat line)
  if (changePoints.length > 0) {
    const endValue = getValueAtDate(changePoints, endDateIndex);
    const lastPoint = points[points.length - 1];
    const endX = padding.left + chartW;
    // Only add end point if it differs from the last plotted point
    if (!lastPoint || Math.abs(lastPoint.x - endX) > 1) {
      points.push({
        x: endX,
        y: padding.top + chartH - (endValue / maxValue) * chartH,
      });
      values.push(endValue);
    }
  }

  return { points, values };
}

// Global max value for Y-axis scaling (updated on init and viewport changes)
let globalMaxValue = 0;

function recomputeGlobalMax(): void {
  let max = 0;
  for (const line of lines) {
    if (line.changePoints.length === 0) continue;
    const lastValue = line.changePoints[line.changePoints.length - 1][1];
    if (lastValue > max) max = lastValue;
  }
  globalMaxValue = max;
}

// --- Frame computation ---

function computeFrame(msg: ComputeFrameMessage): void {
  const startTime = performance.now();
  const { requestId, currentDateIndex, viewport, visibility } = msg;

  // Clamp currentDateIndex to available range
  const effectiveDateIndex = Math.min(currentDateIndex, allDates.length - 1);

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

    const daysSinceActivity = Math.max(0, effectiveDateIndex - lastActivity);
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
    const { points, values } = buildPixelPoints(line.changePoints, viewport);
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
  console.log("[Worker] computeFrame: scored", scored.length, "bg:", background.length, "fg:", foreground.length, "hl:", highlight.length, "time:", computeTimeMs.toFixed(1), "ms viewport:", viewport.startDateIndex, "-", viewport.endDateIndex, "currentDate:", effectiveDateIndex);

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
      console.log("[Worker] init-data:", lines.length, "lines,", allDates.length, "dates, globalMax:", globalMaxValue);

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
