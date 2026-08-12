/**
 * LineChartController — Orchestrates the canvas-based line chart view.
 *
 * Responsibilities:
 *   - Converts DataStore into serialized line data for the worker
 *   - Manages animation loop (rAF) with frame requests to the worker
 *   - Handles viewport state (time window, zoom presets, pan)
 *   - Integrates with FilterStateManager and PlaybackController events
 *   - Manages selection state (highlighted lines) and spatial index
 *   - Renders event dots and popovers on the highlight layer
 *
 * This is the main-thread coordinator between:
 *   - ChartWorkerClient (off-thread computation)
 *   - CanvasRenderer (draws results)
 *   - SpatialIndex (hit detection)
 *   - InteractionLayer (mouse/touch handling)
 */

import { ChartWorkerClient } from "../worker/chart-worker-client.ts";
import { CanvasRenderer } from "../canvas/canvas-renderer.ts";
import { SpatialIndex } from "../canvas/spatial-index.ts";
import { InteractionLayer } from "../canvas/interaction-layer.ts";
import { buildSeriesFromDailyValues, mergeSeries, SparseTimeSeries } from "../worker/sparse-time-series.ts";
import { ARTIST_TYPE_COLORS } from "../colors.ts";
import type { EventBus } from "../event-bus.ts";
import type { DataStore } from "../models.ts";
import type { FilterState } from "../types.ts";
import type { SerializedLineData, FrameResultMessage, Viewport, VisibilityParams } from "../worker/messages.ts";

/** Time zoom presets with their date range widths */
export type TimeZoomPreset = "90d" | "quarter" | "year" | "decade" | "all";

const PRESET_DAYS: Record<TimeZoomPreset, number> = {
  "90d": 90,
  "quarter": 90,
  "year": 365,
  "decade": 3650,
  "all": Infinity,
};

/** State for the line chart view */
interface LineChartState {
  /** All dates from the DataStore */
  dates: string[];
  /** Current animation date index */
  currentDateIndex: number;
  /** Viewport start (left edge of visible time window) */
  viewportStart: number;
  /** Viewport end (right edge of visible time window) */
  viewportEnd: number;
  /** Currently selected time zoom preset */
  timeZoom: TimeZoomPreset;
  /** Whether animation is playing */
  playing: boolean;
  /** Animation speed multiplier */
  speed: number;
  /** Selected/highlighted line IDs */
  selectedLineIds: string[];
  /** Number of active non-default filters */
  filterCount: number;
  /** Whether a specific artist filter is active */
  artistFilterActive: boolean;
  /** Current display mode */
  displayMode: "songs" | "artists";
}

export class LineChartController {
  private eventBus: EventBus;
  private dataStore: DataStore | null = null;
  private workerClient: ChartWorkerClient;
  private renderer: CanvasRenderer | null = null;
  private spatialIndex: SpatialIndex;
  private interaction: InteractionLayer | null = null;

  private state: LineChartState = {
    dates: [],
    currentDateIndex: 0,
    viewportStart: 0,
    viewportEnd: 0,
    timeZoom: "90d",
    playing: false,
    speed: 1,
    selectedLineIds: [],
    filterCount: 0,
    artistFilterActive: false,
    displayMode: "songs",
  };

  /** Map of lineId → metadata for tooltips and selection */
  private lineMetadata = new Map<string, { label: string; artistId: string; releaseId?: string }>();

  /** Animation frame request ID */
  private rafId: number | null = null;
  /** Last frame timestamp for throttling */
  private lastFrameTime = 0;
  /** Whether initial data has been sent to worker */
  private initialized = false;
  /** Background layer needs full redraw */
  private backgroundDirty = true;

