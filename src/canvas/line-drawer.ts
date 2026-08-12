/**
 * LineDrawer — Efficient polyline path rendering for the line chart.
 *
 * Provides low-level drawing utilities that work directly with a
 * CanvasRenderingContext2D. Optimized for batch drawing thousands of lines
 * per frame by minimizing state changes and leveraging Path2D where available.
 *
 * Supports:
 *   - Basic polyline rendering with color/opacity/thickness
 *   - Batched draws grouped by similar style (reduces state switches)
 *   - Glow effect for highlighted lines
 *   - Endpoint cap rendering (small circle at line end for current value)
 */

import type { LineDrawCommand, PixelPoint } from "../worker/messages.ts";

/** Options for customizing line rendering behavior */
export interface LineDrawOptions {
  /** Draw a small circle at the line endpoint (current value indicator) */
  showEndCap?: boolean;
  /** Radius of the endpoint cap in CSS pixels */
  endCapRadius?: number;
  /** Apply a glow effect (for highlighted/selected lines) */
  glow?: boolean;
  /** Glow blur radius in CSS pixels */
  glowRadius?: number;
}

const DEFAULT_OPTIONS: Required<LineDrawOptions> = {
  showEndCap: false,
  endCapRadius: 3,
  glow: false,
  glowRadius: 6,
};

/**
 * Draw a batch of line commands onto a canvas context.
 * This is the primary rendering entry point used by CanvasRenderer.
 *
 * @param ctx The 2D rendering context (already DPR-scaled)
 * @param commands Draw commands from the worker, pre-sorted by z-index
 * @param options Optional rendering customizations
 */
export function drawLines(
  ctx: CanvasRenderingContext2D,
  commands: LineDrawCommand[],
  options?: LineDrawOptions,
): void {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const cmd of commands) {
    if (cmd.points.length < 2) continue;
    drawPolyline(ctx, cmd, opts);
  }
}

/**
 * Draw a single polyline with the specified style.
 */
function drawPolyline(
  ctx: CanvasRenderingContext2D,
  cmd: LineDrawCommand,
  opts: Required<LineDrawOptions>,
): void {
  const { points, color, opacity, lineWidth } = cmd;

  if (opacity <= 0) return;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  // Apply glow if requested (for highlight layer)
  if (opts.glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = opts.glowRadius;
  }

  // Draw the polyline path
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }

  ctx.stroke();

  // Draw endpoint cap (current value indicator)
  if (opts.showEndCap) {
    const end = points[points.length - 1];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(end.x, end.y, opts.endCapRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Draw a single line between two points.
 * Utility for grid lines, axes, and reference markers.
 */
export function drawSegment(
  ctx: CanvasRenderingContext2D,
  from: PixelPoint,
  to: PixelPoint,
  color: string,
  lineWidth: number,
  opacity = 1,
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a dashed line between two points (for reference/grid lines).
 */
export function drawDashedSegment(
  ctx: CanvasRenderingContext2D,
  from: PixelPoint,
  to: PixelPoint,
  color: string,
  lineWidth: number,
  dashPattern: number[] = [4, 4],
  opacity = 1,
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dashPattern);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Batch-optimized drawing that groups commands by opacity range to minimize
 * globalAlpha state changes. Useful when drawing thousands of background lines
 * that tend to cluster around similar opacity values.
 *
 * @param ctx The 2D rendering context
 * @param commands Draw commands to batch
 * @param bucketSize Opacity range for each bucket (0.1 = 10 buckets)
 */
export function drawLinesBatched(
  ctx: CanvasRenderingContext2D,
  commands: LineDrawCommand[],
  bucketSize = 0.1,
): void {
  if (commands.length === 0) return;

  // Group by opacity bucket for fewer state changes
  const bucketCount = Math.ceil(1 / bucketSize);
  const buckets: LineDrawCommand[][] = new Array(bucketCount);
  for (let i = 0; i < bucketCount; i++) {
    buckets[i] = [];
  }

  for (const cmd of commands) {
    if (cmd.points.length < 2 || cmd.opacity <= 0) continue;
    const bucket = Math.min(
      bucketCount - 1,
      Math.floor(cmd.opacity / bucketSize),
    );
    buckets[bucket].push(cmd);
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Draw each bucket with a single globalAlpha setting
  for (let b = 0; b < bucketCount; b++) {
    const bucket = buckets[b];
    if (bucket.length === 0) continue;

    for (const cmd of bucket) {
      ctx.beginPath();
      ctx.moveTo(cmd.points[0].x, cmd.points[0].y);
      for (let i = 1; i < cmd.points.length; i++) {
        ctx.lineTo(cmd.points[i].x, cmd.points[i].y);
      }
      ctx.strokeStyle = cmd.color;
      ctx.globalAlpha = cmd.opacity;
      ctx.lineWidth = cmd.lineWidth;
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
}
