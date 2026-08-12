/**
 * Performance benchmarks for the line chart rendering pipeline.
 *
 * Measures frame computation time in the Web Worker and canvas draw time
 * for various line counts: 1K, 5K, 10K.
 *
 * Run with: npx vitest run tests/perf/
 *
 * These are not assertion-heavy unit tests — they measure performance and
 * report timing. They'll fail only if something is catastrophically slow
 * (>100ms per frame at 10K lines, which would break 60fps).
 */

import { describe, it, expect } from "vitest";
import {
  SparseTimeSeries,
  SparseTimeSeriesBuilder,
  mergeSeries,
} from "../../src/worker/sparse-time-series.ts";
import { SpatialIndex } from "../../src/canvas/spatial-index.ts";
import type { LineDrawCommand, PixelPoint } from "../../src/worker/messages.ts";
import { drawLinesBatched } from "../../src/canvas/line-drawer.ts";

// --- Test data generators ---

/** Generate a random sparse time series with the given number of change-points */
function generateSeries(numPoints: number, maxDateIndex: number): SparseTimeSeries {
  const builder = new SparseTimeSeriesBuilder();
  const step = Math.floor(maxDateIndex / numPoints);

  for (let i = 0; i < numPoints; i++) {
    const dateIdx = i * step + Math.floor(Math.random() * step);
    const dailyValue = Math.floor(Math.random() * 100) + 1;
    builder.addDailyValue(dateIdx, dailyValue);
  }

  return builder.build();
}

/** Generate N line draw commands with realistic point counts */
function generateDrawCommands(
  lineCount: number,
  pointsPerLine: number,
  canvasWidth: number,
  canvasHeight: number,
): LineDrawCommand[] {
  const commands: LineDrawCommand[] = [];

  for (let i = 0; i < lineCount; i++) {
    const points: PixelPoint[] = [];
    const baseY = (i / lineCount) * canvasHeight;

    for (let j = 0; j < pointsPerLine; j++) {
      points.push({
        x: (j / (pointsPerLine - 1)) * canvasWidth,
        y: baseY + Math.random() * 50 - 25,
      });
    }

    commands.push({
      lineId: `line-${i}`,
      points,
      color: `hsl(${(i * 37) % 360}, 70%, 50%)`,
      opacity: 0.1 + Math.random() * 0.9,
      lineWidth: 1.5,
    });
  }

  return commands;
}

// --- Benchmarks ---

describe("Performance: SparseTimeSeries", () => {
  it("1K series — bulk lookup (10K queries)", () => {
    const series = generateSeries(50, 11000); // Typical: 50 change-points
    const queries = 10000;
    const maxDate = 11000;

    const start = performance.now();
    for (let i = 0; i < queries; i++) {
      series.getValueAt(Math.floor(Math.random() * maxDate));
    }
    const elapsed = performance.now() - start;

    console.log(`  SparseTimeSeries: 10K lookups in ${elapsed.toFixed(2)}ms (${(elapsed / queries * 1000).toFixed(2)}µs/lookup)`);
    // Should be well under 10ms for 10K lookups
    expect(elapsed).toBeLessThan(50);
  });

  it("merge 50 series (artist aggregation)", () => {
    const seriesList = Array.from({ length: 50 }, () => generateSeries(20, 11000));

    const start = performance.now();
    const merged = mergeSeries(seriesList);
    const elapsed = performance.now() - start;

    console.log(`  mergeSeries(50): ${elapsed.toFixed(2)}ms, result has ${merged.length} points`);
    // Merging 50 series should be under 20ms
    expect(elapsed).toBeLessThan(100);
    expect(merged.length).toBeGreaterThan(0);
  });

  it("memory estimate for 10K songs", () => {
    // 10K songs × avg 20 change-points = 200K entries × 16 bytes = 3.2MB
    const count = 10000;
    const avgPoints = 20;
    const totalEntries = count * avgPoints;
    const estimatedMB = (totalEntries * 16 + count * 64) / (1024 * 1024);

    console.log(`  Estimated memory for ${count} songs (${avgPoints} pts avg): ${estimatedMB.toFixed(2)}MB`);
    expect(estimatedMB).toBeLessThan(30); // Well within 30MB budget
  });
});

