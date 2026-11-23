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
  CanvasLayer,
} from "./messages.ts";
import { buildPixelPoints, getValueAtDate } from "./pixel-points.ts";
import {
  findFirstPlaceLineId,
  resolveLineOpacity,
  buildActivityLevels,
  activityOpacityFromLevels,
  lastIndexAtOrBefore,
} from "./visibility.ts";

// --- Internal state ---
/** All date strings, indexed by position */
let allDates: string[] = [];
let lines: SerializedLineData[] = [];
let selectedLineIds: Set<string> = new Set();
/** Per-line calendar-day numbers of each change point (parallel to changePoints), for the fade. */
let activityDaysByLine: Map<string, number[]> = new Map();
/** Per filterCount: per-line fade level on each activity day (built lazily, cleared on init). */
let activityLevelsCache: Map<number, Map<string, Float64Array>> = new Map();

function getActivityLevels(lineId: string, days: number[], filterCount: number): Float64Array {
  let perLine = activityLevelsCache.get(filterCount);
  if (!perLine) {
    perLine = new Map();
    activityLevelsCache.set(filterCount, perLine);
  }
  let levels = perLine.get(lineId);
  if (!levels) {
    levels = buildActivityLevels(days, filterCount);
    perLine.set(lineId, levels);
  }
  return levels;
}

// --- Constants ---
const Z_INDEX_DAY_MULTIPLIER = 1_000_000_000;
const MAX_DAYS = 36500;

// --- Helpers ---

/** Calendar-day number of a date index (falls back to the index when unparsable). */
function dayNumber(index: number): number {
  const t = Date.parse(allDates[index] ?? "");
  return isNaN(t) ? index : Math.round(t / 86400000);
}

/**
 * Find the last date index where this line had activity (last change-point date).
 */
function getLastActivityDateIndex(changePoints: [number, number][]): number {
  if (changePoints.length === 0) return -1;
  return changePoints[changePoints.length - 1][0];
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
  const pinnedArtistId =
    visibility.pinnedArtistId && visibility.pinnedArtistId !== "all"
      ? visibility.pinnedArtistId
      : undefined;

  // Clamp currentDateIndex to available range
  const effectiveDateIndex = Math.min(currentDateIndex, allDates.length - 1);

  // Dynamic Y-axis: compute max interpolated between current and next date
  const currentMax = computeMaxAtDate(effectiveDateIndex);
  const nextMax = effectiveDateIndex + 1 < allDates.length
    ? computeMaxAtDate(effectiveDateIndex + 1)
    : currentMax;
  const autoMax = currentMax + (nextMax - currentMax) * viewport.progressToNext;
  // Value-ceiling zoom: cap the y-axis at a fraction of the auto max so the
  // lower cluster of lines expands to fill the height (lines above clip off).
  const ceiling = viewport.valueCeiling ?? 1;
  const frameMaxValue = autoMax * (ceiling > 0 ? ceiling : 1);

  const background: LineDrawCommand[] = [];
  const foreground: LineDrawCommand[] = [];
  const highlight: LineDrawCommand[] = [];

  // Find the #1 line (highest cumulative value at current date) — never dims.
  // Recomputed every frame, so immunity ends the instant it's surpassed.
  const firstPlaceLineId = findFirstPlaceLineId(
    lines
      .filter(line => line.changePoints.length > 0)
      .map(line => ({ lineId: line.lineId, value: getValueAtDate(line.changePoints, effectiveDateIndex) })),
  );

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

    // Causal: the latest activity on or before the current date (the final
    // change point can lie in the future when the line re-charts later).
    const activityDays = activityDaysByLine.get(line.lineId) ?? [];
    const currentDay = dayNumber(effectiveDateIndex);
    const causalIdx = lastIndexAtOrBefore(activityDays, currentDay);
    const daysSinceActivity = causalIdx < 0 ? 0 : currentDay - activityDays[causalIdx];
    const activityOpacity = activityOpacityFromLevels(
      activityDays,
      getActivityLevels(line.lineId, activityDays, visibility.filterCount),
      currentDay,
      visibility.filterCount,
    );
    const lifetimePoints = getValueAtDate(line.changePoints, effectiveDateIndex);

    // Skip lines with 0 lifetime points UNLESS they're upcoming (about to appear)
    if (lifetimePoints <= 0 && !isUpcoming) continue;

    const isSelected = selectedLineIds.has(line.lineId);
    const isPinnedArtist =
      pinnedArtistId !== undefined && line.artistId === pinnedArtistId;

    // Compute visibility (see resolveLineOpacity for the override order)
    let opacity = resolveLineOpacity({
      isSelected,
      isPinnedArtist,
      isFirstPlace: line.lineId === firstPlaceLineId,
      artistFilterActive: visibility.artistFilterActive,
      daysSinceActivity,
      filterCount: visibility.filterCount,
      activityOpacity,
    });

    if (opacity <= 0 && !isSelected && !isPinnedArtist) continue;

    // Apply selection dimming: if any line is selected, non-selected lines get
    // ×0.08. The pinned artist is exempt so it stays fully visible.
    if (selectedLineIds.size > 0 && !isSelected && !isPinnedArtist) {
      opacity *= 0.08;
    }

    const layer = assignLayer(opacity, isSelected);
    // The pinned artist draws above normal lines (so it isn't buried) but below
    // clicked selections. It stays off the highlight layer and keeps the normal
    // line width — it is "always visible", not "highlighted".
    const zIndex = isSelected
      ? Infinity
      : isPinnedArtist
        ? Number.MAX_SAFE_INTEGER
        : computeZIndex(daysSinceActivity, lifetimePoints);

    // Build pixel coordinates
    const { points, values } = buildPixelPoints(line.changePoints, viewport, frameMaxValue, allDates.length);
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
      // Ascending, finite calendar-day numbers of each line's activity.
      activityDaysByLine = new Map(lines.map(l => {
        const days: number[] = [];
        for (const cp of l.changePoints) {
          const d = Array.isArray(cp) ? dayNumber(cp[0]) : NaN;
          if (Number.isFinite(d) && (days.length === 0 || d > days[days.length - 1])) days.push(d);
        }
        return [l.lineId, days] as [string, number[]];
      }));
      activityLevelsCache = new Map();
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
