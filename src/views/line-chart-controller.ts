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
  /** Whether initial data has been sent to worker */
  private initialized = false;
  /** Background layer needs full redraw */
  private backgroundDirty = true;
  /** Whether popover is currently open */
  private popoverOpen = false;
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

    // Request initial frame
    requestAnimationFrame(() => {
      this.backgroundDirty = true;
      this.requestFrame();
    });
  }

  setDateIndex(index: number): void {
    this.state.currentDateIndex = index;
    if (this.state.playing) {
      // During playback: viewport right edge IS the current date (progressive reveal)
      const zoomWindow = PRESET_DAYS[this.state.timeZoom] === Infinity
        ? this.state.dates.length
        : PRESET_DAYS[this.state.timeZoom];

      this.state.viewportEnd = index;
      this.state.viewportStart = Math.max(0, index - zoomWindow);
      this.backgroundDirty = true;
    }
    this.requestFrame();
  }

  setPlaying(playing: boolean): void {
    this.state.playing = playing;
    if (playing) {
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

    if (filterState.displayMode !== this.state.displayMode) {
      this.state.displayMode = filterState.displayMode;
      if (this.dataStore && this.initialized) {
        this.rebuildLineData();
      }
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
    const dateIndex = new Map<string, number>();
    for (let i = 0; i < dataStore.dates.length; i++) {
      dateIndex.set(dataStore.dates[i], i);
    }
    const dateToIndex = (d: string) => dateIndex.get(d) ?? -1;

    const serialized: SerializedLineData[] = [];
    this.lineMetadata.clear();

    if (mode === "songs") {
      for (const artist of dataStore.artists.values()) {
        const color = ARTIST_TYPE_COLORS[artist.artistType];
        for (const release of artist.releases) {
          if (release.dailyValues.size === 0) continue;
          const lineId = `${artist.id}::${release.id}`;
          const series = buildSeriesFromDailyValues(release.dailyValues, dateToIndex);
          if (series.length === 0) continue;

          const label = `${artist.name} \u2014 ${release.title}`;
          serialized.push({ lineId, label, color, changePoints: series.toArray() });
          this.lineMetadata.set(lineId, { label, artistId: artist.id, releaseId: release.id });
        }
      }
    } else {
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
    if (now - this.lastFrameTime < 16) return;
    this.lastFrameTime = now;
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
    const fgCtx = this.renderer.getContext("foreground");
    if (fgCtx && result.foreground.length > 0) {
      this.drawEndpointLabels(fgCtx, result.foreground);
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
    const startDate = this.state.dates[this.state.viewportStart] ?? "";
    const endDate = this.state.dates[this.state.viewportEnd] ?? "";

    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.font = "10px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(this.formatDateLabel(startDate), chart.x + 8, chart.y + chart.h + 20);
    ctx.textAlign = "right";
    ctx.fillText(this.formatDateLabel(endDate), chart.x + chart.w, chart.y + chart.h + 20);
  }

  private drawEndpointLabels(ctx: CanvasRenderingContext2D, commands: LineDrawCommand[]): void {
    this.labelHitBoxes = []; // reset

    // Collect label candidates (only visible lines, opacity > 0.5)
    const labeled = commands
      .filter(cmd => cmd.points.length >= 2 && cmd.opacity > 0.5)
      .map(cmd => ({
        lineId: cmd.lineId,
        endPoint: cmd.points[cmd.points.length - 1],
        color: cmd.color,
        opacity: cmd.opacity,
        finalValue: cmd.values.length > 0 ? cmd.values[cmd.values.length - 1] : 0,
      }))
      .sort((a, b) => a.endPoint.y - b.endPoint.y)
      .slice(0, 10);

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
          ? `${finalValue.toLocaleString()} \u00B7 ${wins}W`
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
            ? `${finalValue.toLocaleString()} \u00B7 ${wins}W`
            : `${finalValue.toLocaleString()}`;
          ctx.font = "8px system-ui, -apple-system, sans-serif";
          ctx.globalAlpha = 0.7;
          ctx.fillText(statsText, lastPt.x + 6, lastPt.y + 8);
          ctx.globalAlpha = 1;
        }
      }

      // Draw event dots on the highlighted line
      this.drawEventDotsForLine(ctx, cmd);
    }
  }

  private drawEventDotsForLine(ctx: CanvasRenderingContext2D, cmd: LineDrawCommand): void {
    // Look up events from the DataStore for this line
    if (!this.dataStore) return;

    const meta = this.lineMetadata.get(cmd.lineId);
    if (!meta) return;

    const artist = this.dataStore.artists.get(meta.artistId);
    if (!artist) return;

    // Get win dates for this release
    const releaseWinDates = this.dataStore.releaseWinDates?.get(cmd.lineId);
    if (!releaseWinDates || releaseWinDates.length === 0) return;

    // Map win dates to point indices within the current viewport
    const viewStart = this.state.viewportStart;
    const viewEnd = this.state.viewportEnd;
    const viewRange = viewEnd - viewStart;
    const totalPoints = cmd.points.length;

    const drawnIndices = new Set<number>();

    for (const winDate of releaseWinDates) {
      const dateIdx = this.state.dates.indexOf(winDate);
      if (dateIdx < viewStart || dateIdx > viewEnd) continue;

      // Map date index to point index
      const pointIdx = Math.round(((dateIdx - viewStart) / viewRange) * (totalPoints - 1));
      if (pointIdx < 0 || pointIdx >= totalPoints) continue;
      if (drawnIndices.has(pointIdx)) continue;
      drawnIndices.add(pointIdx);

      const pt = cmd.points[pointIdx];
      this.drawEventDot(ctx, pt.x, pt.y, "win", EVENT_DOT_SIZE);
    }
  }

  private drawEventDot(ctx: CanvasRenderingContext2D, x: number, y: number, type: string, size: number): void {
    ctx.save();
    const s = size * 1.8; // larger dots (prototype: 8 * 1.8)

    if (type === "win") {
      // Crown shape — white fill
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x - s, y + s * 0.4);
      ctx.lineTo(x - s * 0.5, y);
      ctx.lineTo(x, y + s * 0.4);
      ctx.lineTo(x + s * 0.5, y);
      ctx.lineTo(x + s, y + s * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      // White filled circle for all other types
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- Private: Viewport management (handled in setDateIndex during playback) ---

  // --- Private: Hit detection (matching prototype exactly) ---

  /** Find lines near a CSS point, returns lineId + nearest point index */
  private findLinesAtPoint(x: number, y: number): { rd: RenderLineData; nearestIndex: number }[] {
    const hits: { rd: RenderLineData; nearestIndex: number }[] = [];

    for (const rd of this.renderDataCache) {
      if (rd.opacity <= 0) continue;
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

    const selectedId = this.state.selectedLineIds[0];
    const rd = this.renderDataCache.find(r => r.lineId === selectedId);
    if (!rd) return null;

    // Look up win dates for this line
    const releaseWinDates = this.dataStore?.releaseWinDates?.get(selectedId);
    if (!releaseWinDates || releaseWinDates.length === 0) return null;

    const viewStart = this.state.viewportStart;
    const viewEnd = this.state.viewportEnd;
    const viewRange = viewEnd - viewStart;
    const totalPoints = rd.points.length;

    for (const winDate of releaseWinDates) {
      const dateIdx = this.state.dates.indexOf(winDate);
      if (dateIdx < viewStart || dateIdx > viewEnd) continue;

      const pointIdx = Math.round(((dateIdx - viewStart) / viewRange) * (totalPoints - 1));
      if (pointIdx < 0 || pointIdx >= totalPoints) continue;

      const pt = rd.points[pointIdx];
      const dist = Math.hypot(x - pt.x, y - pt.y);
      if (dist <= 10) {
        return { lineId: selectedId, dateIndex: dateIdx, eventTypes: ["win"] };
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
        const eventLabel = "Chart Win";
        this.showRichTooltip(x, y, rd, this.getNearestPointIndex(rd, x), eventLabel, true);
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
    const meta = this.lineMetadata.get(dotHit.lineId);
    if (!meta || !this.dataStore) return;

    const artist = this.dataStore.artists.get(meta.artistId);
    if (!artist) return;

    const hoveredDate = this.state.dates[dotHit.dateIndex] ?? "";
    const formattedDate = this.formatDateLabel(hoveredDate);
    const color = ARTIST_TYPE_COLORS[artist.artistType];
    const artistTypeLabel = ARTIST_TYPE_LABELS[artist.artistType] ?? "";
    const genLabel = `Gen ${artist.generation}`;

    // Compute cumulative value
    let cumulativeValue = 0;
    let dailyGain = 0;
    if (meta.releaseId) {
      const release = artist.releases.find(r => r.id === meta.releaseId);
      if (release) {
        let total = 0;
        let todayValue = 0;
        for (const [d, entry] of release.dailyValues) {
          if (d <= hoveredDate) {
            total += entry.value;
            if (d === hoveredDate) todayValue = entry.value;
          }
        }
        cumulativeValue = total;
        dailyGain = todayValue;
      }
    }

    // Get source for this date
    let sourceLabel: string | undefined;
    let sourceLogoUrl: string | undefined;
    if (meta.releaseId) {
      const release = artist.releases.find(r => r.id === meta.releaseId);
      const entry = release?.dailyValues.get(hoveredDate);
      if (entry?.source) {
        sourceLabel = SOURCE_LABELS[entry.source] ?? entry.source;
        sourceLogoUrl = SOURCE_LOGO_URLS[entry.source];
      }
    }

    const eventLabel = dotHit.eventTypes.map(t => {
      const labels: Record<string, string> = {
        win: "Chart Win", live_performance: "Live Performance",
        chart_appearance: "Chart Appearance", mv: "Music Video", release: "Comeback",
      };
      return labels[t] ?? t;
    }).join(" \u00B7 ");

    // Get position from tooltip
    const position = this.tooltip?.getPosition() ?? { left: "0px", top: "0px" };

    this.popover?.show({
      artistName: artist.name,
      songTitle: this.getReleaseTitleFromMeta(meta) ?? meta.label,
      color,
      value: cumulativeValue > 0 ? cumulativeValue : undefined,
      dailyGain: dailyGain > 0 ? dailyGain : undefined,
      date: formattedDate,
      sourceLogoUrl,
      sourceLabel,
      eventLabel,
      artistTypeLabel,
      generationLabel: genLabel,
      logoUrl: artist.logoUrl,
      hasVideo: false,
      hasRelease: false,
    }, position);

    this.tooltip?.hide();
    this.popoverOpen = true;
  }

  private hidePopover(): void {
    this.popover?.hide();
    this.popoverOpen = false;
  }

  // --- Private: Rich tooltip (matching prototype showTooltip) ---

  private showRichTooltip(x: number, y: number, rd: RenderLineData, nearestIndex: number, eventLabel?: string, showEmbed?: boolean): void {
    const meta = this.lineMetadata.get(rd.lineId);
    if (!meta) return;

    const artist = this.dataStore?.artists.get(meta.artistId);
    const color = rd.color;
    const artistTypeLabel = artist ? ARTIST_TYPE_LABELS[artist.artistType] ?? "" : "";
    const genLabel = artist ? `Gen ${artist.generation}` : "";

    // Get value at nearest point
    const value = rd.values[nearestIndex] ?? 0;
    let dailyGain: number | undefined;
    if (nearestIndex > 0 && rd.values[nearestIndex - 1] !== undefined) {
      const gain = value - rd.values[nearestIndex - 1];
      if (gain > 0) dailyGain = gain;
    }

    // Reverse-map nearest point x → date for display
    const { width } = this.renderer!.getSize();
    const chartW = width - PADDING.left - PADDING.right;
    const ptX = rd.points[nearestIndex]?.x ?? x;
    const xRatio = Math.max(0, Math.min(1, (ptX - PADDING.left) / chartW));
    const viewRange = this.state.viewportEnd - this.state.viewportStart;
    const dateIndex = Math.round(this.state.viewportStart + xRatio * viewRange);
    const hoveredDate = this.state.dates[dateIndex] ?? "";
    const formattedDate = this.formatDateLabel(hoveredDate);

    // Get chart source for this date
    let sourceLabel: string | undefined;
    let sourceLogoUrl: string | undefined;
    if (artist && meta.releaseId) {
      const release = artist.releases.find(r => r.id === meta.releaseId);
      const entry = release?.dailyValues.get(hoveredDate);
      if (entry?.source) {
        sourceLabel = SOURCE_LABELS[entry.source] ?? entry.source;
        sourceLogoUrl = SOURCE_LOGO_URLS[entry.source];
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
      showEmbed,
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

  /** Get win count for a given line */
  private getWinCount(lineId: string): number {
    const winDates = this.dataStore?.releaseWinDates?.get(lineId);
    return winDates?.length ?? 0;
  }

  // --- Private: Utility ---

  private getReleaseTitleFromMeta(meta: { label: string; artistId: string; releaseId?: string }): string | undefined {
    if (!meta.releaseId || !this.dataStore) return undefined;
    const artist = this.dataStore.artists.get(meta.artistId);
    if (!artist) return undefined;
    const release = artist.releases.find(r => r.id === meta.releaseId);
    return release?.title;
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