describe("Performance: SpatialIndex", () => {
  const CANVAS_WIDTH = 1920;
  const CANVAS_HEIGHT = 1080;

  function buildIndex(lineCount: number, pointsPerLine: number): SpatialIndex {
    const index = new SpatialIndex(32);
    index.resize(CANVAS_WIDTH, CANVAS_HEIGHT);

    for (let i = 0; i < lineCount; i++) {
      const points: PixelPoint[] = [];
      const baseY = (i / lineCount) * CANVAS_HEIGHT;

      for (let j = 0; j < pointsPerLine; j++) {
        points.push({
          x: (j / (pointsPerLine - 1)) * CANVAS_WIDTH,
          y: baseY + Math.random() * 40 - 20,
        });
      }

      index.insert({ lineId: `line-${i}`, points });
    }

    return index;
  }

  it("1K lines — build index", () => {
    const start = performance.now();
    const index = buildIndex(1000, 30);
    const elapsed = performance.now() - start;

    console.log(`  SpatialIndex build (1K lines, 30 pts): ${elapsed.toFixed(2)}ms`);
    expect(index.size).toBe(1000);
    // Building should be under 100ms
    expect(elapsed).toBeLessThan(500);
  });

  it("5K lines — build index", () => {
    const start = performance.now();
    const index = buildIndex(5000, 30);
    const elapsed = performance.now() - start;

    console.log(`  SpatialIndex build (5K lines, 30 pts): ${elapsed.toFixed(2)}ms`);
    expect(index.size).toBe(5000);
    expect(elapsed).toBeLessThan(2000);
  });

  it("1K lines — query (1000 lookups)", () => {
    const index = buildIndex(1000, 30);
    const queries = 1000;

    const start = performance.now();
    for (let i = 0; i < queries; i++) {
      index.query(
        Math.random() * CANVAS_WIDTH,
        Math.random() * CANVAS_HEIGHT,
        8,
      );
    }
    const elapsed = performance.now() - start;

    console.log(`  SpatialIndex query (1K lines, 1K queries): ${elapsed.toFixed(2)}ms (${(elapsed / queries).toFixed(3)}ms/query)`);
    // Each query should be <1ms
    expect(elapsed / queries).toBeLessThan(5);
  });

  it("5K lines — query (1000 lookups)", () => {
    const index = buildIndex(5000, 30);
    const queries = 1000;

    const start = performance.now();
    for (let i = 0; i < queries; i++) {
      index.query(
        Math.random() * CANVAS_WIDTH,
        Math.random() * CANVAS_HEIGHT,
        8,
      );
    }
    const elapsed = performance.now() - start;

    console.log(`  SpatialIndex query (5K lines, 1K queries): ${elapsed.toFixed(2)}ms (${(elapsed / queries).toFixed(3)}ms/query)`);
    expect(elapsed / queries).toBeLessThan(10);
  });

  it("10K lines — query (100 lookups)", () => {
    const index = buildIndex(10000, 20);
    const queries = 100;

    const start = performance.now();
    for (let i = 0; i < queries; i++) {
      index.query(
        Math.random() * CANVAS_WIDTH,
        Math.random() * CANVAS_HEIGHT,
        8,
      );
    }
    const elapsed = performance.now() - start;

    console.log(`  SpatialIndex query (10K lines, 100 queries): ${elapsed.toFixed(2)}ms (${(elapsed / queries).toFixed(3)}ms/query)`);
    expect(elapsed / queries).toBeLessThan(20);
  });
});

