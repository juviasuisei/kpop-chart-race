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
import { SpatialIndex } from "../canvas/spatial-index.ts";
import { InteractionLayer } from "../canvas/interaction-layer.ts";
import { Tooltip } from "../canvas/tooltip.ts";
import { Disambiguation } from "../canvas/disambiguation.ts";
import { Popover } from "../canvas/popover.ts";
import { Legend } from "../canvas/legend.ts";
import { buildSeriesFromDailyValues, mergeSeries, SparseTimeSeries } from "../worker/sparse-time-series.ts";
import { ARTIST_TYPE_COLORS } from "../colors.ts";
import type { EventBus } from "../event-bus.ts";
import type { DataStore } from "../models.ts";
import type { FilterState } from "../types.ts";
import type { SerializedLineData, FrameResultMessage, Viewport, VisibilityParams, LineDrawCommand } from "../worker/messages.ts";

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
  private spatialIndex: SpatialIndex;
  private interaction: InteractionLayer | null = null;
  private tooltip: Tooltip | null = null;
  private disambiguation: Disambiguation | null = null;
  private popover: Popover | null = null;
  private legend: Legend | null = null;

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

  /** Callback for when the controller needs playback to advance */
  onRequestDateAdvance: ((dateIndex: number) => void) | null = null;
  /** Callback for update complete */
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
    console.log("[LineChart] Built", lines.length, "lines for worker. First:", lines[0]?.lineId, "points:", lines[0]?.changePoints.length);

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
      this.autoScrollViewport();
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
    this.interaction?.destroy();
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
      console.log("[LineChart] requestFrame: size is 0, retrying...", width, height);
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

    // Update spatial index
    this.rebuildSpatialIndex(result);

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
    // Collect label candidates (only visible lines, opacity > 0.5)
    const labeled = commands
      .filter(cmd => cmd.points.length >= 2 && cmd.opacity > 0.5)
      .map(cmd => ({
        lineId: cmd.lineId,
        endPoint: cmd.points[cmd.points.length - 1],
        color: cmd.color,
        opacity: cmd.opacity,
      }))
      .sort((a, b) => a.endPoint.y - b.endPoint.y);

    // Stagger to avoid overlap (MIN_GAP = 18px)
    const resolvedPositions: { y: number; lineId: string; endPoint: { x: number; y: number }; color: string; opacity: number }[] = [];

    for (const item of labeled) {
      let labelY = item.endPoint.y;
      for (const placed of resolvedPositions) {
        if (Math.abs(labelY - placed.y) < MIN_GAP) {
          labelY = placed.y + MIN_GAP;
        }
      }
      resolvedPositions.push({ ...item, y: labelY });
    }

    for (const { y: labelY, lineId, endPoint, color, opacity } of resolvedPositions) {
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
      ctx.font = "8px system-ui, -apple-system, sans-serif";
      ctx.globalAlpha = opacity * 0.7;
      // TODO: worker doesn't include final value in draw command yet
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

        // Stats line
        ctx.font = "8px system-ui, -apple-system, sans-serif";
        ctx.globalAlpha = 0.7;
        // TODO: include value from worker
        ctx.globalAlpha = 1;
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

  // --- Private: Spatial index ---

  private rebuildSpatialIndex(result: FrameResultMessage): void {
    const { width, height, dpr } = this.renderer!.getSize();
    this.spatialIndex.resize(width, height);
    this.spatialIndex.clear();

    const indexable = [...result.foreground, ...result.highlight];
    for (const cmd of indexable) {
      if (cmd.points.length < 2) continue;
      const cssPoints = cmd.points.map(p => ({ x: p.x / dpr, y: p.y / dpr }));
      this.spatialIndex.insert({ lineId: cmd.lineId, points: cssPoints });
    }
  }

  // --- Private: Viewport management ---

  private autoScrollViewport(): void {
    const current = this.state.currentDateIndex;
    const viewportRange = this.state.viewportEnd - this.state.viewportStart;

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
    this.disambiguation?.hide();
    this.tooltip?.hide();
    this.backgroundDirty = true;
    this.requestFrame();
  };

  private handleHover = (lineId: string | null, x: number, y: number): void => {
    // Don't update hover while disambiguation or popover is open
    if (this.disambiguation?.isVisible()) return;
    if (this.popoverOpen) return;

    if (lineId) {
      const meta = this.lineMetadata.get(lineId);
      if (meta) {
        // Get artist info for rich tooltip
        const artist = this.dataStore?.artists.get(meta.artistId);
        const color = artist ? ARTIST_TYPE_COLORS[artist.artistType] : "#666";
        const artistTypeLabel = artist ? ARTIST_TYPE_LABELS[artist.artistType] ?? "" : "";
        const genLabel = artist ? `Gen ${artist.generation}` : "";

        this.tooltip?.show({
          label: meta.label,
          artistName: artist?.name ?? meta.label,
          songTitle: meta.releaseId ? this.getReleaseTitleFromMeta(meta) : undefined,
          color,
          artistTypeLabel,
          generationLabel: genLabel,
          logoUrl: artist?.logoUrl,
        }, x, y);
      }
      this.eventBus.emit("line:hover", { lineId, label: meta?.label ?? lineId, x, y });
    } else {
      this.tooltip?.hide();
      this.eventBus.emit("line:hover", null);
    }
  };

  private handleClick = (lineId: string | null, multiSelect: boolean): void => {
    // If disambiguation is open, hide it
    if (this.disambiguation?.isVisible()) {
      this.disambiguation.hide();
      return;
    }

    if (lineId) {
      // If popover is open, close it first (stay in highlight)
      if (this.popoverOpen) {
        this.hidePopover();
        return;
      }

      // If already selected, clicking deselects
      if (this.state.selectedLineIds.length > 0 && !multiSelect) {
        this.clearSelection();
        return;
      }

      // Select this line
      this.selectLine(lineId, multiSelect);
    } else {
      // Clicked empty space
      if (this.popoverOpen) {
        // First click outside: close popover, stay in highlight mode
        this.hidePopover();
        return;
      }
      // Second click outside: deselect
      this.clearSelection();
    }
  };

  private handlePanStart = (): void => {
    // No-op
  };

  private handlePan = (deltaX: number): void => {
    this.panByPixels(deltaX);
  };

  private handlePanEnd = (): void => {
    // No-op
  };

  private handlePinchZoom = (scaleFactor: number, centerX: number): void => {
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
  };

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

  private hidePopover(): void {
    this.popover?.hide();
    this.popoverOpen = false;
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
