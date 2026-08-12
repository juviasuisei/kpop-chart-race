/**
 * SpatialIndex — Grid-based spatial lookup for canvas hit detection.
 *
 * Divides the canvas into a grid of cells. Each cell stores the IDs of lines
 * that pass through it. On pointer move/click, the cell under the cursor is
 * looked up and candidate lines are distance-tested for the closest match.
 *
 * This avoids O(n) distance checks against all 10K+ lines on every mouse move.
 *
 * Hit radius is device-aware:
 *   - pointer: fine (mouse) → 8px
 *   - pointer: coarse (touch) → 24px
 */

import type { PixelPoint } from "../worker/messages.ts";

/** A line segment registered in the spatial index */
export interface IndexedLine {
  lineId: string;
  /** Points in CSS pixel space (not physical pixels) */
  points: PixelPoint[];
}

/** Result of a spatial query */
export interface HitResult {
  /** Line ID of the hit */
  lineId: string;
  /** Distance from query point to nearest segment (CSS pixels) */
  distance: number;
  /** Nearest point on the line (for tooltip positioning) */
  nearestPoint: PixelPoint;
}

/** Grid cell containing line IDs that pass through it */
type Cell = Set<string>;

/**
 * Grid-based spatial index for efficient line hit detection.
 */
export class SpatialIndex {
  private cellSize: number;
  private cols = 0;
  private rows = 0;
  private grid: Cell[] = [];
  private lines = new Map<string, PixelPoint[]>();

  /** Current canvas width (for diagnostics) */
  width = 0;
  /** Current canvas height (for diagnostics) */
  height = 0;

  /** Default hit tolerance in CSS pixels for fine pointer (mouse) */
  static readonly HIT_RADIUS_FINE = 8;
  /** Default hit tolerance in CSS pixels for coarse pointer (touch) */
  static readonly HIT_RADIUS_COARSE = 24;

  /**
   * @param cellSize Grid cell size in CSS pixels. Smaller = more precise but more memory.
   *                 Default 32px balances memory and lookup speed for typical chart sizes.
   */
  constructor(cellSize = 32) {
    this.cellSize = cellSize;
  }

