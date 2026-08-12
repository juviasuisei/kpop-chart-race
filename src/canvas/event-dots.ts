/**
 * EventDots — Renders event markers on highlighted lines.
 *
 * When a line is selected, dots appear at dates where events occurred:
 *   - 👑 Chart win (crown shape)
 *   - 🎤 Live performance (small filled circle)
 *   - 📊 Chart appearance (tick mark)
 *   - 🎬 MV release (diamond)
 *   - 🎵 Album/single release (large filled circle)
 *
 * Priority (for shape when multiple events on same date):
 *   win > live_performance > chart_performance > mv > release_date
 *
 * All dots are drawn on the highlight layer canvas.
 */

import type { EventType } from "../types.ts";

/** An event dot to render on the canvas */
export interface EventDot {
  /** Date string (YYYY-MM-DD) */
  date: string;
  /** Date index in the global dates array */
  dateIndex: number;
  /** Position in CSS pixels */
  x: number;
  y: number;
  /** Event type (determines shape) */
  type: EventDotType;
  /** All events on this date (for popover display) */
  events: EventInfo[];
}

/** Visual dot type (merged from multiple event types) */
export type EventDotType = "win" | "live" | "chart" | "mv" | "release";

/** Individual event info for popovers */
export interface EventInfo {
  type: EventType | "chart_win";
  date: string;
  url?: string;
  /** For chart wins: source show name */
  source?: string;
}

/** Priority order for dot types (highest priority first) */
const DOT_PRIORITY: EventDotType[] = ["win", "live", "chart", "mv", "release"];

/** Map EventType to EventDotType */
function eventTypeToDotType(type: EventType | "chart_win"): EventDotType {
  switch (type) {
    case "chart_win": return "win";
    case "live_performance": return "live";
    case "chart_performance": return "chart";
    case "mv": return "mv";
    case "release_date": return "release";
    default: return "chart"; // fallback for other types
  }
}

/** Get the highest-priority dot type from a list of events */
function getHighestPriorityType(events: EventInfo[]): EventDotType {
  let best: EventDotType = "chart";
  let bestPriority = DOT_PRIORITY.length;

  for (const event of events) {
    const dotType = eventTypeToDotType(event.type);
    const priority = DOT_PRIORITY.indexOf(dotType);
    if (priority >= 0 && priority < bestPriority) {
      bestPriority = priority;
      best = dotType;
    }
  }

  return best;
}

/** Dot colors by type */
const DOT_COLORS: Record<EventDotType, string> = {
  win: "#FFD700",    // Gold
  live: "#FF6B6B",   // Coral red
  chart: "#4ECDC4",  // Teal
  mv: "#A855F7",     // Purple
  release: "#3B82F6", // Blue
};

/** Dot radius by type (CSS pixels) */
const DOT_RADIUS: Record<EventDotType, number> = {
  win: 7,
  live: 4,
  chart: 3,
  mv: 5,
  release: 6,
};

/**
 * Draw event dots on the highlight canvas for a selected line.
 */
export function drawEventDots(
  ctx: CanvasRenderingContext2D,
  dots: EventDot[],
  dpr: number,
): void {
  for (const dot of dots) {
    drawDot(ctx, dot, dpr);
  }
}

/**
 * Draw a single event dot.
 */
function drawDot(ctx: CanvasRenderingContext2D, dot: EventDot, dpr: number): void {
  const color = DOT_COLORS[dot.type];
  const radius = DOT_RADIUS[dot.type] * dpr;
  const x = dot.x * dpr;
  const y = dot.y * dpr;

  ctx.save();

  switch (dot.type) {
    case "win":
      drawCrownDot(ctx, x, y, radius, color);
      break;
    case "mv":
      drawDiamondDot(ctx, x, y, radius, color);
      break;
    case "release":
      drawCircleDot(ctx, x, y, radius, color, true);
      break;
    case "live":
      drawCircleDot(ctx, x, y, radius, color, true);
      break;
    case "chart":
      drawTickDot(ctx, x, y, radius, color);
      break;
  }

  ctx.restore();
}

function drawCircleDot(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, radius: number,
  color: string, filled: boolean,
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (filled) {
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawDiamondDot(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, radius: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawCrownDot(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, radius: number,
  color: string,
): void {
  // Simple crown shape: a filled circle with a small crown silhouette
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw crown points inside
  const r = radius * 0.55;
  ctx.beginPath();
  ctx.moveTo(x - r, y + r * 0.3);
  ctx.lineTo(x - r * 0.5, y - r * 0.5);
  ctx.lineTo(x, y + r * 0.1);
  ctx.lineTo(x + r * 0.5, y - r * 0.5);
  ctx.lineTo(x + r, y + r * 0.3);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();
}

function drawTickDot(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, radius: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x, y + radius);
  ctx.stroke();
}

/**
 * Build event dots for a selected line from the DataStore.
 *
 * @param lineId The selected line ID (format: "artistId::releaseId" for songs, "artistId" for artists)
 * @param dateToX Function mapping date index to X position (CSS pixels)
 * @param dateToY Function mapping date index to Y position (CSS pixels, from the line's cumulative value)
 * @param embeds Map of date → embed entries for this release
 * @param winDates Sorted array of dates when this release won
 * @param viewportStart Viewport start date index (for culling)
 * @param viewportEnd Viewport end date index (for culling)
 * @param allDates All date strings
 */
export function buildEventDots(
  embeds: Map<string, { type: EventType; url: string }[]>,
  winDates: string[],
  dateToX: (dateIndex: number) => number,
  dateToY: (dateIndex: number) => number,
  viewportStart: number,
  viewportEnd: number,
  allDates: string[],
): EventDot[] {
  // Build a map of date → events
  const dateEvents = new Map<string, EventInfo[]>();

  // Add embeds
  for (const [date, entries] of embeds) {
    for (const entry of entries) {
      if (!dateEvents.has(date)) dateEvents.set(date, []);
      dateEvents.get(date)!.push({
        type: entry.type,
        date,
        url: entry.url,
      });
    }
  }

  // Add chart wins
  for (const date of winDates) {
    if (!dateEvents.has(date)) dateEvents.set(date, []);
    dateEvents.get(date)!.push({
      type: "chart_win",
      date,
    });
  }

  // Convert to EventDot array, culling to viewport
  const dots: EventDot[] = [];
  const dateIndexMap = new Map<string, number>();
  for (let i = 0; i < allDates.length; i++) {
    dateIndexMap.set(allDates[i], i);
  }

  for (const [date, events] of dateEvents) {
    const dateIndex = dateIndexMap.get(date);
    if (dateIndex === undefined) continue;
    if (dateIndex < viewportStart || dateIndex > viewportEnd) continue;

    const x = dateToX(dateIndex);
    const y = dateToY(dateIndex);
    const type = getHighestPriorityType(events);

    dots.push({ date, dateIndex, x, y, type, events });
  }

  // Sort by date for consistent rendering
  dots.sort((a, b) => a.dateIndex - b.dateIndex);
  return dots;
}

/**
 * Hit test for event dots. Returns the first dot within the given radius.
 */
export function hitTestDots(
  dots: EventDot[],
  x: number,
  y: number,
  radius = 12,
): EventDot | null {
  const rSq = radius * radius;
  for (const dot of dots) {
    const dx = dot.x - x;
    const dy = dot.y - y;
    if (dx * dx + dy * dy <= rSq) {
      return dot;
    }
  }
  return null;
}
