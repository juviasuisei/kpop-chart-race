/**
 * OffscreenRenderer — Renders the background canvas layer in a Web Worker
 * using OffscreenCanvas for truly off-main-thread drawing.
 *
 * When OffscreenCanvas is supported:
 *   - The background <canvas> transfers control to an OffscreenCanvas
 *   - Draw commands are sent to a dedicated rendering worker
 *   - The main thread is completely free during background layer draws
 *
 * When OffscreenCanvas is NOT supported:
 *   - Falls back to drawing on the main thread (same behavior as CanvasRenderer)
 *
 * This module only handles the background layer because:
 *   - It's the most expensive (thousands of dim lines)
 *   - It updates infrequently (only on filter/viewport changes)
 *   - Foreground/highlight layers need main-thread access for interaction timing
 */

import type { LineDrawCommand } from "../worker/messages.ts";

/** Messages sent to the offscreen rendering worker */
export interface OffscreenDrawMessage {
  type: "draw";
  commands: LineDrawCommand[];
  width: number;
  height: number;
  dpr: number;
}

export interface OffscreenClearMessage {
  type: "clear";
}

export interface OffscreenResizeMessage {
  type: "resize";
  width: number;
  height: number;
  dpr: number;
}

export type OffscreenWorkerMessage =
  | OffscreenDrawMessage
  | OffscreenClearMessage
  | OffscreenResizeMessage;

/**
 * Check if the browser supports OffscreenCanvas with 2D context.
 * Some browsers support OffscreenCanvas but not the 2D context on it.
 */
export function supportsOffscreenCanvas(): boolean {
  if (typeof OffscreenCanvas === "undefined") return false;
  try {
    const test = new OffscreenCanvas(1, 1);
    const ctx = test.getContext("2d");
    return ctx !== null;
  } catch {
    return false;
  }
}

/**
 * Manages OffscreenCanvas rendering for a single canvas layer.
 * Provides the same draw API as the main-thread renderer but executes
 * in a worker when supported.
 */
export class OffscreenLayerRenderer {
  private canvas: HTMLCanvasElement;
  private worker: Worker | null = null;
  private offscreen: OffscreenCanvas | null = null;
  private fallbackCtx: CanvasRenderingContext2D | null = null;
  private useOffscreen: boolean;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.useOffscreen = supportsOffscreenCanvas();
  }

  /**
   * Initialize the renderer. If OffscreenCanvas is supported, transfers
   * canvas control to a worker. Otherwise, gets the standard 2D context.
   */
  init(): void {
    if (this.useOffscreen) {
      try {
        this.offscreen = this.canvas.transferControlToOffscreen();
        this.worker = new Worker(
          new URL("./offscreen-worker.ts", import.meta.url),
          { type: "module" },
        );
        // Transfer the OffscreenCanvas to the worker
        this.worker.postMessage(
          { type: "init", canvas: this.offscreen },
          [this.offscreen],
        );
      } catch {
        // Fallback if transfer fails (e.g., canvas already has a context)
        this.useOffscreen = false;
        this.offscreen = null;
        this.worker = null;
        this.fallbackCtx = this.canvas.getContext("2d");
      }
    } else {
      this.fallbackCtx = this.canvas.getContext("2d");
    }
  }

  /**
   * Whether this renderer is using OffscreenCanvas (true) or main-thread fallback (false).
   */
  get isOffscreen(): boolean {
    return this.useOffscreen && this.worker !== null;
  }

  /**
   * Update dimensions. For OffscreenCanvas, sends a resize message to the worker.
   * For fallback, resizes the canvas directly.
   */
  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;

    if (this.isOffscreen && this.worker) {
      const msg: OffscreenResizeMessage = { type: "resize", width, height, dpr };
      this.worker.postMessage(msg);
    } else if (this.fallbackCtx) {
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
      this.fallbackCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /**
   * Draw line commands. Offscreen path sends to worker; fallback draws directly.
   */
  draw(commands: LineDrawCommand[]): void {
    if (this.isOffscreen && this.worker) {
      const msg: OffscreenDrawMessage = {
        type: "draw",
        commands,
        width: this.width,
        height: this.height,
        dpr: this.dpr,
      };
      this.worker.postMessage(msg);
    } else if (this.fallbackCtx) {
      this.clearFallback();
      this.drawFallback(commands);
    }
  }

  /**
   * Clear the layer.
   */
  clear(): void {
    if (this.isOffscreen && this.worker) {
      const msg: OffscreenClearMessage = { type: "clear" };
      this.worker.postMessage(msg);
    } else if (this.fallbackCtx) {
      this.clearFallback();
    }
  }

  /**
   * Get the fallback context (for cases where main-thread access is needed).
   * Returns null when using OffscreenCanvas.
   */
  getContext(): CanvasRenderingContext2D | null {
    return this.fallbackCtx;
  }

  /**
   * Terminate the worker and clean up resources.
   */
  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.offscreen = null;
    this.fallbackCtx = null;
  }

  // --- Private fallback drawing ---

  private clearFallback(): void {
    if (!this.fallbackCtx) return;
    this.fallbackCtx.save();
    this.fallbackCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.fallbackCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.fallbackCtx.restore();
  }

  private drawFallback(commands: LineDrawCommand[]): void {
    if (!this.fallbackCtx) return;
    const ctx = this.fallbackCtx;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const cmd of commands) {
      if (cmd.points.length < 2 || cmd.opacity <= 0) continue;

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

    ctx.globalAlpha = 1;
  }
}
