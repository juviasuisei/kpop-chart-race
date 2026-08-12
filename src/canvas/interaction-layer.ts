/**
 * InteractionLayer — Mouse/touch event handling for the line chart canvas.
 *
 * Converts raw pointer events into semantic interactions:
 *   - Hover (mousemove → nearest line lookup via spatial index)
 *   - Click/tap (select a line, with shift/ctrl for multi-select)
 *   - Pan (drag when paused to scroll the time window)
 *   - Pinch-to-zoom (two-finger gesture on touch devices)
 *
 * All coordinates are in CSS pixels (not physical/DPR-scaled).
 */

import type { SpatialIndex } from "./spatial-index.ts";

export class InteractionLayer {
  private canvas: HTMLCanvasElement;
  private spatialIndex: SpatialIndex;
  private mounted = false;

  // Gesture state
  private isPanning = false;
  private lastPanX = 0;
  private pinchStartDistance = 0;
  private pinchActive = false;
  private hoveredLineId: string | null = null;

  // Callbacks
  onHover: ((lineId: string | null, x: number, y: number) => void) | null = null;
  onClick: ((lineId: string | null, multiSelect: boolean) => void) | null = null;
  onPanStart: (() => void) | null = null;
  onPan: ((deltaX: number) => void) | null = null;
  onPanEnd: (() => void) | null = null;
  onPinchZoom: ((scaleFactor: number, centerX: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, spatialIndex: SpatialIndex) {
    this.canvas = canvas;
    this.spatialIndex = spatialIndex;
  }

  mount(): void {
    if (this.mounted) return;

    // Mouse events
    this.canvas.addEventListener("mousemove", this.handleMouseMove);
    this.canvas.addEventListener("mousedown", this.handleMouseDown);
    this.canvas.addEventListener("mouseup", this.handleMouseUp);
    this.canvas.addEventListener("mouseleave", this.handleMouseLeave);

    // Touch events
    this.canvas.addEventListener("touchstart", this.handleTouchStart, { passive: false });
    this.canvas.addEventListener("touchmove", this.handleTouchMove, { passive: false });
    this.canvas.addEventListener("touchend", this.handleTouchEnd);
    this.canvas.addEventListener("touchcancel", this.handleTouchEnd);

    // Prevent context menu on long press
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.mounted = true;
  }

  destroy(): void {
    if (!this.mounted) return;

    this.canvas.removeEventListener("mousemove", this.handleMouseMove);
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    this.canvas.removeEventListener("mouseup", this.handleMouseUp);
    this.canvas.removeEventListener("mouseleave", this.handleMouseLeave);
    this.canvas.removeEventListener("touchstart", this.handleTouchStart);
    this.canvas.removeEventListener("touchmove", this.handleTouchMove);
    this.canvas.removeEventListener("touchend", this.handleTouchEnd);
    this.canvas.removeEventListener("touchcancel", this.handleTouchEnd);

    this.mounted = false;
  }

  // --- Mouse handlers ---

  private handleMouseMove = (e: MouseEvent): void => {
    if (this.isPanning) {
      const deltaX = e.clientX - this.lastPanX;
      this.lastPanX = e.clientX;
      this.onPan?.(deltaX);
      return;
    }

    const { x, y } = this.getCanvasCoords(e);
    const hits = this.spatialIndex.query(x, y);
    const topHit = hits.length > 0 ? hits[0].lineId : null;

    if (topHit !== this.hoveredLineId) {
      this.hoveredLineId = topHit;
      this.canvas.style.cursor = topHit ? "pointer" : "grab";
    }

    this.onHover?.(topHit, x, y);
  };

  private handleMouseDown = (e: MouseEvent): void => {
    // Right-click or middle-click → ignore
    if (e.button !== 0) return;

    const { x, y } = this.getCanvasCoords(e);
    const hits = this.spatialIndex.query(x, y);

    if (hits.length > 0) {
      // Clicked on a line — will handle on mouseup (to distinguish click from drag)
      return;
    }

    // Start panning (clicked on empty area)
    this.isPanning = true;
    this.lastPanX = e.clientX;
    this.canvas.style.cursor = "grabbing";
    this.onPanStart?.();
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = this.hoveredLineId ? "pointer" : "grab";
      this.onPanEnd?.();
      return;
    }

    // Click on a line
    const { x, y } = this.getCanvasCoords(e);
    const hits = this.spatialIndex.query(x, y);
    const multiSelect = e.shiftKey || e.ctrlKey || e.metaKey;

    if (hits.length > 0) {
      this.onClick?.(hits[0].lineId, multiSelect);
    } else {
      this.onClick?.(null, false);
    }
  };

  private handleMouseLeave = (): void => {
    if (this.isPanning) {
      this.isPanning = false;
      this.onPanEnd?.();
    }
    if (this.hoveredLineId) {
      this.hoveredLineId = null;
      this.onHover?.(null, 0, 0);
    }
    this.canvas.style.cursor = "grab";
  };

  // --- Touch handlers ---

  private touchStartPos = { x: 0, y: 0 };
  private touchMoved = false;

  private handleTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      // Pinch gesture
      e.preventDefault();
      this.pinchActive = true;
      this.pinchStartDistance = this.getTouchDistance(e.touches);
      this.isPanning = false;
      return;
    }

    if (e.touches.length === 1) {
      e.preventDefault();
      const touch = e.touches[0];
      this.touchStartPos = { x: touch.clientX, y: touch.clientY };
      this.touchMoved = false;
      this.lastPanX = touch.clientX;
    }
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (this.pinchActive && e.touches.length === 2) {
      e.preventDefault();
      const newDistance = this.getTouchDistance(e.touches);
      const scaleFactor = newDistance / this.pinchStartDistance;
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const rect = this.canvas.getBoundingClientRect();
      this.onPinchZoom?.(scaleFactor, centerX - rect.left);
      this.pinchStartDistance = newDistance;
      return;
    }

    if (e.touches.length === 1) {
      e.preventDefault();
      const touch = e.touches[0];
      const dx = touch.clientX - this.touchStartPos.x;
      const dy = touch.clientY - this.touchStartPos.y;

      // Start panning after 5px movement
      if (!this.isPanning && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        this.isPanning = true;
        this.touchMoved = true;
        this.onPanStart?.();
      }

      if (this.isPanning) {
        const deltaX = touch.clientX - this.lastPanX;
        this.lastPanX = touch.clientX;
        this.onPan?.(deltaX);
      }
    }
  };

  private handleTouchEnd = (e: TouchEvent): void => {
    if (this.pinchActive) {
      if (e.touches.length < 2) {
        this.pinchActive = false;
      }
      return;
    }

    if (this.isPanning) {
      this.isPanning = false;
      this.onPanEnd?.();
      return;
    }

    // Tap (no movement)
    if (!this.touchMoved && e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      const { x, y } = this.getCanvasCoordsFromTouch(touch);
      const hits = this.spatialIndex.query(x, y);

      if (hits.length > 0) {
        this.onClick?.(hits[0].lineId, false);
      } else {
        this.onClick?.(null, false);
      }
    }

    this.touchMoved = false;
  };

  // --- Utilities ---

  private getCanvasCoords(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private getCanvasCoordsFromTouch(touch: Touch): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }

  private getTouchDistance(touches: TouchList): number {
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
