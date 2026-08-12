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
 *   - Grid, endpoint labels, disambiguation, popover — all matching prototype
 */

import { ChartWorkerClient } from "../worker/chart-worker-client.ts";
import { CanvasRenderer } from "../canvas/canvas-renderer.ts";
import { Tooltip } from "../canvas/tooltip.ts";
import { Disambiguation } from "../canvas/disambiguation.ts";
import { Popover } from "../canvas/popover.ts";
import { Legend } from "../canvas/legend.ts";
import { buildSeriesFromDailyValues, mergeSeries, SparseTimeSeries } from "../worker/sparse-time-series.ts";
import { ARTIST_TYPE_COLORS } from "../colors.ts";
import type { EventBus } from "../event-bus.ts";
import type { DataStore } from "../models.ts";
import type { FilterState } from "../types.ts";
import type { SerializedLineData, FrameResultMessage, Viewport, VisibilityParams, LineDrawCommand, PixelPoint } from "../worker/messages.ts";

/** Time zoom presets with their date range widths */
export type TimeZoomPreset = "90d" | "quarter" | "year" | "decade" | "all";

const PRESET_DAYS: Record<TimeZoomPreset, number> = {
  "90d": 90,
  "quarter": 90,
  "year": 365,
  "decade": 3650,
  "all": Infinity,
};

// --- Constants matching prototype exactly ---
const PADDING = { top: 40, right: 160, bottom: 40, left: 0 };
/** @internal Used by worker for line thickness computation */
export const BASE_LINE_WIDTH = 1.5;
/** @internal Used by worker for highlighted line thickness */
export const HIGHLIGHT_MULTIPLIER = 3;
/** @internal Used by worker for dimmed line opacity */
export const DIM_MULTIPLIER = 0.2;
/** @internal Used by interaction layer hit radius */
export const HIT_RADIUS = 8;
const EVENT_DOT_SIZE = 8;
const MIN_GAP = 18;
const MAX_LABEL_WIDTH = 130;

/** Artist type display labels */
const ARTIST_TYPE_LABELS: Record<string, string> = {
  boy_group: "Boy Group",
  girl_group: "Girl Group",
  solo_male: "Solo Male",
  solo_female: "Solo Female",
  mixed_group: "Mixed Group",
};

/** Chart source human-readable labels */
const SOURCE_LABELS: Record<string, string> = {
  inkigayo: "Inkigayo",
  the_show: "The Show",
  show_champion: "Show Champion",
  music_bank: "Music Bank",
  m_countdown: "M Countdown",
  show_music_core: "Show Music Core",
};

/** Chart source logo URLs */
const SOURCE_LOGO_URLS: Record<string, string> = {
  inkigayo: "assets/sources/inkigayo.png",
  the_show: "assets/sources/the_show.png",
  show_champion: "assets/sources/show_champion.png",
  music_bank: "assets/sources/music_bank.png",
  m_countdown: "assets/sources/m_countdown.png",
  show_music_core: "assets/sources/show_music_core.png",
};

/** Cached render data for a single line (mirrors prototype's renderDataCache) */
interface RenderLineData {
  lineId: string;
  points: PixelPoint[];
  values: number[];
  color: string;
  opacity: number;
  lineWidth: number;
}

/** Label hit box for click detection */
interface LabelHitBox {
  lineId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** State for the line chart view */
interface LineChartState {
  dates: string[];
  currentDateIndex: number;
  viewportStart: number;
  viewportEnd: number;
  timeZoom: TimeZoomPreset;
  playing: boolean;
  speed: number;
  selectedLineIds: string[];
  filterCount: number;
  artistFilterActive: boolean;
  displayMode: "songs" | "artists";
}

export class LineChartController {
  private eventBus: EventBus;
  private dataStore: DataStore | null = null;
  private workerClient: ChartWorkerClient;
  private renderer: CanvasRenderer | null = null;
  private tooltip: Tooltip | null = null;
  private disambiguation: Disambiguation | null = null;
  private popover: Popover | null = null;
  private legend: Legend | null = null;

  /** Pre-loaded crown SVG images (crown-1 through crown-12) */
  private crownImages: Map<number, HTMLImageElement> = new Map();

  /** Cached render data from last frame (mirrors prototype's renderDataCache) */
  private renderDataCache: RenderLineData[] = [];
  /** Label hit boxes for click detection */
  private labelHitBoxes: LabelHitBox[] = [];

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
  /** Smooth animation position (fractional date index) */
  private animationPosition = 0;
  /** Whether initial data has been sent to worker */
  private initialized = false;
  /** Background layer needs full redraw */
  private backgroundDirty = true;
  /** Whether popover is currently open */
  private popoverOpen = false;
  /** Current generation filter */
  private currentGenFilter: number | "all" = "all";
  /** Current source filter */
  private currentSourceFilter: string = "all";
  /** Pan gesture state */
  private isPanning = false;
  private lastPanX = 0;
  /** Pinch gesture state */
  private pinchActive = false;
  private pinchStartDistance = 0;
  /** Touch gesture state */
  private touchStartPos = { x: 0, y: 0 };
  private touchMoved = false;

  /** Callback for when the controller needs playback to advance */
  onRequestDateAdvance: ((dateIndex: number) => void) | null = null;
  /** Callback for update complete */
  onUpdateComplete: (() => void) | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.workerClient = new ChartWorkerClient();
  }

  /**
   * Mount the line chart into a container element.
   */
  async mount(container: HTMLElement): Promise<void> {
    // Initialize renderer
    this.renderer = new CanvasRenderer({ container });
    this.renderer.mount();
    this.renderer.onResize = this.handleResize;

    // Mount tooltip, disambiguation, popover
    this.tooltip = new Tooltip(container);
    this.disambiguation = new Disambiguation(container);
    this.disambiguation.onSelect = (lineId) => {
      this.selectLine(lineId);
    };
    this.popover = new Popover(container);

    // Mount legend below chart container
    this.legend = new Legend();
    this.legend.mount(container);

    // Attach direct event listeners on the highlight canvas (like prototype)
    const hlCanvas = this.renderer.getInteractionCanvas()!;
    hlCanvas.addEventListener("mousemove", this.handleMouseMove);
    hlCanvas.addEventListener("click", this.handleCanvasClick);
    hlCanvas.addEventListener("mouseleave", this.handleMouseLeave);
    hlCanvas.addEventListener("mousedown", this.handleMouseDown);
    hlCanvas.addEventListener("mouseup", this.handleMouseUp);
    hlCanvas.addEventListener("touchstart", this.handleTouchStart, { passive: false });
    hlCanvas.addEventListener("touchmove", this.handleTouchMove, { passive: false });
    hlCanvas.addEventListener("touchend", this.handleTouchEnd);
    hlCanvas.addEventListener("touchcancel", this.handleTouchEnd);
    hlCanvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Keyboard: Escape to close popover / deselect
    this.handleKeydown = this.handleKeydown.bind(this);
    document.addEventListener("keydown", this.handleKeydown);

    // Initialize worker
    await this.workerClient.init();
    this.workerClient.onFrame(this.handleFrameResult);

    // Pre-load crown SVGs (1-12)
    for (let i = 1; i <= 12; i++) {
      const img = new Image();
      img.src = `assets/crowns/crown-${i}.svg`;
      this.crownImages.set(i, img);
    }
  }

