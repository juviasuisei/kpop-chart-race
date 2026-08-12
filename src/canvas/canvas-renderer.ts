/**
 * CanvasRenderer — 3-layer canvas system for the line chart.
 *
 * Manages three stacked <canvas> elements:
 *   - Background: dim/inactive lines (redraws only on filter/viewport change)
 *   - Foreground: active lines (redraws every animation frame)
 *   - Highlight: selected lines + event dots (redraws on selection change)
 *
 * Handles DPR scaling, resize observation, and provides a clean API for
 * drawing line commands received from the Web Worker.
 */

import type { LineDrawCommand, CanvasLayer } from "../worker/messages.ts";

/** Configuration for the canvas renderer */
export interface CanvasRendererConfig {
  /** Container element to mount canvases into */
  container: HTMLElement;
  /** Whether to attempt OffscreenCanvas transfer (Phase 1.5) */
  useOffscreen?: boolean;
}

/** Canvas layer state */
interface LayerState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dirty: boolean;
}

/**
 * Manages the 3-layer canvas stack for the line chart visualization.
 */
export class CanvasRenderer {
  private container: HTMLElement;
  private background: LayerState | null = null;
  private foreground: LayerState | null = null;
  private highlight: LayerState | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private mounted = false;

  /** Callback invoked on resize with new dimensions */
  onResize: ((width: number, height: number, dpr: number) => void) | null = null;

  constructor(config: CanvasRendererConfig) {
    this.container = config.container;
  }

  /**
   * Create and mount the canvas elements into the container.
   */
  mount(): void {
    if (this.mounted) return;

    // Ensure container has relative positioning for absolute canvas stacking
    const style = getComputedStyle(this.container);
    if (style.position === "static") {
      this.container.style.position = "relative";
    }

    this.background = this.createLayer("line-chart-bg");
    this.foreground = this.createLayer("line-chart-fg");
    this.highlight = this.createLayer("line-chart-hl");

    // Highlight layer is on top and receives pointer events
    this.background.canvas.style.pointerEvents = "none";
    this.foreground.canvas.style.pointerEvents = "none";
    this.highlight.canvas.style.pointerEvents = "auto";

    this.container.appendChild(this.background.canvas);
    this.container.appendChild(this.foreground.canvas);
    this.container.appendChild(this.highlight.canvas);

    // Initial sizing
    this.updateSize();

    // Watch for resizes
    this.resizeObserver = new ResizeObserver(() => {
      this.updateSize();
    });
    this.resizeObserver.observe(this.container);

    this.mounted = true;
  }

  /**
   * Unmount canvases and clean up observers.
   */
  destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    for (const layer of [this.background, this.foreground, this.highlight]) {
      if (layer?.canvas.parentElement) {
        layer.canvas.parentElement.removeChild(layer.canvas);
      }
    }

    this.background = null;
    this.foreground = null;
    this.highlight = null;
    this.mounted = false;
  }

  /**
   * Clear and redraw the background layer with the given draw commands.
   */
  drawBackground(commands: LineDrawCommand[]): void {
    if (!this.background) return;
    this.clearLayer(this.background);
    this.drawCommands(this.background.ctx, commands);
    this.background.dirty = false;
  }

  /**
   * Clear and redraw the foreground layer with the given draw commands.
   */
  drawForeground(commands: LineDrawCommand[]): void {
    if (!this.foreground) return;
    this.clearLayer(this.foreground);
    this.drawCommands(this.foreground.ctx, commands);
    this.foreground.dirty = false;
  }

  /**
   * Clear and redraw the highlight layer with the given draw commands.
   */
  drawHighlight(commands: LineDrawCommand[]): void {
    if (!this.highlight) return;
    this.clearLayer(this.highlight);
    this.drawCommands(this.highlight.ctx, commands);
    this.highlight.dirty = false;
  }

  /**
   * Clear all three layers.
   */
  clearAll(): void {
    if (this.background) this.clearLayer(this.background);
    if (this.foreground) this.clearLayer(this.foreground);
    if (this.highlight) this.clearLayer(this.highlight);
  }

  /**
   * Mark a layer as needing redraw on next frame.
   */
  markDirty(layer: CanvasLayer): void {
    switch (layer) {
      case "background":
        if (this.background) this.background.dirty = true;
        break;
      case "foreground":
        if (this.foreground) this.foreground.dirty = true;
        break;
      case "highlight":
        if (this.highlight) this.highlight.dirty = true;
        break;
    }
  }

  /**
   * Check if a layer needs redrawing.
   */
  isDirty(layer: CanvasLayer): boolean {
    switch (layer) {
      case "background":
        return this.background?.dirty ?? false;
      case "foreground":
        return this.foreground?.dirty ?? false;
      case "highlight":
        return this.highlight?.dirty ?? false;
    }
  }

  /**
   * Get the highlight canvas element (for attaching event listeners).
   */
  getInteractionCanvas(): HTMLCanvasElement | null {
    return this.highlight?.canvas ?? null;
  }

  /**
   * Get the current logical dimensions (CSS pixels).
   */
  getSize(): { width: number; height: number; dpr: number } {
    return { width: this.width, height: this.height, dpr: this.dpr };
  }

  /**
   * Get a specific layer's context (for advanced custom drawing like event dots).
   */
  getContext(layer: CanvasLayer): CanvasRenderingContext2D | null {
    switch (layer) {
      case "background":
        return this.background?.ctx ?? null;
      case "foreground":
        return this.foreground?.ctx ?? null;
      case "highlight":
        return this.highlight?.ctx ?? null;
    }
  }

  // --- Private ---

  private createLayer(id: string): LayerState {
    const canvas = document.createElement("canvas");
    canvas.id = id;
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    const ctx = canvas.getContext("2d")!;
    return { canvas, ctx, dirty: true };
  }

  private updateSize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const w = rect.width;
    const h = rect.height;

    // Skip if size hasn't changed
    if (w === this.width && h === this.height && dpr === this.dpr) return;

    this.width = w;
    this.height = h;
    this.dpr = dpr;

    for (const layer of [this.background, this.foreground, this.highlight]) {
      if (!layer) continue;
      layer.canvas.width = w * dpr;
      layer.canvas.height = h * dpr;
      // Reset transform after resize (canvas clears automatically)
      layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layer.dirty = true;
    }

    if (this.onResize) {
      this.onResize(w, h, dpr);
    }
  }

  private clearLayer(layer: LayerState): void {
    const { canvas, ctx } = layer;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  private drawCommands(ctx: CanvasRenderingContext2D, commands: LineDrawCommand[]): void {
    for (const cmd of commands) {
      if (cmd.points.length < 2) continue;
      // Skip lines with any point below the chart area (rendering artifacts)
      const maxAllowedY = this.height - 40; // padding.bottom = 40
      if (cmd.points.some(p => p.y > maxAllowedY + 2)) continue;
      this.drawLine(ctx, cmd);
    }
  }

  private drawLine(ctx: CanvasRenderingContext2D, cmd: LineDrawCommand): void {
    const { points, color, opacity, lineWidth } = cmd;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }

    ctx.strokeStyle = color;
    ctx.globalAlpha = opacity;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