  /** Callback for when the controller needs playback to advance */
  onRequestDateAdvance: ((dateIndex: number) => void) | null = null;
  /** Callback for update complete (signals playback controller) */
  onUpdateComplete: (() => void) | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.workerClient = new ChartWorkerClient();
    this.spatialIndex = new SpatialIndex(32);
  }

  /**
   * Mount the line chart into a container element.
   */
  async mount(container: HTMLElement): Promise<void> {
    // Initialize renderer
    this.renderer = new CanvasRenderer({ container });
    this.renderer.mount();
    this.renderer.onResize = this.handleResize;

    // Initialize interaction layer
    this.interaction = new InteractionLayer(
      this.renderer.getInteractionCanvas()!,
      this.spatialIndex,
    );
    this.interaction.onHover = this.handleHover;
    this.interaction.onClick = this.handleClick;
    this.interaction.onPanStart = this.handlePanStart;
    this.interaction.onPan = this.handlePan;
    this.interaction.onPanEnd = this.handlePanEnd;
    this.interaction.onPinchZoom = this.handlePinchZoom;
    this.interaction.mount();

    // Keyboard shortcut: Escape to deselect
    this.handleKeydown = this.handleKeydown.bind(this);
    document.addEventListener("keydown", this.handleKeydown);

    // Initialize worker
    await this.workerClient.init();
    this.workerClient.onFrame(this.handleFrameResult);
  }

  /**
   * Initialize with data and prepare for rendering.
   */
  async initData(dataStore: DataStore): Promise<void> {
    this.dataStore = dataStore;
    this.state.dates = dataStore.dates;

    // Default: show most recent 90 days, paused at the last date
    this.state.currentDateIndex = dataStore.dates.length - 1;
    this.applyTimeZoom("90d");

    // Build serialized line data for the worker
    const lines = this.buildLineData(dataStore, this.state.displayMode);

    // Send to worker
    await this.workerClient.initData(lines, dataStore.dates);
    this.initialized = true;

    // Request initial frame (defer to next frame to ensure layout is settled)
    requestAnimationFrame(() => {
      this.backgroundDirty = true;
      this.requestFrame();
    });
  }

  /**
   * Set the current animation date (called by playback controller).
   */
  setDateIndex(index: number): void {
    this.state.currentDateIndex = index;

    // Auto-scroll viewport if playing and date is near/past the right edge
    if (this.state.playing) {
      this.autoScrollViewport();
    }

    this.requestFrame();
  }

  /**
   * Set whether animation is playing.
   */
  setPlaying(playing: boolean): void {
    this.state.playing = playing;
    if (playing) {
      this.startAnimationLoop();
    } else {
      this.stopAnimationLoop();
    }
  }

  /**
   * Apply a time zoom preset.
   */
  applyTimeZoom(preset: TimeZoomPreset): void {
    this.state.timeZoom = preset;
    const totalDates = this.state.dates.length;

    if (preset === "all" || PRESET_DAYS[preset] >= totalDates) {
      this.state.viewportStart = 0;
      this.state.viewportEnd = totalDates - 1;
    } else {
      const windowSize = PRESET_DAYS[preset];
      // Center on current date
      const center = this.state.currentDateIndex;
      this.state.viewportStart = Math.max(0, center - Math.floor(windowSize / 2));
      this.state.viewportEnd = Math.min(totalDates - 1, this.state.viewportStart + windowSize);
      // Adjust start if we hit the right edge
      if (this.state.viewportEnd === totalDates - 1) {
        this.state.viewportStart = Math.max(0, this.state.viewportEnd - windowSize);
      }
    }

    this.backgroundDirty = true;
    this.requestFrame();
  }

  /**
   * Pan the viewport by a pixel delta (for drag interactions).
   */
  panByPixels(deltaX: number): void {
    if (this.state.playing) return; // No pan during playback

    const { width } = this.renderer!.getSize();
    const viewportRange = this.state.viewportEnd - this.state.viewportStart;
    const dateDelta = Math.round((deltaX / width) * viewportRange);

    const totalDates = this.state.dates.length;
    let newStart = this.state.viewportStart - dateDelta;
    let newEnd = this.state.viewportEnd - dateDelta;

    // Clamp
    if (newStart < 0) {
      newEnd -= newStart;
      newStart = 0;
    }
    if (newEnd >= totalDates) {
      newStart -= (newEnd - totalDates + 1);
      newEnd = totalDates - 1;
    }
    newStart = Math.max(0, newStart);

    this.state.viewportStart = newStart;
    this.state.viewportEnd = newEnd;
    this.backgroundDirty = true;
    this.requestFrame();
  }

  /**
   * Update filters from FilterStateManager.
   */
  setFilters(filterState: FilterState): void {
    let filterCount = 0;
    if (filterState.generation !== "all") filterCount++;
    if (filterState.source !== "all") filterCount++;

    this.state.filterCount = filterCount;
    this.state.artistFilterActive = false; // Will be set by specific artist selection

    // If display mode changed, rebuild line data
    if (filterState.displayMode !== this.state.displayMode) {
      this.state.displayMode = filterState.displayMode;
      if (this.dataStore && this.initialized) {
        this.rebuildLineData();
      }
    }

    this.backgroundDirty = true;
    this.requestFrame();
  }

  /**
   * Select/highlight a line by ID. Supports multi-select for compare mode.
   */
  selectLine(lineId: string, multiSelect = false): void {
    if (multiSelect) {
      const idx = this.state.selectedLineIds.indexOf(lineId);
      if (idx >= 0) {
        this.state.selectedLineIds.splice(idx, 1);
      } else {
        this.state.selectedLineIds.push(lineId);
      }
    } else {
      this.state.selectedLineIds = [lineId];
    }
    this.workerClient.setSelection(this.state.selectedLineIds);
    this.backgroundDirty = true;
    this.requestFrame();
    this.eventBus.emit("line:select", this.state.selectedLineIds);
  }

  /**
   * Clear all selections.
   */
  clearSelection(): void {
    if (this.state.selectedLineIds.length === 0) return;
    this.state.selectedLineIds = [];
    this.workerClient.setSelection([]);
    this.backgroundDirty = true;
    this.requestFrame();
    this.eventBus.emit("line:select", []);
  }

  /**
   * Get the currently selected line IDs.
   */
  getSelectedLineIds(): string[] {
    return [...this.state.selectedLineIds];
  }

  /**
   * Get metadata for a line (for tooltips, search results).
   */
  getLineMetadata(lineId: string): { label: string; artistId: string; releaseId?: string } | undefined {
    return this.lineMetadata.get(lineId);
  }

  /**
   * Get all line IDs and labels (for search/autocomplete).
   */
  getAllLines(): { lineId: string; label: string }[] {
    const results: { lineId: string; label: string }[] = [];
    for (const [lineId, meta] of this.lineMetadata) {
      results.push({ lineId, label: meta.label });
    }
    return results;
  }

  /**
   * Get the current viewport state (for time navigation UI).
   */
  getViewportState(): { start: number; end: number; total: number; currentDate: string } {
    return {
      start: this.state.viewportStart,
      end: this.state.viewportEnd,
      total: this.state.dates.length,
      currentDate: this.state.dates[this.state.currentDateIndex] ?? "",
    };
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    this.stopAnimationLoop();
    document.removeEventListener("keydown", this.handleKeydown);
    this.interaction?.destroy();
    this.renderer?.destroy();
    this.workerClient.destroy();
    this.initialized = false;
  }

  // --- Private: Data preparation ---

  private buildLineData(dataStore: DataStore, mode: "songs" | "artists"): SerializedLineData[] {
    const dateIndex = new Map<string, number>();
    for (let i = 0; i < dataStore.dates.length; i++) {
      dateIndex.set(dataStore.dates[i], i);
    }
    const dateToIndex = (d: string) => dateIndex.get(d) ?? -1;

    const serialized: SerializedLineData[] = [];
    this.lineMetadata.clear();

    if (mode === "songs") {
      // One line per release
      for (const artist of dataStore.artists.values()) {
        const color = ARTIST_TYPE_COLORS[artist.artistType];
        for (const release of artist.releases) {
          if (release.dailyValues.size === 0) continue;
          const lineId = `${artist.id}::${release.id}`;
          const series = buildSeriesFromDailyValues(release.dailyValues, dateToIndex);
          if (series.length === 0) continue;

          const label = `${artist.name} — ${release.title}`;
          serialized.push({
            lineId,
            label,
            color,
            changePoints: series.toArray(),
          });
          this.lineMetadata.set(lineId, { label, artistId: artist.id, releaseId: release.id });
        }
      }
    } else {
      // One line per artist (aggregate all releases)
      for (const artist of dataStore.artists.values()) {
        const color = ARTIST_TYPE_COLORS[artist.artistType];
        const releaseSeries: SparseTimeSeries[] = [];

        for (const release of artist.releases) {
          if (release.dailyValues.size === 0) continue;
          releaseSeries.push(buildSeriesFromDailyValues(release.dailyValues, dateToIndex));
        }

        if (releaseSeries.length === 0) continue;
        const merged = mergeSeries(releaseSeries);
        if (merged.length === 0) continue;

        const lineId = artist.id;
        const label = artist.name;
        serialized.push({
          lineId,
          label,
          color,
          changePoints: merged.toArray(),
        });
        this.lineMetadata.set(lineId, { label, artistId: artist.id });
      }
    }

    return serialized;
  }

  private async rebuildLineData(): Promise<void> {
    if (!this.dataStore) return;
    const lines = this.buildLineData(this.dataStore, this.state.displayMode);
    await this.workerClient.initData(lines, this.state.dates);
    this.backgroundDirty = true;
    this.requestFrame();
  }

  // --- Private: Animation loop ---

  private startAnimationLoop(): void {
    if (this.rafId !== null) return;
    this.lastFrameTime = performance.now();
    this.rafLoop();
  }

  private stopAnimationLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private rafLoop = (): void => {
    this.rafId = requestAnimationFrame(this.rafLoop);

    const now = performance.now();
    // Throttle to 60fps (16.67ms min between frames)
    if (now - this.lastFrameTime < 16) return;
    this.lastFrameTime = now;

    // The actual date advancement is driven by the playback controller
    // We just keep requesting frames for smooth rendering
    this.requestFrame();
  };

  // --- Private: Frame requests ---

  private requestFrame(): void {
    if (!this.initialized || !this.renderer) return;

    const { width, height, dpr } = this.renderer.getSize();
    if (width === 0 || height === 0) {
      // Container not laid out yet — retry next frame
      requestAnimationFrame(() => this.requestFrame());
      return;
    }

    const viewport: Viewport = {
      startDateIndex: this.state.viewportStart,
      endDateIndex: this.state.viewportEnd,
      width,
      height,
      dpr,
    };

    const visibility: VisibilityParams = {
      filterCount: this.state.filterCount,
      artistFilterActive: this.state.artistFilterActive,
      selectedLineIds: this.state.selectedLineIds,
    };

    this.workerClient.requestFrame(
      this.state.currentDateIndex,
      viewport,
      visibility,
    );
  }

  private handleFrameResult = (result: FrameResultMessage): void => {
    if (!this.renderer) return;

    // Draw layers
    if (this.backgroundDirty) {
      this.renderer.drawBackground(result.background);
      this.backgroundDirty = false;
    }
    this.renderer.drawForeground(result.foreground);
    this.renderer.drawHighlight(result.highlight);

    // Update spatial index with foreground + highlight lines for hit detection
    this.rebuildSpatialIndex(result);

    // Signal update complete (for playback controller synchronization)
    this.onUpdateComplete?.();
    this.eventBus.emit("update:complete");
  };

  // --- Private: Spatial index ---

  private rebuildSpatialIndex(result: FrameResultMessage): void {
    const { width, height, dpr } = this.renderer!.getSize();
    this.spatialIndex.resize(width, height);

    this.spatialIndex.clear();
    // Index foreground and highlight lines (background too dim for interaction)
    const indexable = [...result.foreground, ...result.highlight];
    for (const cmd of indexable) {
      if (cmd.points.length < 2) continue;
      // Convert from physical pixels to CSS pixels for hit detection
      const cssPoints = cmd.points.map(p => ({ x: p.x / dpr, y: p.y / dpr }));
      this.spatialIndex.insert({ lineId: cmd.lineId, points: cssPoints });
    }
  }

  // --- Private: Viewport management ---

  private autoScrollViewport(): void {
    const current = this.state.currentDateIndex;
    const viewportRange = this.state.viewportEnd - this.state.viewportStart;

    // If current date is past 80% of viewport, scroll forward
    const threshold = this.state.viewportStart + Math.floor(viewportRange * 0.8);
    if (current > threshold) {
      const shift = current - threshold;
      const totalDates = this.state.dates.length;
      this.state.viewportStart = Math.min(totalDates - viewportRange - 1, this.state.viewportStart + shift);
      this.state.viewportEnd = Math.min(totalDates - 1, this.state.viewportStart + viewportRange);
      this.backgroundDirty = true;
    }
  }

  // --- Private: Interaction handlers ---

  private handleResize = (): void => {
    this.backgroundDirty = true;
    this.requestFrame();
  };

  private handleHover = (lineId: string | null, x: number, y: number): void => {
    if (lineId) {
      const meta = this.lineMetadata.get(lineId);
      this.eventBus.emit("line:hover", { lineId, label: meta?.label ?? lineId, x, y });
    } else {
      this.eventBus.emit("line:hover", null);
    }
  };

  private handleClick = (lineId: string | null, multiSelect: boolean): void => {
    if (lineId) {
      this.selectLine(lineId, multiSelect);
    } else {
      this.clearSelection();
    }
  };

  private handlePanStart = (): void => {
    // Viewport state captured implicitly by current state
  };

  private handlePan = (deltaX: number): void => {
    this.panByPixels(deltaX);
  };

  private handlePanEnd = (): void => {
    // No-op — viewport already updated during pan
  };

  private handlePinchZoom = (scaleFactor: number, centerX: number): void => {
    if (this.state.playing) return;

    const { width } = this.renderer!.getSize();
    const viewportRange = this.state.viewportEnd - this.state.viewportStart;
    const centerRatio = centerX / width;
    const centerDateIndex = this.state.viewportStart + Math.round(centerRatio * viewportRange);

    // New range based on scale factor
    const newRange = Math.round(viewportRange / scaleFactor);
    const clampedRange = Math.max(7, Math.min(this.state.dates.length, newRange));

    // Center on the pinch center point
    let newStart = centerDateIndex - Math.round(centerRatio * clampedRange);
    let newEnd = newStart + clampedRange;

    // Clamp to bounds
    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd >= this.state.dates.length) {
      newStart -= (newEnd - this.state.dates.length + 1);
      newEnd = this.state.dates.length - 1;
    }
    newStart = Math.max(0, newStart);

    this.state.viewportStart = newStart;
    this.state.viewportEnd = newEnd;
    this.backgroundDirty = true;
    this.requestFrame();
  };

  // --- Private: Keyboard handling ---

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      this.clearSelection();
    }
  }
}