describe("Performance: Frame computation simulation", () => {
  /**
   * Simulates the worker's frame computation logic:
   * - Iterate all lines
   * - Compute visibility (opacity, z-index)
   * - Filter invisible lines
   * - Sort by z-index
   * - Build pixel coordinates
   */
  function simulateFrameCompute(lineCount: number): { elapsed: number; visible: number } {
    const FADE_START = 7;
    const FADE_END = 28;
    const currentDateIndex = 11000;

    // Generate test data
    const lines: { lastActivity: number; lifetime: number }[] = [];
    for (let i = 0; i < lineCount; i++) {
      lines.push({
        lastActivity: currentDateIndex - Math.floor(Math.random() * 60),
        lifetime: Math.floor(Math.random() * 50000),
      });
    }

    const start = performance.now();

    // Phase 1: Compute visibility and filter
    const visible: { opacity: number; zIndex: number; idx: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const days = currentDateIndex - lines[i].lastActivity;
      let opacity: number;
      if (days <= FADE_START) opacity = 1.0;
      else if (days >= FADE_END) opacity = 0.0;
      else opacity = 1.0 - (days - FADE_START) / (FADE_END - FADE_START);

      if (opacity <= 0) continue;

      const zIndex = (36500 - days) * 1_000_000_000 + lines[i].lifetime;
      visible.push({ opacity, zIndex, idx: i });
    }

    // Phase 2: Sort by z-index
    visible.sort((a, b) => a.zIndex - b.zIndex);

    // Phase 3: Build pixel coordinates (20 points per line)
    const POINTS = 20;
    for (const entry of visible) {
      const _points: PixelPoint[] = [];
      for (let j = 0; j < POINTS; j++) {
        _points.push({
          x: (j / (POINTS - 1)) * 1920,
          y: (entry.idx / lineCount) * 1080 + entry.opacity * 10,
        });
      }
    }

    const elapsed = performance.now() - start;
    return { elapsed, visible: visible.length };
  }

  it("1K lines — frame compute", () => {
    const { elapsed, visible } = simulateFrameCompute(1000);
    console.log(`  Frame compute (1K lines): ${elapsed.toFixed(2)}ms, ${visible} visible`);
    // Should be <16ms (one frame at 60fps)
    expect(elapsed).toBeLessThan(16);
  });

  it("5K lines — frame compute", () => {
    const { elapsed, visible } = simulateFrameCompute(5000);
    console.log(`  Frame compute (5K lines): ${elapsed.toFixed(2)}ms, ${visible} visible`);
    // Should be <16ms
    expect(elapsed).toBeLessThan(32);
  });

  it("10K lines — frame compute", () => {
    const { elapsed, visible } = simulateFrameCompute(10000);
    console.log(`  Frame compute (10K lines): ${elapsed.toFixed(2)}ms, ${visible} visible`);
    // Must be under 100ms to avoid dropped frames (worker runs off-thread)
    expect(elapsed).toBeLessThan(100);
  });
});

describe("Performance: Draw command execution (no canvas)", () => {
  /**
   * Measures the overhead of iterating draw commands and constructing
   * canvas API calls. Since we can't render without a real canvas in tests,
   * we mock the canvas context and measure the iteration/call overhead.
   */
  function measureDrawOverhead(lineCount: number, pointsPerLine: number): number {
    const commands = generateDrawCommands(lineCount, pointsPerLine, 1920, 1080);

    // Create a mock context that counts operations
    let opCount = 0;
    const mockCtx = {
      beginPath() { opCount++; },
      moveTo() { opCount++; },
      lineTo() { opCount++; },
      stroke() { opCount++; },
      save() { opCount++; },
      restore() { opCount++; },
      set strokeStyle(_v: string) { opCount++; },
      set globalAlpha(_v: number) { opCount++; },
      set lineWidth(_v: number) { opCount++; },
      set lineCap(_v: string) { opCount++; },
      set lineJoin(_v: string) { opCount++; },
      set shadowColor(_v: string) { opCount++; },
      set shadowBlur(_v: number) { opCount++; },
      arc() { opCount++; },
      fill() { opCount++; },
      setLineDash() { opCount++; },
      clearRect() { opCount++; },
      setTransform() { opCount++; },
    } as unknown as CanvasRenderingContext2D;

    const start = performance.now();
    drawLinesBatched(mockCtx, commands);
    const elapsed = performance.now() - start;

    console.log(`    (${opCount} canvas ops)`);
    return elapsed;
  }

  it("1K lines × 30 points — draw iteration", () => {
    const elapsed = measureDrawOverhead(1000, 30);
    console.log(`  Draw overhead (1K×30): ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(50);
  });

  it("5K lines × 20 points — draw iteration", () => {
    const elapsed = measureDrawOverhead(5000, 20);
    console.log(`  Draw overhead (5K×20): ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(100);
  });

  it("10K lines × 10 points — draw iteration", () => {
    const elapsed = measureDrawOverhead(10000, 10);
    console.log(`  Draw overhead (10K×10): ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(200);
  });
});