  /**
   * Initialize with data and prepare for rendering.
   */
  async initData(dataStore: DataStore): Promise<void> {
    this.dataStore = dataStore;
    this.state.dates = dataStore.dates;

    // Default: show most recent 90 days, paused at the last date
    this.state.currentDateIndex = this.state.dates.length - 1;
    this.applyTimeZoom("90d");

    // Build serialized line data for the worker
    const lines = this.buildLineData(dataStore, this.state.displayMode);

    // Send to worker
    await this.workerClient.initData(lines, this.state.dates);
    this.initialized = true;

    // Request initial frame
    requestAnimationFrame(() => {
      this.backgroundDirty = true;
      this.requestFrame();
    });
  }

  setDateIndex(index: number): void {
    this.state.currentDateIndex = index;

    // Viewport right edge always tracks the current date
    const zoomWindow = PRESET_DAYS[this.state.timeZoom] === Infinity
      ? this.state.dates.length
      : PRESET_DAYS[this.state.timeZoom];

    this.state.viewportEnd = index;
    const dataStart = Math.max(0, index - zoomWindow);

    // During the first 7 days, keep data compressed near the right edge
    const revealedDates = index - dataStart;
    const minViewportSpan = 7;
    if (revealedDates < minViewportSpan && dataStart === 0) {
      this.state.viewportStart = -(minViewportSpan - revealedDates);
    } else {
      this.state.viewportStart = dataStart > 0 ? dataStart : -1;
    }
    this.backgroundDirty = true;
    this.requestFrame();
  }

  setPlaying(playing: boolean): void {
    this.state.playing = playing;
    if (playing) {
      // If at the end, reset to beginning
      if (this.state.currentDateIndex >= this.state.dates.length - 1) {
        this.state.currentDateIndex = 0;
      }
      this.startAnimationLoop();
    } else {
      this.stopAnimationLoop();
    }
  }

  applyTimeZoom(preset: TimeZoomPreset): void {
    this.state.timeZoom = preset;
    const totalDates = this.state.dates.length;

    if (preset === "all" || PRESET_DAYS[preset] >= totalDates) {
      this.state.viewportStart = 0;
      this.state.viewportEnd = totalDates - 1;
    } else {
      const windowSize = PRESET_DAYS[preset];
      const center = this.state.currentDateIndex;
      this.state.viewportStart = Math.max(0, center - Math.floor(windowSize / 2));
      this.state.viewportEnd = Math.min(totalDates - 1, this.state.viewportStart + windowSize);
      if (this.state.viewportEnd === totalDates - 1) {
        this.state.viewportStart = Math.max(0, this.state.viewportEnd - windowSize);
      }
    }

    this.backgroundDirty = true;
    this.requestFrame();
  }

  panByPixels(deltaX: number): void {
    if (this.state.playing) return;

    const { width } = this.renderer!.getSize();
    const viewportRange = this.state.viewportEnd - this.state.viewportStart;
    const dateDelta = Math.round((deltaX / width) * viewportRange);

    const totalDates = this.state.dates.length;
    let newStart = this.state.viewportStart - dateDelta;
    let newEnd = this.state.viewportEnd - dateDelta;

    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd >= totalDates) { newStart -= (newEnd - totalDates + 1); newEnd = totalDates - 1; }
    newStart = Math.max(0, newStart);