  /**
   * Rebuild the index for the given canvas dimensions.
   * Call this on resize before re-inserting lines.
   */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.cols = Math.ceil(width / this.cellSize) || 1;
    this.rows = Math.ceil(height / this.cellSize) || 1;
    this.clear();
  }

  /**
   * Remove all lines from the index.
   */
  clear(): void {
    const totalCells = this.cols * this.rows;
    this.grid = new Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      this.grid[i] = new Set();
    }
    this.lines.clear();
  }

  /**
   * Insert a line into the index. Points should be in CSS pixel space.
   */
  insert(line: IndexedLine): void {
    const { lineId, points } = line;
    if (points.length < 2) return;

    this.lines.set(lineId, points);

    // Rasterize each segment into grid cells using Bresenham-style walking
    for (let i = 0; i < points.length - 1; i++) {
      this.rasterizeSegment(lineId, points[i], points[i + 1]);
    }
  }

  /**
   * Batch-insert multiple lines. More efficient than individual inserts
   * when rebuilding the entire index.
   */
  insertAll(lines: IndexedLine[]): void {
    for (const line of lines) {
      this.insert(line);
    }
  }

  /**
   * Query for lines near a point within the given radius.
   * Returns candidates sorted by distance (closest first).
   *
   * @param x Query X in CSS pixels
   * @param y Query Y in CSS pixels
   * @param radius Hit radius in CSS pixels
   */
  query(x: number, y: number, radius?: number): HitResult[] {
    const r = radius ?? this.getDefaultRadius();
    const results: HitResult[] = [];

    // Determine which cells to check (the query point's cell + neighbors within radius)
    const minCol = Math.max(0, Math.floor((x - r) / this.cellSize));
    const maxCol = Math.min(this.cols - 1, Math.floor((x + r) / this.cellSize));
    const minRow = Math.max(0, Math.floor((y - r) / this.cellSize));
    const maxRow = Math.min(this.rows - 1, Math.floor((y + r) / this.cellSize));

    // Collect candidate line IDs from all relevant cells
    const candidates = new Set<string>();
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const cell = this.grid[row * this.cols + col];
        for (const id of cell) {
          candidates.add(id);
        }
      }
    }

    // Distance-test each candidate
    const rSquared = r * r;
    for (const lineId of candidates) {
      const points = this.lines.get(lineId);
      if (!points) continue;

      const nearest = this.nearestPointOnPolyline(x, y, points);
      if (nearest.distSq <= rSquared) {
        results.push({
          lineId,
          distance: Math.sqrt(nearest.distSq),
          nearestPoint: nearest.point,
        });
      }
    }

    // Sort by distance (closest first)
    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  /**
   * Get the appropriate hit radius based on pointer type.
   */
  getDefaultRadius(): number {
    if (typeof window !== "undefined" && window.matchMedia) {
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      return coarse ? SpatialIndex.HIT_RADIUS_COARSE : SpatialIndex.HIT_RADIUS_FINE;
    }
    return SpatialIndex.HIT_RADIUS_FINE;
  }

  /**
   * Get the number of indexed lines (for diagnostics).
   */
  get size(): number {
    return this.lines.size;
  }

  // --- Private ---

  /**
   * Walk a line segment through grid cells using DDA (Digital Differential Analyzer).
   */
  private rasterizeSegment(lineId: string, p0: PixelPoint, p1: PixelPoint): void {
    const col0 = Math.floor(p0.x / this.cellSize);
    const row0 = Math.floor(p0.y / this.cellSize);
    const col1 = Math.floor(p1.x / this.cellSize);
    const row1 = Math.floor(p1.y / this.cellSize);

    // Bresenham's line algorithm to walk cells
    const dCol = Math.abs(col1 - col0);
    const dRow = Math.abs(row1 - row0);
    const sCol = col0 < col1 ? 1 : -1;
    const sRow = row0 < row1 ? 1 : -1;

    let err = dCol - dRow;
    let col = col0;
    let row = row0;

    // Safety limit to prevent infinite loops on degenerate input
    const maxSteps = dCol + dRow + 1;
    let steps = 0;

    while (steps < maxSteps) {
      steps++;

      // Register this cell if in bounds
      if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
        this.grid[row * this.cols + col].add(lineId);
      }

      if (col === col1 && row === row1) break;

      const e2 = 2 * err;
      if (e2 > -dRow) {
        err -= dRow;
        col += sCol;
      }
      if (e2 < dCol) {
        err += dCol;
        row += sRow;
      }
    }

    // Ensure endpoint cell is registered
    if (col1 >= 0 && col1 < this.cols && row1 >= 0 && row1 < this.rows) {
      this.grid[row1 * this.cols + col1].add(lineId);
    }
  }

  /**
   * Find the nearest point on a polyline to a given point.
   * Returns squared distance and the nearest point on the line.
   */
  private nearestPointOnPolyline(
    px: number,
    py: number,
    points: PixelPoint[],
  ): { distSq: number; point: PixelPoint } {
    let minDistSq = Infinity;
    let closestPoint: PixelPoint = points[0];

    for (let i = 0; i < points.length - 1; i++) {
      const result = this.nearestPointOnSegment(px, py, points[i], points[i + 1]);
      if (result.distSq < minDistSq) {
        minDistSq = result.distSq;
        closestPoint = result.point;
      }
    }

    return { distSq: minDistSq, point: closestPoint };
  }

  /**
   * Find the nearest point on a line segment (p0→p1) to point (px, py).
   */
  private nearestPointOnSegment(
    px: number,
    py: number,
    p0: PixelPoint,
    p1: PixelPoint,
  ): { distSq: number; point: PixelPoint } {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) {
      // Degenerate segment (point)
      const d = (px - p0.x) ** 2 + (py - p0.y) ** 2;
      return { distSq: d, point: p0 };
    }

    // Project point onto line, clamping t to [0, 1]
    let t = ((px - p0.x) * dx + (py - p0.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const nearX = p0.x + t * dx;
    const nearY = p0.y + t * dy;
    const distSq = (px - nearX) ** 2 + (py - nearY) ** 2;

    return { distSq, point: { x: nearX, y: nearY } };
  }
}