    this.state.viewportStart = newStart;
    this.state.viewportEnd = newEnd;
    this.backgroundDirty = true;
    this.requestFrame();
  }

  setFilters(filterState: FilterState): void {
    let filterCount = 0;
    if (filterState.generation !== "all") filterCount++;
    if (filterState.source !== "all") filterCount++;

    this.state.filterCount = filterCount;
    this.state.artistFilterActive = false;

    // Rebuild line data if any filter changed (generation, source, or displayMode)
    const filtersChanged = this.currentGenFilter !== filterState.generation ||
      this.currentSourceFilter !== filterState.source ||
      filterState.displayMode !== this.state.displayMode;

    this.currentGenFilter = filterState.generation;
    this.currentSourceFilter = filterState.source;

    if (filterState.displayMode !== this.state.displayMode) {
      this.state.displayMode = filterState.displayMode;
    }

    if (filtersChanged && this.dataStore && this.initialized) {
      this.rebuildLineData();
    }

    this.backgroundDirty = true;
    this.requestFrame();
  }

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
    this.tooltip?.hide();
    this.hidePopover();
    this.workerClient.setSelection(this.state.selectedLineIds);
    this.backgroundDirty = true;
    this.requestFrame();
    this.eventBus.emit("line:select", this.state.selectedLineIds);
  }

  clearSelection(): void {
    if (this.state.selectedLineIds.length === 0) return;
    this.state.selectedLineIds = [];
    this.tooltip?.hide();
    this.hidePopover();
    this.workerClient.setSelection([]);
    this.backgroundDirty = true;
    this.requestFrame();
    this.eventBus.emit("line:select", []);
  }

  getSelectedLineIds(): string[] {
    return [...this.state.selectedLineIds];
  }

  isPlaying(): boolean {
    return this.state.playing;
  }

  getLineMetadata(lineId: string): { label: string; artistId: string; releaseId?: string } | undefined {
    return this.lineMetadata.get(lineId);
  }

  getAllLines(): { lineId: string; label: string }[] {
    const results: { lineId: string; label: string }[] = [];
    for (const [lineId, meta] of this.lineMetadata) {
      results.push({ lineId, label: meta.label });
    }
    return results;
  }

  getViewportState(): { start: number; end: number; total: number; currentDate: string } {
    return {
      start: this.state.viewportStart,
      end: this.state.viewportEnd,
      total: this.state.dates.length,
      currentDate: this.state.dates[this.state.currentDateIndex] ?? "",
    };
  }

  /** Find date index in the controller's (extended) dates array */
  getDateIndex(date: string): number {
    return this.state.dates.indexOf(date);
  }

  destroy(): void {
    this.stopAnimationLoop();
    document.removeEventListener("keydown", this.handleKeydown);

    // Remove direct canvas event listeners
    const hlCanvas = this.renderer?.getInteractionCanvas();
    if (hlCanvas) {
      hlCanvas.removeEventListener("mousemove", this.handleMouseMove);
      hlCanvas.removeEventListener("click", this.handleCanvasClick);
      hlCanvas.removeEventListener("mouseleave", this.handleMouseLeave);
      hlCanvas.removeEventListener("mousedown", this.handleMouseDown);
      hlCanvas.removeEventListener("mouseup", this.handleMouseUp);
      hlCanvas.removeEventListener("touchstart", this.handleTouchStart);
      hlCanvas.removeEventListener("touchmove", this.handleTouchMove);
      hlCanvas.removeEventListener("touchend", this.handleTouchEnd);
      hlCanvas.removeEventListener("touchcancel", this.handleTouchEnd);
    }

    this.renderer?.destroy();
    this.workerClient.destroy();
    this.tooltip?.destroy();
    this.disambiguation?.destroy();
    this.popover?.destroy();
    this.legend?.destroy();
    this.initialized = false;
  }

  // --- Private: Data preparation ---

  private buildLineData(dataStore: DataStore, mode: "songs" | "artists"): SerializedLineData[] {
    // Use the extended dates array (includes synthetic zero-day at index 0)
    const dateIndex = new Map<string, number>();
    for (let i = 0; i < this.state.dates.length; i++) {
      dateIndex.set(this.state.dates[i], i);
    }
    const dateToIndex = (d: string) => dateIndex.get(d) ?? -1;

    const serialized: SerializedLineData[] = [];
    this.lineMetadata.clear();

    if (mode === "songs") {
      for (const artist of dataStore.artists.values()) {
        // Generation filter
        if (this.currentGenFilter !== "all" && artist.generation !== this.currentGenFilter) continue;

        const color = ARTIST_TYPE_COLORS[artist.artistType];
        for (const release of artist.releases) {
          if (release.dailyValues.size === 0) continue;

          // Source filter: only include dailyValues from the selected source
          let filteredDailyValues = release.dailyValues;
          if (this.currentSourceFilter !== "all") {
            filteredDailyValues = new Map();
            for (const [date, entry] of release.dailyValues) {
              if (entry.source === this.currentSourceFilter) {
                filteredDailyValues.set(date, entry);
              }
            }
            if (filteredDailyValues.size === 0) continue;
          }

          const lineId = `${artist.id}::${release.id}`;
          const series = buildSeriesFromDailyValues(filteredDailyValues, dateToIndex);
          if (series.length === 0) continue;

          const label = `${release.title} \u2014 ${artist.name}`;
          serialized.push({ lineId, label, color, changePoints: series.toArray() });
          this.lineMetadata.set(lineId, { label, artistId: artist.id, releaseId: release.id });
        }
      }
    } else {
      for (const artist of dataStore.artists.values()) {
        // Generation filter
        if (this.currentGenFilter !== "all" && artist.generation !== this.currentGenFilter) continue;

        const color = ARTIST_TYPE_COLORS[artist.artistType];
        const releaseSeries: SparseTimeSeries[] = [];

        for (const release of artist.releases) {
          if (release.dailyValues.size === 0) continue;
          // Source filter
          let filteredDailyValues = release.dailyValues;
          if (this.currentSourceFilter !== "all") {
            filteredDailyValues = new Map();
            for (const [date, entry] of release.dailyValues) {
              if (entry.source === this.currentSourceFilter) {
                filteredDailyValues.set(date, entry);
              }
            }
            if (filteredDailyValues.size === 0) continue;
          }
          releaseSeries.push(buildSeriesFromDailyValues(filteredDailyValues, dateToIndex));
        }

        if (releaseSeries.length === 0) continue;
        const merged = mergeSeries(releaseSeries);
        if (merged.length === 0) continue;

        const lineId = artist.id;
        const label = artist.name;
        serialized.push({ lineId, label, color, changePoints: merged.toArray() });
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
    // Start at currentDateIndex (which is 0 = zero-day after reset)
    this.animationPosition = this.state.currentDateIndex;
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
    const deltaMs = now - this.lastFrameTime;
    if (deltaMs < 16) return; // cap at ~60fps
    this.lastFrameTime = now;

    // Advance position smoothly
    // First step (D0→D1) is 2x faster, all others are 20% slower
    const isFirstStep = this.animationPosition < 1;
    const speed = isFirstStep ? 2.0 : 0.8;
    const advance = (deltaMs / 1000) * speed;
    this.animationPosition += advance;

    // Check if we've reached the end
    const maxIndex = this.state.dates.length - 1;
    if (this.animationPosition >= maxIndex) {
      this.animationPosition = maxIndex;
      this.state.currentDateIndex = maxIndex;
      this.stopAnimationLoop();
      this.state.playing = false;
      this.eventBus.emit("pause");
    }

    // Update the integer date index (for scrubber sync and data lookups)
    const newIndex = Math.max(0, Math.floor(this.animationPosition));
    if (newIndex !== this.state.currentDateIndex && newIndex >= 0) {
      this.state.currentDateIndex = newIndex;
      // Emit date:change so PlaybackController's scrubber stays in sync
      if (this.state.dates[newIndex]) {
        this.eventBus.emit("date:change", this.state.dates[newIndex]);
      }
    }

    // Update viewport with fractional position for smooth scrolling
    const zoomWindow = PRESET_DAYS[this.state.timeZoom] === Infinity
      ? this.state.dates.length
      : PRESET_DAYS[this.state.timeZoom];

    // Use fractional viewportEnd for smooth line extension
    this.state.viewportEnd = Math.max(0, Math.floor(this.animationPosition));
    const dataStart = Math.max(0, this.state.viewportEnd - zoomWindow);

    // During the first 7 days, keep data compressed near the right edge
    // by making the viewport much wider than the actual data range
    const revealedDates = this.state.viewportEnd - dataStart;
    const minViewportSpan = 7; // minimum "virtual" days of viewport width
    if (revealedDates < minViewportSpan && dataStart === 0) {
      this.state.viewportStart = -(minViewportSpan - revealedDates);
    } else {
      this.state.viewportStart = dataStart > 0 ? dataStart : -1;
    }
    this.backgroundDirty = true;

    this.requestFrame();
  };

  // --- Private: Frame requests ---

  private requestFrame(): void {
    if (!this.initialized || !this.renderer) return;

    const { width, height, dpr } = this.renderer.getSize();
    if (width === 0 || height === 0) {
      requestAnimationFrame(() => this.requestFrame());
      return;
    }

    const viewport: Viewport = {
      startDateIndex: this.state.viewportStart,
      endDateIndex: this.state.viewportEnd,
      progressToNext: this.state.playing ? (this.animationPosition - Math.floor(this.animationPosition)) : 0,
      width,
      height,
      dpr,
    };

    const visibility: VisibilityParams = {
      filterCount: this.state.filterCount,
      artistFilterActive: this.state.artistFilterActive,
      selectedLineIds: this.state.selectedLineIds,
    };

    this.workerClient.requestFrame(this.state.currentDateIndex, viewport, visibility);
  }

  private handleFrameResult = (result: FrameResultMessage): void => {
    if (!this.renderer) return;

    const { width, height } = this.renderer.getSize();

    // Build renderDataCache from all layers (mirrors prototype's structure)
    this.renderDataCache = [];
    for (const cmd of result.background) {
      this.renderDataCache.push({
        lineId: cmd.lineId,
        points: cmd.points,
        values: cmd.values,
        color: cmd.color,
        opacity: cmd.opacity,
        lineWidth: cmd.lineWidth,
      });
    }
    for (const cmd of result.foreground) {
      this.renderDataCache.push({
        lineId: cmd.lineId,
        points: cmd.points,
        values: cmd.values,
        color: cmd.color,
        opacity: cmd.opacity,
        lineWidth: cmd.lineWidth,
      });
    }
    for (const cmd of result.highlight) {
      this.renderDataCache.push({
        lineId: cmd.lineId,
        points: cmd.points,
        values: cmd.values,
        color: cmd.color,
        opacity: cmd.opacity,
        lineWidth: cmd.lineWidth,
      });
    }

    // Draw layers
    if (this.backgroundDirty) {
      this.renderer.drawBackground(result.background);
      // Draw grid on background
      const bgCtx = this.renderer.getContext("background");
      if (bgCtx) {
        this.drawGrid(bgCtx, width, height);
      }
      this.backgroundDirty = false;
    }
    this.renderer.drawForeground(result.foreground);

    // Draw endpoint labels on foreground (prototype-style stagger)
    // Draw endpoint labels on foreground — include ALL visible lines for top-10 selection
    const fgCtx = this.renderer.getContext("foreground");
    const allVisibleCmds = [...result.background, ...result.foreground];
    if (fgCtx && allVisibleCmds.length > 0) {
      this.drawEndpointLabels(fgCtx, allVisibleCmds);
    }

    // Draw highlight layer + event dots
    this.renderer.drawHighlight(result.highlight);
    if (result.highlight.length > 0) {
      const hlCtx = this.renderer.getContext("highlight");
      if (hlCtx) {
        this.drawHighlightLabelsAndDots(hlCtx, result.highlight);
      }
    }

    this.onUpdateComplete?.();
    this.eventBus.emit("update:complete");
  };

  // --- Private: Drawing helpers (match prototype exactly) ---

  private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const chart = {
      x: PADDING.left,
      y: PADDING.top,
      w: width - PADDING.left - PADDING.right,
      h: height - PADDING.top - PADDING.bottom,
    };

    // X-axis line
    ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chart.x, chart.y + chart.h);
    ctx.lineTo(chart.x + chart.w, chart.y + chart.h);
    ctx.stroke();

    // Date labels
    let startDateStr: string;
    if (this.state.viewportStart < 0) {
      // Virtual start before first date — show one day before the first date
      const firstDate = this.state.dates[0] ?? "";
      try {
        const d = new Date(firstDate + "T00:00:00");
        d.setDate(d.getDate() + this.state.viewportStart); // viewportStart is negative
        startDateStr = d.toISOString().split("T")[0];
      } catch {
        startDateStr = firstDate;
      }
    } else {
      startDateStr = this.state.dates[this.state.viewportStart] ?? "";
    }
    const endDate = this.state.dates[this.state.viewportEnd] ?? "";

    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.font = "10px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(this.formatDateLabel(startDateStr), chart.x + 8, chart.y + chart.h + 20);
    ctx.textAlign = "right";
    ctx.fillText(this.formatDateLabel(endDate), chart.x + chart.w, chart.y + chart.h + 20);
  }

  private drawEndpointLabels(ctx: CanvasRenderingContext2D, commands: LineDrawCommand[]): void {
    this.labelHitBoxes = []; // reset

    // Collect label candidates (only visible lines, opacity > 0.5)
    const labeled = commands
      .filter(cmd => cmd.points.length >= 2 && cmd.opacity > 0.05)
      .map(cmd => ({
        lineId: cmd.lineId,
        endPoint: cmd.points[cmd.points.length - 1],
        color: cmd.color,
        opacity: cmd.opacity,
        finalValue: cmd.values.length > 0 ? cmd.values[cmd.values.length - 1] : 0,
      }))
      .sort((a, b) => b.finalValue - a.finalValue)
      .slice(0, 10);

    // Sort by Y position for stagger layout
    labeled.sort((a, b) => a.endPoint.y - b.endPoint.y);

    // Stagger to avoid overlap (MIN_GAP = 18px)
    const resolvedPositions: { y: number; lineId: string; endPoint: PixelPoint; color: string; opacity: number; finalValue: number }[] = [];

    for (const item of labeled) {
      let labelY = item.endPoint.y;
      for (const placed of resolvedPositions) {
        if (Math.abs(labelY - placed.y) < MIN_GAP) {
          labelY = placed.y + MIN_GAP;
        }
      }
      resolvedPositions.push({ ...item, y: labelY });
    }

    for (const { y: labelY, lineId, endPoint, color, opacity, finalValue } of resolvedPositions) {
      const meta = this.lineMetadata.get(lineId);
      if (!meta) continue;

      ctx.globalAlpha = opacity;

      // Line 1: bold "artist — song" (truncated to 130px)
      ctx.font = "bold 9px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = color;
      ctx.textAlign = "left";

      let displayText = meta.label;
      if (ctx.measureText(displayText).width > MAX_LABEL_WIDTH) {
        while (displayText.length > 3 && ctx.measureText(displayText + "...").width > MAX_LABEL_WIDTH) {
          displayText = displayText.slice(0, -1);
        }
        displayText += "...";
      }
      ctx.fillText(displayText, endPoint.x + 6, labelY - 1);

      // Line 2: "value · wins" (smaller, lighter)
      if (finalValue > 0) {
        const wins = this.getWinCount(lineId);
        const statsText = wins > 0
          ? `${finalValue.toLocaleString()} \u00B7 ${wins} Wins`
          : `${finalValue.toLocaleString()}`;
        ctx.font = "8px system-ui, -apple-system, sans-serif";
        ctx.globalAlpha = opacity * 0.7;
        ctx.fillText(statsText, endPoint.x + 6, labelY + 8);
      }

      // Register hit box for click detection
      this.labelHitBoxes.push({
        lineId,
        x: endPoint.x + 6,
        y: labelY - 10,
        width: MAX_LABEL_WIDTH,
        height: 20,
      });

      ctx.globalAlpha = 1;
    }
  }

  private drawHighlightLabelsAndDots(ctx: CanvasRenderingContext2D, highlightCmds: LineDrawCommand[]): void {
    for (const cmd of highlightCmds) {
      if (cmd.points.length < 2) continue;

      // Draw endpoint label for highlighted line
      const lastPt = cmd.points[cmd.points.length - 1];
      const meta = this.lineMetadata.get(cmd.lineId);
      if (meta) {
        ctx.fillStyle = cmd.color;
        ctx.font = "bold 9px system-ui, -apple-system, sans-serif";
        ctx.textAlign = "left";

        let displayText = meta.label;
        if (ctx.measureText(displayText).width > MAX_LABEL_WIDTH) {
          while (displayText.length > 3 && ctx.measureText(displayText + "...").width > MAX_LABEL_WIDTH) {
            displayText = displayText.slice(0, -1);
          }
          displayText += "...";
        }
        ctx.fillText(displayText, lastPt.x + 6, lastPt.y - 1);

        // Stats line with value + wins
        const finalValue = cmd.values.length > 0 ? cmd.values[cmd.values.length - 1] : 0;
        if (finalValue > 0) {
          const wins = this.getWinCount(cmd.lineId);
          const statsText = wins > 0
            ? `${finalValue.toLocaleString()} \u00B7 ${wins} Wins`
            : `${finalValue.toLocaleString()}`;
          ctx.font = "8px system-ui, -apple-system, sans-serif";
          ctx.globalAlpha = 0.7;
          ctx.fillText(statsText, lastPt.x + 6, lastPt.y + 8);
          ctx.globalAlpha = 1;
        }
      }

      // Draw event dots on the highlighted line (wins + embeds)
      this.drawEventDotsForLine(ctx, cmd);
      this.drawEmbedDotsForLine(ctx, cmd);
    }
  }

  private drawEventDotsForLine(ctx: CanvasRenderingContext2D, cmd: LineDrawCommand): void {
    if (!this.dataStore) return;

    const meta = this.lineMetadata.get(cmd.lineId);
    if (!meta) return;

    const artist = this.dataStore.artists.get(meta.artistId);
    if (!artist) return;

    // Get win dates for this release (sorted chronologically)
    const releaseWinDates = this.dataStore.releaseWinDates?.get(cmd.lineId);
    if (!releaseWinDates || releaseWinDates.length === 0) return;

    const viewStart = this.state.viewportStart;
    const viewEnd = this.state.viewportEnd;
    const totalDateSpan = viewEnd + 1 - viewStart;
    const { width } = this.renderer!.getSize();
    const chartW = width - PADDING.left - PADDING.right;

    for (const winDate of releaseWinDates) {
      const dateIdx = this.state.dates.indexOf(winDate);
      if (dateIdx < viewStart || dateIdx > viewEnd) continue;

      // Map date to x position
      const xRatio = (dateIdx - viewStart) / totalDateSpan;
      const x = PADDING.left + xRatio * chartW;

      // Get y from the line's value at this date
      const value = this.getValueAtDateForLine(cmd, dateIdx);
      const frameMax = this.getCurrentFrameMax();
      const chartH = (this.renderer!.getSize().height) - PADDING.top - PADDING.bottom;
      const y = PADDING.top + chartH - (value / (frameMax || 1)) * chartH;

      // Look up crown level from chartWins (per-show win count)
      let crownLevel = 1;
      const dateWins = this.dataStore.chartWins.get(winDate);
      if (dateWins) {
        for (const [, winData] of dateWins) {
          if (winData.artistIds.includes(meta.artistId)) {
            const level = winData.crownLevels.get(meta.artistId);
            if (level !== undefined) {
              crownLevel = level;
              break;
            }
          }
        }
      }

      this.drawCrownDot(ctx, x, y, crownLevel);
    }
  }

  private drawEmbedDotsForLine(ctx: CanvasRenderingContext2D, cmd: LineDrawCommand): void {
    if (!this.dataStore) return;

    const meta = this.lineMetadata.get(cmd.lineId);
    if (!meta || !meta.releaseId) return;

    const artist = this.dataStore.artists.get(meta.artistId);
    if (!artist) return;

    const release = artist.releases.find(r => r.id === meta.releaseId);
    if (!release) return;

    const viewStart = this.state.viewportStart;
    const viewEnd = this.state.viewportEnd;
    const totalDateSpan = viewEnd + 1 - viewStart;
    const { width } = this.renderer!.getSize();
    const chartW = width - PADDING.left - PADDING.right;
    const chartH = this.renderer!.getSize().height - PADDING.top - PADDING.bottom;
    const frameMax = this.getCurrentFrameMax();

    // Also collect win dates to avoid drawing a white dot on top of a crown
    const winDates = new Set(this.dataStore.releaseWinDates?.get(cmd.lineId) ?? []);

    for (const [date, embeds] of release.embeds) {
      if (!embeds || embeds.length === 0) continue;
      if (winDates.has(date)) continue; // crown already drawn for this date

      // Only show dots for dates within the visible time range
      const viewStartDate = this.state.dates[Math.max(0, viewStart)] ?? "";
      const viewEndDate = this.state.dates[Math.min(this.state.dates.length - 1, viewEnd)] ?? "";
      if (date < viewStartDate || date > viewEndDate) continue;

      // Find the date index — if not in dates array, find nearest
      let dateIdx = this.state.dates.indexOf(date);
      if (dateIdx === -1) {
        dateIdx = this.findNearestDateIndex(date);
      }
      if (dateIdx < 0 || dateIdx < viewStart || dateIdx > viewEnd) continue;

      const xRatio = (dateIdx - viewStart) / totalDateSpan;
      const x = PADDING.left + xRatio * chartW;
      const value = this.getValueAtDateForLine(cmd, dateIdx);
      const y = PADDING.top + chartH - (value / (frameMax || 1)) * chartH;

      // White circle dot
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawCrownDot(ctx: CanvasRenderingContext2D, x: number, y: number, winNumber: number): void {
    const crownLevel = Math.min(winNumber, 12);
    const img = this.crownImages.get(crownLevel);
    const dotSize = EVENT_DOT_SIZE * 1.8;

    if (img && img.complete && img.naturalWidth > 0) {
      const imgSize = dotSize * 1.5;
      ctx.save();
      // White background square with 80% opacity
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      const bgSize = imgSize + 3;
      ctx.beginPath();
      ctx.roundRect(x - bgSize / 2, y - bgSize / 2, bgSize, bgSize, 2);
      ctx.fill();
      // Draw crown SVG in original red
      ctx.drawImage(img, x - imgSize / 2, y - imgSize / 2, imgSize, imgSize);
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.beginPath();
      ctx.arc(x, y, dotSize * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /** Get cumulative value at a date index for a line (from cached render data) */
  private getValueAtDateForLine(cmd: LineDrawCommand, dateIdx: number): number {
    // Find the closest point in the command's values array
    const viewStart = this.state.viewportStart;
    const viewEnd = this.state.viewportEnd;
    const totalDateSpan = viewEnd + 1 - viewStart;
    const targetRatio = (dateIdx - viewStart) / totalDateSpan;

    // Find the point closest to this ratio
    const { width } = this.renderer!.getSize();
    const chartW = width - PADDING.left - PADDING.right;
    const targetX = PADDING.left + targetRatio * chartW;

    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < cmd.points.length; i++) {
      const dist = Math.abs(cmd.points[i].x - targetX);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }
    return cmd.values[closestIdx] ?? 0;
  }

  /** Get the current frame's max value (for Y-axis scaling) */
  private getCurrentFrameMax(): number {
    let max = 0;
    for (const rd of this.renderDataCache) {
      for (const v of rd.values) {
        if (v > max) max = v;
      }
    }
    return max || 1;
  }

  // --- Private: Viewport management (handled in setDateIndex during playback) ---

  // --- Private: Hit detection (matching prototype exactly) ---

  /** Find lines near a CSS point, returns lineId + nearest point index */
  private findLinesAtPoint(x: number, y: number): { rd: RenderLineData; nearestIndex: number }[] {
    const hits: { rd: RenderLineData; nearestIndex: number }[] = [];

    for (const rd of this.renderDataCache) {
      if (rd.opacity <= 0.05) continue; // Skip hidden/nearly-invisible lines
      for (let i = 0; i < rd.points.length - 1; i++) {
        const dist = this.pointToSegmentDistance(x, y, rd.points[i], rd.points[i + 1]);
        if (dist <= HIT_RADIUS) {
          const distToI = Math.hypot(x - rd.points[i].x, y - rd.points[i].y);
          const distToI1 = Math.hypot(x - rd.points[i + 1].x, y - rd.points[i + 1].y);
          const nearestIndex = distToI <= distToI1 ? i : i + 1;
          hits.push({ rd, nearestIndex });
          break;
        }
      }
    }

    return hits;
  }

  /** Find an event dot at the given CSS point (only when a line is selected) */
  private findEventDotAtPoint(x: number, y: number): { lineId: string; dateIndex: number; eventTypes: string[] } | null {
    if (this.state.selectedLineIds.length === 0) return null;
    if (!this.dataStore) return null;

    const selectedId = this.state.selectedLineIds[0];
    const rd = this.renderDataCache.find(r => r.lineId === selectedId);
    if (!rd) return null;

    const meta = this.lineMetadata.get(selectedId);
    if (!meta) return null;

    const artist = this.dataStore.artists.get(meta.artistId);
    if (!artist) return null;

    const viewStart = this.state.viewportStart;
    const viewEnd = this.state.viewportEnd;
    const totalDateSpan = viewEnd + 1 - viewStart;
    const { width } = this.renderer!.getSize();
    const chartW = width - PADDING.left - PADDING.right;
    const chartH = this.renderer!.getSize().height - PADDING.top - PADDING.bottom;
    const frameMax = this.getCurrentFrameMax();

    // Collect all dot dates (wins + embeds)
    const dotDates: { date: string; dateIdx: number; eventTypes: string[] }[] = [];

    // Win dates
    const releaseWinDates = this.dataStore.releaseWinDates?.get(selectedId) ?? [];
    for (const winDate of releaseWinDates) {
      const dateIdx = this.state.dates.indexOf(winDate);
      if (dateIdx >= viewStart && dateIdx <= viewEnd) {
        dotDates.push({ date: winDate, dateIdx, eventTypes: ["win"] });
      }
    }

    // Embed dates
    if (meta.releaseId) {
      const release = artist.releases.find(r => r.id === meta.releaseId);
      if (release) {
        for (const [date, embeds] of release.embeds) {
          if (!embeds || embeds.length === 0) continue;
          let dateIdx = this.state.dates.indexOf(date);
          if (dateIdx === -1) dateIdx = this.findNearestDateIndex(date);
          if (dateIdx >= viewStart && dateIdx <= viewEnd) {
            const types = embeds.map(e => e.type as string);
            // Merge with existing if same date
            const existing = dotDates.find(d => d.dateIdx === dateIdx);
            if (existing) {
              existing.eventTypes.push(...types);
            } else {
              dotDates.push({ date, dateIdx, eventTypes: types });
            }
          }
        }
      }
    }

    // Hit test each dot
    for (const dot of dotDates) {
      const xRatio = (dot.dateIdx - viewStart) / totalDateSpan;
      const dotX = PADDING.left + xRatio * chartW;
      const value = this.getValueAtDateForLine(rd, dot.dateIdx);
      const dotY = PADDING.top + chartH - (value / (frameMax || 1)) * chartH;

      const dist = Math.hypot(x - dotX, y - dotY);
      if (dist <= 12) {
        return { lineId: selectedId, dateIndex: dot.dateIdx, eventTypes: dot.eventTypes };
      }
    }

    return null;
  }

  /** Find a label hit box at the given CSS point */
  private findLabelAtPoint(x: number, y: number): string | null {
    for (const box of this.labelHitBoxes) {
      if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
        return box.lineId;
      }
    }
    return null;
  }

  /** Point-to-segment distance (matches prototype) */
  private pointToSegmentDistance(px: number, py: number, a: PixelPoint, b: PixelPoint): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - a.x, py - a.y);

    let t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.hypot(px - projX, py - projY);
  }

  /** Get canvas-relative coordinates from a MouseEvent */
  private getCanvasCoords(e: MouseEvent): { x: number; y: number } {
    const canvas = this.renderer?.getInteractionCanvas();
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Get canvas-relative coordinates from a Touch */
  private getCanvasCoordsFromTouch(touch: Touch): { x: number; y: number } {
    const canvas = this.renderer?.getInteractionCanvas();
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }

  private getTouchDistance(touches: TouchList): number {
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // --- Private: Direct event handlers (matching prototype lines 720-933) ---

  private handleMouseMove = (e: MouseEvent): void => {
    if (this.isPanning) {
      const deltaX = e.clientX - this.lastPanX;
      this.lastPanX = e.clientX;
      this.panByPixels(deltaX);
      return;
    }

    if (this.disambiguation?.isVisible()) return;
    if (this.popoverOpen) return;

    const { x, y } = this.getCanvasCoords(e);
    const hlCanvas = this.renderer?.getInteractionCanvas();

    // Check event dots first (if line is selected)
    const dotHit = this.findEventDotAtPoint(x, y);
    if (dotHit) {
      if (hlCanvas) hlCanvas.style.cursor = "pointer";
      const rd = this.renderDataCache.find(r => r.lineId === dotHit.lineId);
      if (rd) {
        this.showRichTooltip(x, y, rd, this.getNearestPointIndex(rd, x), undefined, true);
      }
      return;
    }

    // Check label hover (only when not in highlight mode)
    if (this.state.selectedLineIds.length === 0) {
      const labelHit = this.findLabelAtPoint(x, y);
      if (labelHit) {
        if (hlCanvas) hlCanvas.style.cursor = "pointer";
        this.tooltip?.hide();
        return;
      }
    }

    // Check lines
    const hits = this.findLinesAtPoint(x, y);
    if (hits.length === 0) {
      if (hlCanvas) hlCanvas.style.cursor = "default";
      this.tooltip?.hide();
      this.eventBus.emit("line:hover", null);
      return;
    }

    if (hlCanvas) hlCanvas.style.cursor = "pointer";

    // When a line is already highlighted, only show tooltip for the selected line
    if (this.state.selectedLineIds.length > 0) {
      const selectedHit = hits.find(h => this.state.selectedLineIds.includes(h.rd.lineId));
      if (selectedHit) {
        this.showRichTooltip(x, y, selectedHit.rd, selectedHit.nearestIndex);
      } else {
        this.tooltip?.hide();
      }
      return;
    }

    if (hits.length === 1) {
      const { rd, nearestIndex } = hits[0];
      this.showRichTooltip(x, y, rd, nearestIndex);
    } else {
      // Multiple hits — show cluster hint
      this.tooltip?.showClusterHint(hits.length, x, y);
    }

    this.eventBus.emit("line:hover", { lineId: hits[0].rd.lineId, label: "", x, y });
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;

    const { x, y } = this.getCanvasCoords(e);
    const hits = this.findLinesAtPoint(x, y);

    if (hits.length > 0) return; // Will handle on mouseup

    // Start panning (clicked on empty area)
    this.isPanning = true;
    this.lastPanX = e.clientX;
    const hlCanvas = this.renderer?.getInteractionCanvas();
    if (hlCanvas) hlCanvas.style.cursor = "grabbing";
  };

  private handleMouseUp = (_e: MouseEvent): void => {
    if (this.isPanning) {
      this.isPanning = false;
      const hlCanvas = this.renderer?.getInteractionCanvas();
      if (hlCanvas) hlCanvas.style.cursor = "default";
      return;
    }
  };

  private handleCanvasClick = (e: MouseEvent): void => {
    const { x, y } = this.getCanvasCoords(e);

    // Hide disambiguation if open and clicked elsewhere
    if (this.disambiguation?.isVisible()) {
      this.disambiguation.hide();
      return;
    }

    // Check label click (toggle highlight)
    const labelHit = this.findLabelAtPoint(x, y);
    if (labelHit) {
      if (this.state.selectedLineIds.length > 0) {
        this.clearSelection();
      } else {
        this.selectLine(labelHit);
      }
      return;
    }

    // Check event dot click — open popover with embeds
    const dotHit = this.findEventDotAtPoint(x, y);
    if (dotHit) {
      this.showPopoverForDot(dotHit);
      return;
    }

    // Check line clicks
    const hits = this.findLinesAtPoint(x, y);
    if (hits.length === 0) {
      if (this.popoverOpen) {
        this.hidePopover();
        return;
      }
      this.clearSelection();
      return;
    }

    if (this.state.selectedLineIds.length > 0) {
      if (this.popoverOpen) {
        this.hidePopover();
        return;
      }
      // Already highlighting — clicking deselects
      this.clearSelection();
      return;
    }

    if (hits.length === 1) {
      this.selectLine(hits[0].rd.lineId);
    } else {
      // Show disambiguation popup
      const items = hits.map(h => {
        const meta = this.lineMetadata.get(h.rd.lineId);
        return {
          lineId: h.rd.lineId,
          label: meta?.label ?? h.rd.lineId,
          color: h.rd.color,
        };
      });
      this.disambiguation?.show(x, y, items);
    }
  };

  private handleMouseLeave = (): void => {
    if (this.isPanning) {
      this.isPanning = false;
    }
    if (!this.popoverOpen) {
      this.tooltip?.hide();
    }
    const hlCanvas = this.renderer?.getInteractionCanvas();
    if (hlCanvas) hlCanvas.style.cursor = "default";
  };

  private handleTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
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
      const canvas = this.renderer?.getInteractionCanvas();
      if (canvas) {
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const rect = canvas.getBoundingClientRect();
        this.handlePinchZoom(scaleFactor, centerX - rect.left);
      }
      this.pinchStartDistance = newDistance;
      return;
    }

    if (e.touches.length === 1) {
      e.preventDefault();
      const touch = e.touches[0];
      const dx = touch.clientX - this.touchStartPos.x;
      const dy = touch.clientY - this.touchStartPos.y;

      if (!this.isPanning && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        this.isPanning = true;
        this.touchMoved = true;
      }

      if (this.isPanning) {
        const deltaX = touch.clientX - this.lastPanX;
        this.lastPanX = touch.clientX;
        this.panByPixels(deltaX);
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
      return;
    }

    // Tap (no movement)
    if (!this.touchMoved && e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      const { x, y } = this.getCanvasCoordsFromTouch(touch);
      const hits = this.findLinesAtPoint(x, y);

      if (hits.length > 0) {
        if (hits.length === 1) {
          this.selectLine(hits[0].rd.lineId);
        } else {
          const items = hits.map(h => ({
            lineId: h.rd.lineId,
            label: this.lineMetadata.get(h.rd.lineId)?.label ?? h.rd.lineId,
            color: h.rd.color,
          }));
          this.disambiguation?.show(x, y, items);
        }
      } else {
        this.clearSelection();
      }
    }

    this.touchMoved = false;
  };

  // --- Private: Interaction handlers ---

  private handleResize = (): void => {
    this.disambiguation?.hide();
    this.tooltip?.hide();
    this.backgroundDirty = true;
    this.requestFrame();
  };

  private handlePinchZoom(scaleFactor: number, centerX: number): void {
    if (this.state.playing) return;

    const { width } = this.renderer!.getSize();
    const viewportRange = this.state.viewportEnd - this.state.viewportStart;
    const centerRatio = centerX / width;
    const centerDateIndex = this.state.viewportStart + Math.round(centerRatio * viewportRange);

    const newRange = Math.round(viewportRange / scaleFactor);
    const clampedRange = Math.max(7, Math.min(this.state.dates.length, newRange));

    let newStart = centerDateIndex - Math.round(centerRatio * clampedRange);
    let newEnd = newStart + clampedRange;

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
  }

  // --- Private: Keyboard handling ---

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      if (this.popoverOpen) {
        this.hidePopover();
      } else {
        this.clearSelection();
      }
      this.disambiguation?.hide();
    }
  }

  // --- Private: Popover management ---

  private showPopoverForDot(dotHit: { lineId: string; dateIndex: number; eventTypes: string[] }): void {
    const rd = this.renderDataCache.find(r => r.lineId === dotHit.lineId);
    if (!rd) return;

    // Compute x position from date index for the tooltip
    const { width } = this.renderer!.getSize();
    const chartW = width - PADDING.left - PADDING.right;
    const totalDateSpan = this.state.viewportEnd + 1 - this.state.viewportStart;
    const xRatio = (dotHit.dateIndex - this.state.viewportStart) / totalDateSpan;
    const x = PADDING.left + xRatio * chartW;

    // Get nearest point index for this date
    const nearestIdx = this.getNearestPointIndex(rd, x);

    // Show the same rich tooltip content (includes embeds, win info, etc.)
    this.showRichTooltip(x, rd.points[nearestIdx]?.y ?? 200, rd, nearestIdx);

    // Make the tooltip sticky (interactive)
    this.tooltip?.makeSticky();
    this.popoverOpen = true;
  }

  private hidePopover(): void {
    this.tooltip?.forceHide();
    this.popover?.hide();
    this.popoverOpen = false;
  }

  // --- Private: Rich tooltip (matching prototype showTooltip) ---

  private showRichTooltip(x: number, y: number, rd: RenderLineData, nearestIndex: number, eventLabel?: string, _showEmbed?: boolean): void {
    const meta = this.lineMetadata.get(rd.lineId);
    if (!meta) return;

    const artist = this.dataStore?.artists.get(meta.artistId);
    const color = rd.color;
    const artistTypeLabel = artist ? ARTIST_TYPE_LABELS[artist.artistType] ?? "" : "";
    const genLabel = artist ? `Gen ${artist.generation}` : "";

    // Get value at nearest point
    const value = rd.values[nearestIndex] ?? 0;
    // dailyGain is computed later, only for dates with actual chart data

    // Reverse-map nearest point x → date for display
    const { width } = this.renderer!.getSize();
    const chartW = width - PADDING.left - PADDING.right;
    // Use mouse x position (not nearest point) for accurate date at any position on the line
    const xRatio = Math.max(0, Math.min(1, (x - PADDING.left) / chartW));
    // Worker maps [startDateIndex, endDateIndex+1] to [0, chartW]
    const totalDateSpan = this.state.viewportEnd + 1 - this.state.viewportStart;
    const dateIndex = Math.round(this.state.viewportStart + xRatio * totalDateSpan);
    const clampedIndex = Math.max(0, Math.min(this.state.dates.length - 1, dateIndex));
    const hoveredDate = this.state.dates[clampedIndex] ?? "";
    const formattedDate = this.formatDateLabel(hoveredDate);

    // Get chart source and daily gain — only for dates with actual chart data
    let sourceLabel: string | undefined;
    let sourceLogoUrl: string | undefined;
    let dailyGain: number | undefined;
    if (artist && meta.releaseId) {
      const release = artist.releases.find(r => r.id === meta.releaseId);
      if (release) {
        const entry = release.dailyValues.get(hoveredDate);
        if (entry) {
          if (entry.source) {
            sourceLabel = SOURCE_LABELS[entry.source] ?? entry.source;
            sourceLogoUrl = SOURCE_LOGO_URLS[entry.source];
          }
          if (entry.value > 0) {
            dailyGain = entry.value;
          }
        }
      }
    }

    // Check if this date is a chart win for this release
    let winInfo: { crownLevel: number; crownLabel: string; crownSvgUrl: string } | undefined;
    if (this.dataStore && meta.artistId) {
      const dateWins = this.dataStore.chartWins.get(hoveredDate);
      if (dateWins) {
        for (const [, winData] of dateWins) {
          if (winData.artistIds.includes(meta.artistId)) {
            const level = winData.crownLevels.get(meta.artistId) ?? 1;
            winInfo = {
              crownLevel: level,
              crownLabel: this.getCrownLabel(level),
              crownSvgUrl: `assets/crowns/crown-${Math.min(level, 12)}.svg`,
            };
            break;
          }
        }
      }
    }

    // Check for embeds (live performance / MV / release) at this date
    let hasVideo = false;
    let hasRelease = false;
    let embedUrl: string | undefined;
    if (artist && meta.releaseId) {
      const release = artist.releases.find(r => r.id === meta.releaseId);
      if (release) {
        const embeds = release.embeds.get(hoveredDate);
        if (embeds) {
          for (const embed of embeds) {
            if (embed.type === "live_performance" || embed.type === "mv") {
              hasVideo = true;
              embedUrl = embed.url;
            }
            if (embed.type === "release_date") {
              hasRelease = true;
            }
          }
        }
      }
    }

    this.tooltip?.show({
      label: meta.label,
      artistName: artist?.name ?? meta.label,
      songTitle: meta.releaseId ? this.getReleaseTitleFromMeta(meta) : undefined,
      color,
      artistTypeLabel,
      generationLabel: genLabel,
      logoUrl: artist?.logoUrl,
      date: formattedDate,
      value: value > 0 ? value : undefined,
      dailyGain,
      sourceLabel,
      sourceLogoUrl,
      eventLabel,
      showEmbed: hasVideo || hasRelease,
      hasVideo,
      hasRelease,
      embedUrl,
      winInfo,
    }, x, y);
  }

  /** Get nearest point index on a line given an x coordinate */
  private getNearestPointIndex(rd: RenderLineData, x: number): number {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < rd.points.length; i++) {
      const d = Math.abs(rd.points[i].x - x);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /** Get win count for a given line up to the current animation date */
  private getWinCount(lineId: string): number {
    const winDates = this.dataStore?.releaseWinDates?.get(lineId);
    if (!winDates || winDates.length === 0) return 0;
    const currentDate = this.state.dates[this.state.currentDateIndex] ?? "";
    if (!currentDate) return 0;
    // winDates is sorted chronologically — count entries <= currentDate
    let count = 0;
    for (const d of winDates) {
      if (d <= currentDate) count++;
      else break;
    }
    return count;
  }

  // --- Private: Utility ---

  private getReleaseTitleFromMeta(meta: { label: string; artistId: string; releaseId?: string }): string | undefined {
    if (!meta.releaseId || !this.dataStore) return undefined;
    const artist = this.dataStore.artists.get(meta.artistId);
    if (!artist) return undefined;
    const release = artist.releases.find(r => r.id === meta.releaseId);
    return release?.title;
  }

  private getCrownLabel(level: number): string {
    if (level % 3 === 0) {
      const tripleCrownCount = level / 3;
      if (tripleCrownCount === 1) return "Triple Crown";
      return `${this.getOrdinal(tripleCrownCount)} Triple Crown`;
    }
    return `${this.getOrdinal(level)} Win`;
  }

  private getOrdinal(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /** Find the nearest date index for a date string not in the dates array */
  private findNearestDateIndex(date: string): number {
    const dates = this.state.dates;
    // Binary search for insertion point
    let lo = 0;
    let hi = dates.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] < date) lo = mid + 1;
      else if (dates[mid] > date) hi = mid - 1;
      else return mid;
    }
    // lo is the insertion point — return the closest existing index
    if (lo >= dates.length) return dates.length - 1;
    if (lo === 0) return 0;
    // Pick whichever neighbor is closer in time
    return lo;
  }

  private formatDateLabel(dateStr: string): string {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return dateStr;
    }
  }
}
