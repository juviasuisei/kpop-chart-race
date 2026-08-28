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
import { buildSeriesFromDailyValues, mergeSeries, SparseTimeSeries } from "../worker/sparse-time-series.ts";
import { ARTIST_TYPE_COLORS } from "../colors.ts";
import { resolveFrameAdvance } from "../playback-frame.ts";
import type { EventBus } from "../event-bus.ts";
import type { DataStore } from "../models.ts";
import type { FilterState } from "../types.ts";
import type { SerializedLineData, FrameResultMessage, Viewport, VisibilityParams, LineDrawCommand, PixelPoint } from "../worker/messages.ts";

/**
 * Format an array of names with Oxford comma.
 * 1 name: "A"
 * 2 names: "A and B"
 * 3+ names: "A, B, and C"
 */
function formatOxfordComma(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Minimal shape needed to compute endpoint label display priority. */
export interface LabelPriorityCandidate {
  lineId: string;
  /** Pixel Y position of the label's anchor point. */
  y: number;
  finalValue: number;
  lastActivityIdx: number;
}

/**
 * Order label candidates by display priority so that, when two or more
 * labels collide (endpoints closer together than MIN_GAP), the correct
 * one is placed first and wins the slot.
 *
 * Rule:
 *   - The base order is value descending -- in this chart's linear
 *     value->pixel mapping, that is exactly the same order as Y ascending,
 *     so this is also already "most prominent/highest value first", with
 *     no extra work needed for the <= 5 (value-wins) case.
 *   - Find genuine pile-ups: contiguous runs (in that Y/value order) whose
 *     members are all mutually within `pileupGap` of each other (a clique,
 *     i.e. the run's Y-span is < pileupGap). Within a pile-up run of size
 *     > 5, and ONLY within that run, override the order to prefer the most
 *     recently active line, using value as a tie-break.
 *   - The single highest-value ("#1") line is then pinned to the very
 *     front, in case it was swept into some pile-up run's reordering.
 *
 * `pileupGap` is deliberately much tighter than the MIN_GAP used to decide
 * whether a label needs to be hidden at all. MIN_GAP is about how much
 * vertical space a label needs to avoid overlapping another label -- wide
 * enough that, in the busier parts of this chart, it also sweeps in several
 * meaningfully different-valued lines that just happen to be nearby, which
 * a human looking at the chart would never consider "tied". A genuine
 * pile-up (e.g. dozens of songs sitting near zero at the very start of the
 * race) has lines within a couple pixels of each other, not within a whole
 * label-height -- so the >5/recency exception should only fire for that
 * much tighter kind of crowding, while the actual show/hide collision test
 * for placement keeps using the wider MIN_GAP.
 *
 * This is deliberately NOT implemented as a single global sort comparator
 * that branches per-pair on "does either side belong to some pile-up"
 * (`aCluster > 5 || bCluster > 5`). `Array.prototype.sort` calls its
 * comparator on many arbitrary pairs while sorting, including candidates
 * that aren't anywhere near each other -- so a candidate that isn't part of
 * any pile-up itself can still get compared, mid-sort, against some
 * unrelated candidate that IS part of a real pile-up elsewhere in the
 * chart, tripping the recency branch for that comparison and contaminating
 * its rank for no reason connected to its own situation. That comparator
 * also isn't a valid total order (whether recency or value applies depends
 * on which two items happen to be compared), which is undefined behavior
 * for sort and produced wildly wrong results (e.g. an isolated, genuinely
 * 2-way tied pair ranked 70+ places apart). Reordering only within
 * self-contained runs -- and never touching anything outside a run's own
 * slice -- avoids all of this: two lines are only compared to each other
 * using the recency rule if they are actually both part of the same
 * genuine pile-up.
 */
export function orderLabelsByPriority<T extends LabelPriorityCandidate>(
  candidates: T[],
  pileupGap: number = PILEUP_GAP,
  pinnedLineId?: string,
): T[] {
  if (candidates.length === 0) return [];

  // Base order: Y ascending == value descending in this chart's linear
  // mapping, i.e. "highest value first" with no further work.
  const result = [...candidates].sort((a, b) => a.y - b.y);
  const n = result.length;

  // maxHi[lo] = the largest index hi such that result[hi].y - result[lo].y
  // < pileupGap (the farthest-reaching window starting at lo that stays a
  // mutual clique).
  const maxHi: number[] = new Array(n);
  let hi = 0;
  for (let lo = 0; lo < n; lo++) {
    if (hi < lo) hi = lo;
    while (hi + 1 < n && result[hi + 1].y - result[lo].y < pileupGap) hi++;
    maxHi[lo] = hi;
  }

  // Walk left to right, taking the largest run STARTING at each position.
  // Any position that could belong to a larger run starting earlier has
  // already been consumed by that earlier run, so this partitions the
  // array into non-overlapping runs.
  let i = 0;
  while (i < n) {
    const runEnd = maxHi[i];
    const runSize = runEnd - i + 1;
    if (runSize > 5) {
      // Genuine pile-up: re-sort just this slice by recency (value as
      // tie-break), without touching anything outside it.
      const slice = result.slice(i, runEnd + 1);
      slice.sort((a, b) => b.lastActivityIdx - a.lastActivityIdx || b.finalValue - a.finalValue);
      for (let k = 0; k < slice.length; k++) result[i + k] = slice[k];
      i = runEnd + 1;
    } else {
      i++;
    }
  }

  // #1 always wins, even if it got swept into some pile-up run's reorder.
  const maxValue = Math.max(...candidates.map(c => c.finalValue));
  const topIndex = result.findIndex(c => c.finalValue === maxValue);
  if (topIndex > 0) {
    const [top] = result.splice(topIndex, 1);
    result.unshift(top);
  }

  // The pinned artist wins the top label slot outright — above even #1 — so
  // the artist the user filtered to always gets its label placed.
  if (pinnedLineId !== undefined) {
    const pinIndex = result.findIndex(c => c.lineId === pinnedLineId);
    if (pinIndex > 0) {
      const [pinned] = result.splice(pinIndex, 1);
      result.unshift(pinned);
    }
  }

  return result;
}

/**
 * Determine which drawn line commands are eligible to compete for an
 * endpoint label slot.
 *
 * Endpoint labels must include both foreground (opacity > 0.5) AND
 * background (opacity > 0.5 down to the ~0.05 cutoff `drawEndpointLabels`
 * itself applies) lines. Restricting this to foreground only would let a
 * line "win" a label slot merely because its real competitor had already
 * faded into the background layer, without ever actually comparing them
 * via the value/recency tie-break rule.
 */
export function getLabelCandidateCommands(result: {
  background: LineDrawCommand[];
  foreground: LineDrawCommand[];
}): LineDrawCommand[] {
  return [...result.background, ...result.foreground];
}

/** Time zoom presets — each has a different data aggregation level */
export type TimeZoomPreset = "daily" | "year" | "decade" | "all";

/** Viewport window size for each preset (in aggregated units) */
const PRESET_WINDOW: Record<TimeZoomPreset, number> = {
  "daily": 90,     // 90 days
  "year": 52,      // ~52 weeks
  "decade": 120,   // ~120 months (10 years)
  "all": Infinity,
};

// --- Constants matching prototype exactly ---
const PADDING = { top: 40, right: 210, bottom: 40, left: 0 };
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
const MAX_LABEL_WIDTH = 175;
/**
 * Tight pixel threshold used only to decide whether candidates form a
 * genuine visual pile-up for the endpoint-label tie-break rule (see
 * orderLabelsByPriority). Deliberately much smaller than MIN_GAP: MIN_GAP
 * is about how much vertical space a label needs to not overlap another
 * label, which is generous enough to also sweep in several meaningfully
 * different-valued, merely-nearby lines in the busier parts of the chart.
 * A real pile-up (e.g. dozens of songs sitting near zero at the very start
 * of the race) has lines within a couple pixels of each other, not within
 * a whole label-height.
 */
const PILEUP_GAP = 4;

/** Artist type display labels */
const ARTIST_TYPE_LABELS: Record<string, string> = {
  boy_group: "Boy Group",
  girl_group: "Girl Group",
  solo_male: "Solo Male",
  solo_female: "Solo Female",
  mixed_group: "Mixed Group",
  solo_non_binary: "Solo Non-Binary",
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
  /** Pinned artist (Artists-mode filter): always visible + top label priority. */
  pinnedArtistId: string;
  /** Y-axis ceiling as a fraction (0..1] of the auto max. 1 = full range. */
  valueCeiling: number;
}

export class LineChartController {
  private eventBus: EventBus;
  private dataStore: DataStore | null = null;
  private workerClient: ChartWorkerClient;
  private renderer: CanvasRenderer | null = null;
  private tooltip: Tooltip | null = null;
  private disambiguation: Disambiguation | null = null;
  private popover: Popover | null = null;

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
    timeZoom: "daily",
    playing: false,
    speed: 0.8,
    selectedLineIds: [],
    filterCount: 0,
    artistFilterActive: false,
    displayMode: "songs",
    pinnedArtistId: "all",
    valueCeiling: 1,
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
  /** Cached set of dates that have chart data (for animation speed-up) */
  private datesWithData: Set<string> = new Set();
  /** Cached last activity date index per lineId (for label priority) */
  private lastActivityByLine: Map<string, number> = new Map();
  /** Whether popover is currently open */
  private popoverOpen = false;
  /** Current generation filter */
  private currentGenFilter: number | "all" = "all";
  /** Current source filter */
  private currentSourceFilter: string = "all";
  /** Current artist filter */
  private currentArtistFilter: string = "all";
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

    // Precompute dates with chart data for animation speed-up
    this.datesWithData = new Set<string>();
    for (const artist of dataStore.artists.values()) {
      for (const release of artist.releases) {
        for (const date of release.dailyValues.keys()) {
          this.datesWithData.add(date);
        }
      }
    }

    // Default: show most recent 90 days, paused at the last date
    this.state.currentDateIndex = this.state.dates.length - 1;
    this.applyTimeZoom("daily");

    // Build serialized line data for the worker
    const lines = this.buildLineData(dataStore, this.state.displayMode);

    // Precompute last activity date index per line for label priority
    this.buildLastActivityCache(dataStore);

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
    const zoomWindow = PRESET_WINDOW[this.state.timeZoom] === Infinity
      ? this.state.dates.length
      : PRESET_WINDOW[this.state.timeZoom];

    this.state.viewportEnd = index;
    // The x-axis always spans the full zoom window so the horizontal scale is
    // stable regardless of where the scrubber sits. Before the window is
    // filled, viewportStart is negative — those pre-data indices map to empty
    // left-side space rather than stretching the few revealed days full-width.
    this.state.viewportStart = index - zoomWindow;
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

  /**
   * Set animation speed (dates per second) for the rAF loop.
   * Default is 0.8. Higher values = faster playback.
   */
  setSpeed(datesPerSecond: number): void {
    this.state.speed = datesPerSecond;
  }

  /**
   * Set the y-axis value ceiling as a fraction (0..1] of the auto-computed max.
   * Values below 1 zoom in on the lower cluster of lines (e.g. 0.1 shows the
   * bottom 10% of the value range full-height). 1 restores the full range.
   * Re-renders immediately so the change is visible while paused.
   */
  setValueCeiling(fraction: number): void {
    const clamped = Math.max(0.01, Math.min(1, fraction));
    if (clamped === this.state.valueCeiling) return;
    this.state.valueCeiling = clamped;
    this.backgroundDirty = true;
    this.requestFrame();
  }

  applyTimeZoom(preset: TimeZoomPreset): void {
    this.state.timeZoom = preset;
    const totalDates = this.state.dates.length;

    if (preset === "all" || PRESET_WINDOW[preset] >= totalDates) {
      this.state.viewportStart = 0;
      this.state.viewportEnd = totalDates - 1;
    } else {
      const windowSize = PRESET_WINDOW[preset];
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
    // Keep the window a fixed width while panning (shift both edges together).
    let newStart = this.state.viewportStart - dateDelta;
    let newEnd = this.state.viewportEnd - dateDelta;

    // The right edge can't pass the last date; the left edge is allowed to go
    // negative (empty space before the first data day) so the window keeps its
    // full width even near the start — matching the rolling-window scale used
    // during playback, rather than snapping the left edge to day 0.
    if (newEnd > totalDates - 1) {
      const over = newEnd - (totalDates - 1);
      newStart -= over;
      newEnd -= over;
    }
    // Lower bound: don't scroll so far left that the whole window sits before
    // the data (keep at least the first day visible at the right edge).
    if (newEnd < 0) {
      const under = -newEnd;
      newStart += under;
      newEnd += under;
    }

    this.state.viewportStart = newStart;
    this.state.viewportEnd = newEnd;

    // The current date follows the window's right edge. This drives both the
    // vertical-axis max (the worker scales Y to currentDateIndex) and the
    // scrubber position — without it, panning forward would let lines shoot off
    // the top and leave the scrubber stale. Emit date:change so the scrubber /
    // date label / URL stay in sync, mirroring how scrubbing behaves.
    const newIndex = Math.max(0, Math.min(totalDates - 1, newEnd));
    if (newIndex !== this.state.currentDateIndex) {
      this.state.currentDateIndex = newIndex;
      const date = this.state.dates[newIndex];
      if (date) this.eventBus.emit("date:change", date);
    }

    this.backgroundDirty = true;
    this.requestFrame();
  }

  setFilters(filterState: FilterState): void {
    let filterCount = 0;
    if (filterState.generation !== "all") filterCount++;
    if (filterState.source !== "all") filterCount++;
    if (filterState.artist !== "all") filterCount++;

    this.state.filterCount = filterCount;
    this.state.artistFilterActive = filterState.artist !== "all";

    // Rebuild line data if any filter changed (generation, source, artist, or displayMode)
    const filtersChanged = this.currentGenFilter !== filterState.generation ||
      this.currentSourceFilter !== filterState.source ||
      this.currentArtistFilter !== filterState.artist ||
      filterState.displayMode !== this.state.displayMode;

    this.currentGenFilter = filterState.generation;
    this.currentSourceFilter = filterState.source;
    this.currentArtistFilter = filterState.artist;

    if (filterState.displayMode !== this.state.displayMode) {
      this.state.displayMode = filterState.displayMode;
    }

    if (filtersChanged && this.dataStore && this.initialized) {
      this.rebuildLineData();
    }

    this.backgroundDirty = true;
    this.requestFrame();
  }

  /**
   * Set the "pinned" artist (from the Artists-mode artist filter). Their line
   * is treated like #1 for visibility — always full opacity and top label
   * priority — without the clicked-selection highlight styling. "all" clears
   * the pin. Does not rebuild line data (all lines stay present); only affects
   * per-frame visibility, so a lightweight frame request suffices.
   */
  setPinnedArtist(artistId: string): void {
    if (this.state.pinnedArtistId === artistId) return;
    this.state.pinnedArtistId = artistId;
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
      const processedReleases = new Set<string>();
      for (const artist of dataStore.artists.values()) {
        // Generation filter
        if (this.currentGenFilter !== "all" && artist.generation !== this.currentGenFilter) continue;

        for (const release of artist.releases) {
          if (release.dailyValues.size === 0) continue;

          // Deduplicate multi-artist releases: only process from the first artist in artistIds
          if (release.artistIds.length > 1 && release.artistIds[0] !== artist.id) continue;
          const dedupeKey = `${release.artistIds[0]}::${release.id}`;
          if (processedReleases.has(dedupeKey)) continue;
          processedReleases.add(dedupeKey);

          // Artist filter: match if the filtered artist is ANY of the credited artists
          if (this.currentArtistFilter !== "all" && !release.artistIds.includes(this.currentArtistFilter)) continue;

          const color = ARTIST_TYPE_COLORS[artist.artistType];

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

          const lineId = `${release.artistIds[0]}::${release.id}`;
          const series = buildSeriesFromDailyValues(filteredDailyValues, dateToIndex);
          if (series.length === 0) continue;

          // Build label with all credited artist names (Oxford comma)
          const artistNames = release.artistIds.map(id => {
            const a = dataStore.artists.get(id);
            return a?.name ?? id;
          });
          const artistLabel = formatOxfordComma(artistNames);
          const label = `${release.title} \u2014 ${artistLabel}`;
          serialized.push({ lineId, label, color, changePoints: series.toArray(), artistId: release.artistIds[0] });
          this.lineMetadata.set(lineId, { label, artistId: release.artistIds[0], releaseId: release.id });
        }
      }
    } else {
      for (const artist of dataStore.artists.values()) {
        // Generation filter
        if (this.currentGenFilter !== "all" && artist.generation !== this.currentGenFilter) continue;
        // Artist filter
        if (this.currentArtistFilter !== "all" && artist.id !== this.currentArtistFilter) continue;

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
        serialized.push({ lineId, label, color, changePoints: merged.toArray(), artistId: artist.id });
        this.lineMetadata.set(lineId, { label, artistId: artist.id });
      }
    }

    return serialized;
  }

  private async rebuildLineData(): Promise<void> {
    if (!this.dataStore) return;
    const lines = this.buildLineData(this.dataStore, this.state.displayMode);
    this.buildLastActivityCache(this.dataStore);
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
    // First step (D0→D1) is 2x faster, all others use configurable speed
    const isFirstStep = this.animationPosition < 1;
    const speed = isFirstStep ? 2.0 : this.state.speed;
    const advance = (deltaMs / 1000) * speed;

    // Speed up 2.5x through dates with no chart data (empty days between shows)
    const nextDateIdx = Math.min(Math.floor(this.animationPosition) + 1, this.state.dates.length - 1);
    const nextDate = this.state.dates[nextDateIdx];
    const emptyDayMultiplier = nextDate && !this.hasChartDataOnDate(nextDate) ? 2.5 : 1.0;
    this.animationPosition += advance * emptyDayMultiplier;

    // Resolve this frame: clamp position, derive the index, and decide whether
    // to emit. Stop the RAF loop when the end is reached, but keep
    // state.playing = true until AFTER the final date:change below — the
    // date:change handler only advances the scrubber while playing, so flipping
    // playing off first would leave the scrubber a few spots short of the edge.
    const maxIndex = this.state.dates.length - 1;
    const frame = resolveFrameAdvance(
      this.animationPosition,
      this.state.currentDateIndex,
      maxIndex,
    );
    this.animationPosition = frame.position;
    if (frame.reachedEnd) {
      this.stopAnimationLoop();
    }

    // Emit the smooth fractional position every frame so the scrubber thumb
    // glides continuously (date:change below only fires on integer changes).
    this.eventBus.emit("playback:progress", frame.position);

    if (frame.shouldEmit) {
      this.state.currentDateIndex = frame.index;
      // Emit date:change so PlaybackController's scrubber stays in sync
      if (this.state.dates[frame.index]) {
        this.eventBus.emit("date:change", this.state.dates[frame.index]);
      }
    }

    // Now that the scrubber has been synced to the final position, end playback.
    if (frame.reachedEnd) {
      this.state.playing = false;
      this.eventBus.emit("pause");
    }

    // Update viewport with fractional position for smooth scrolling
    const zoomWindow = PRESET_WINDOW[this.state.timeZoom] === Infinity
      ? this.state.dates.length
      : PRESET_WINDOW[this.state.timeZoom];

    // Use fractional viewportEnd for smooth line extension
    this.state.viewportEnd = Math.max(0, Math.floor(this.animationPosition));

    // The x-axis always spans the full zoom window (e.g. 90 days), so the
    // horizontal scale is stable from the very first frame. Early in playback
    // the window isn't filled yet, so viewportStart is negative — those
    // pre-data indices simply map to empty space on the left (the line grows
    // in from the right at the correct scale) rather than stretching the few
    // revealed days across the whole width.
    this.state.viewportStart = this.state.viewportEnd - zoomWindow;
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

    const frac = this.state.playing
      ? this.animationPosition - Math.floor(this.animationPosition)
      : 0;

    const viewport: Viewport = {
      startDateIndex: this.state.viewportStart,
      endDateIndex: this.state.viewportEnd,
      progressToNext: frac,
      // Fractional day the domain has scrolled by this frame. The worker shifts
      // the date→x mapping left by this much so the whole chart (grid, points,
      // labels) slides smoothly at the same rate the tip advances, instead of
      // snapping back a whole day when floor(animationPosition) increments.
      scrollOffset: frac,
      valueCeiling: this.state.valueCeiling,
      width,
      height,
      dpr,
    };

    const visibility: VisibilityParams = {
      filterCount: this.state.filterCount,
      artistFilterActive: this.state.artistFilterActive,
      selectedLineIds: this.state.selectedLineIds,
      pinnedArtistId: this.state.pinnedArtistId,
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

    // Draw endpoint labels for both foreground (opacity > 0.5) and background
    // (still faintly visible, opacity > 0.05) lines, so a fading-but-recent
    // line can still win a label slot per the tie-break rule. Excluding
    // background here would let a foreground line "win" a slot by default
    // just because its only real competitor had already faded past 0.5,
    // never actually comparing them.
    const fgCtx = this.renderer.getContext("foreground");
    const labelCandidates = getLabelCandidateCommands(result);
    if (fgCtx && labelCandidates.length > 0) {
      this.drawEndpointLabels(fgCtx, labelCandidates);
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

    const { height } = this.renderer!.getSize();
    const chartBottom = height - PADDING.bottom;

    // Collect label candidates (only visible lines with sufficient opacity)
    const labeled = commands
      .filter(cmd => cmd.points.length >= 2 && cmd.opacity > 0.05)
      .map(cmd => {
        const finalValue = cmd.values.length > 0 ? cmd.values[cmd.values.length - 1] : 0;
        const lastActivityIdx = this.lastActivityByLine.get(cmd.lineId) ?? 0;
        return {
          lineId: cmd.lineId,
          endPoint: cmd.points[cmd.points.length - 1],
          color: cmd.color,
          opacity: cmd.opacity,
          finalValue,
          lastActivityIdx,
        };
      });

    // Order candidates so that, when endpoints collide, the correct one
    // wins the slot (see orderLabelsByPriority for the tie-break rule).
    // The pinned artist (Artists-mode filter) wins the top slot outright.
    // In Artists mode lineId === artistId, so the pinned artist id doubles as
    // its line id.
    const pinnedLineId =
      this.state.pinnedArtistId !== "all" ? this.state.pinnedArtistId : undefined;
    const prioritized = orderLabelsByPriority(
      labeled.map(l => ({ ...l, y: l.endPoint.y })),
      PILEUP_GAP,
      pinnedLineId,
    );

    // Place labels: process in priority order, place at their Y if no collision
    const resolvedPositions: { y: number; lineId: string; endPoint: PixelPoint; color: string; opacity: number; finalValue: number }[] = [];

    for (const item of prioritized) {
      const labelY = item.endPoint.y;
      // Skip if outside chart area
      if (labelY < PADDING.top - 10 || labelY > chartBottom + 10) continue;
      // Skip if too close to an already-placed label
      const collides = resolvedPositions.some(placed => Math.abs(labelY - placed.y) < MIN_GAP);
      if (collides) continue;
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
        // Check if the line's tip has a crown/win — if so, offset the label
        // to avoid overlapping the crown icon
        let labelXOffset = 6;
        if (this.dataStore) {
          // Find the last win date for this line that falls at or near the tip
          const viewEnd = this.state.viewportEnd;
          const viewStart = this.state.viewportStart;
          const totalDateSpan = viewEnd + 1 - viewStart;
          const { width } = this.renderer!.getSize();
          const lineChartW = width - PADDING.left - PADDING.right;
          // Check dates near the tip (last point x)
          const tipX = lastPt.x;

          let allWinDates: string[] = [];
          if (meta.releaseId) {
            allWinDates = this.dataStore.releaseWinDates?.get(cmd.lineId) ?? [];
          } else {
            const artist = this.dataStore.artists.get(meta.artistId);
            if (artist) {
              for (const release of artist.releases) {
                const releaseKey = `${meta.artistId}::${release.id}`;
                const dates = this.dataStore.releaseWinDates?.get(releaseKey);
                if (dates) allWinDates.push(...dates);
              }
            }
          }

          for (const winDate of allWinDates) {
            const dateIdx = this.state.dates.indexOf(winDate);
            if (dateIdx < viewStart || dateIdx > viewEnd) continue;
            const winXRatio = (dateIdx - viewStart) / totalDateSpan;
            const winX = PADDING.left + winXRatio * lineChartW;
            // If this win is within a few pixels of the tip, the crown overlaps the label
            if (Math.abs(winX - tipX) < 4) {
              labelXOffset = 20;
              break;
            }
          }
        }

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
        ctx.fillText(displayText, lastPt.x + labelXOffset, lastPt.y - 1);

        // Stats line with value + wins
        const finalValue = cmd.values.length > 0 ? cmd.values[cmd.values.length - 1] : 0;
        if (finalValue > 0) {
          const wins = this.getWinCount(cmd.lineId);
          const statsText = wins > 0
            ? `${finalValue.toLocaleString()} \u00B7 ${wins} Wins`
            : `${finalValue.toLocaleString()}`;
          ctx.font = "8px system-ui, -apple-system, sans-serif";
          ctx.globalAlpha = 0.7;
          ctx.fillText(statsText, lastPt.x + labelXOffset, lastPt.y + 8);
          ctx.globalAlpha = 1;
        }
      }

      // Draw win dots on the highlighted line (chart performance only)
      this.drawEventDotsForLine(ctx, cmd);
    }
  }

  private drawEventDotsForLine(ctx: CanvasRenderingContext2D, cmd: LineDrawCommand): void {
    if (!this.dataStore) return;

    const meta = this.lineMetadata.get(cmd.lineId);
    if (!meta) return;

    const artist = this.dataStore.artists.get(meta.artistId);
    if (!artist) return;

    const viewStart = this.state.viewportStart;
    const viewEnd = this.state.viewportEnd;
    const totalDateSpan = viewEnd + 1 - viewStart;
    const { width } = this.renderer!.getSize();
    const chartW = width - PADDING.left - PADDING.right;

    // Collect all chart dates and live performance dates for this line
    const chartDates = new Set<string>();
    const livePerfDates = new Set<string>();

    const releases = meta.releaseId
      ? artist.releases.filter(r => r.id === meta.releaseId)
      : artist.releases;

    for (const release of releases) {
      for (const [date, dv] of release.dailyValues) {
        if (this.currentSourceFilter !== "all" && dv.source !== this.currentSourceFilter) continue;
        chartDates.add(date);
      }
      for (const [date, embeds] of release.embeds) {
        if (embeds.some(e => e.type === "live_performance")) {
          // Only mark as live performance if this date also has a dailyValue
          // that passes the source filter (ensures dot type matches the drawn dot)
          const dv = release.dailyValues.get(date);
          if (!dv) continue;
          if (this.currentSourceFilter !== "all" && dv.source !== this.currentSourceFilter) continue;
          livePerfDates.add(date);
        }
      }
    }

    // Draw chart dots (white circle with thin black border) for non-win dates
    // Get win dates to exclude from simple dot rendering
    let allWinDates: string[] = [];
    if (meta.releaseId) {
      allWinDates = this.dataStore.releaseWinDates?.get(cmd.lineId) ?? [];
    } else {
      for (const release of artist.releases) {
        const releaseKey = `${meta.artistId}::${release.id}`;
        const dates = this.dataStore.releaseWinDates?.get(releaseKey);
        if (dates) allWinDates.push(...dates);
      }
    }
    const winDateSet = new Set(allWinDates);

    for (const date of chartDates) {
      if (winDateSet.has(date)) continue; // Crowns handle wins

      const dateIdx = this.state.dates.indexOf(date);
      if (dateIdx < viewStart || dateIdx > viewEnd) continue;

      // Position dot on the line's change-point (joint/bend)
      const xRatio = (dateIdx - viewStart) / totalDateSpan;
      const x = PADDING.left + xRatio * chartW;
      const y = this.getPixelYForDateOnLine(cmd, dateIdx);

      if (livePerfDates.has(date)) {
        this.drawStarDot(ctx, x, y);
      } else {
        this.drawChartDot(ctx, x, y);
      }
    }

    // Draw crown dots for win dates
    const filteredWinDates = this.currentSourceFilter === "all"
      ? allWinDates
      : allWinDates.filter(winDate => {
          const dateWins = this.dataStore!.chartWins.get(winDate);
          if (!dateWins) return false;
          for (const [source, winData] of dateWins) {
            if (source === this.currentSourceFilter && winData.artistIds.includes(meta!.artistId)) {
              return true;
            }
          }
          return false;
        });

    for (const winDate of filteredWinDates) {
      const dateIdx = this.state.dates.indexOf(winDate);
      if (dateIdx < viewStart || dateIdx > viewEnd) continue;

      // Position crown on the line's change-point (joint/bend)
      const xRatio = (dateIdx - viewStart) / totalDateSpan;
      const x = PADDING.left + xRatio * chartW;
      const y = this.getPixelYForDateOnLine(cmd, dateIdx);

      let crownLevel = 1;
      const dateWins = this.dataStore.chartWins.get(winDate);
      if (dateWins) {
        for (const [source, winData] of dateWins) {
          if (this.currentSourceFilter !== "all" && source !== this.currentSourceFilter) continue;
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

  /** Draw a small white circle with thin black border for a regular chart date */
  private drawChartDot(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const radius = 3.5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  /** Draw a small white star with thin black border for a live performance date */
  private drawStarDot(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const outerRadius = 7;
    const innerRadius = 3;
    const points = 5;

    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
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

  /** Get the pixel Y position for a date index on a given line command */
  private getPixelYForDateOnLine(cmd: LineDrawCommand, dateIdx: number): number {
    const viewStart = this.state.viewportStart;
    const viewEnd = this.state.viewportEnd;
    const totalDateSpan = viewEnd + 1 - viewStart;
    const targetRatio = (dateIdx - viewStart) / totalDateSpan;

    const { width } = this.renderer!.getSize();
    const chartW = width - PADDING.left - PADDING.right;
    const targetX = PADDING.left + targetRatio * chartW;

    // Find the two points that bracket targetX and interpolate Y
    const pts = cmd.points;
    if (pts.length === 0) return 0;
    if (pts.length === 1) return pts[0].y;

    // If before first or after last point, clamp
    if (targetX <= pts[0].x) return pts[0].y;
    if (targetX >= pts[pts.length - 1].x) return pts[pts.length - 1].y;

    // Binary-ish search for the segment containing targetX
    for (let i = 0; i < pts.length - 1; i++) {
      if (targetX >= pts[i].x && targetX <= pts[i + 1].x) {
        const segWidth = pts[i + 1].x - pts[i].x;
        if (segWidth === 0) return pts[i].y;
        const t = (targetX - pts[i].x) / segWidth;
        return pts[i].y + t * (pts[i + 1].y - pts[i].y);
      }
    }

    return pts[pts.length - 1].y;
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

    // Win dates (filtered by source)
    const releaseWinDates = this.dataStore.releaseWinDates?.get(selectedId) ?? [];
    for (const winDate of releaseWinDates) {
      // Apply source filter
      if (this.currentSourceFilter !== "all") {
        const dateWins = this.dataStore.chartWins.get(winDate);
        if (!dateWins) continue;
        let matchesSource = false;
        for (const [source, winData] of dateWins) {
          if (source === this.currentSourceFilter && winData.artistIds.includes(meta.artistId)) {
            matchesSource = true;
            break;
          }
        }
        if (!matchesSource) continue;
      }
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

      // Check label tap first
      const labelHit = this.findLabelAtPoint(x, y);
      if (labelHit) {
        if (this.state.selectedLineIds.length > 0) {
          this.clearSelection();
        } else {
          this.selectLine(labelHit);
        }
        return;
      }

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

  private showRichTooltip(x: number, y: number, rd: RenderLineData, _nearestIndex: number, eventLabel?: string, _showEmbed?: boolean): void {
    const meta = this.lineMetadata.get(rd.lineId);
    if (!meta) return;

    const artist = this.dataStore?.artists.get(meta.artistId);
    const color = rd.color;
    const artistTypeLabel = artist ? ARTIST_TYPE_LABELS[artist.artistType] ?? "" : "";
    const genLabel = artist ? `Gen ${artist.generation}` : "";

    // dailyGain is computed later, only for dates with actual chart data
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

    // Compute cumulative value at the hovered date (from DataStore, respects source filter)
    let value = 0;
    if (artist) {
      if (meta.releaseId) {
        // Songs mode: single release
        const release = artist.releases.find(r => r.id === meta.releaseId);
        if (release) {
          for (const [d, entry] of release.dailyValues) {
            if (d <= hoveredDate) {
              if (this.currentSourceFilter === "all" || entry.source === this.currentSourceFilter) {
                value += entry.value;
              }
            }
          }
        }
      } else {
        // Artists mode: sum across all releases
        for (const release of artist.releases) {
          for (const [d, entry] of release.dailyValues) {
            if (d <= hoveredDate) {
              if (this.currentSourceFilter === "all" || entry.source === this.currentSourceFilter) {
                value += entry.value;
              }
            }
          }
        }
      }
    }

    // Get chart source and daily gain — only for dates with actual chart data matching the filter
    let sourceLabel: string | undefined;
    let sourceLogoUrl: string | undefined;
    let dailyGain: number | undefined;
    if (artist) {
      // Check all releases for data at this date (artists mode sums them)
      const releasesToCheck = meta.releaseId
        ? [artist.releases.find(r => r.id === meta.releaseId)].filter(Boolean) as typeof artist.releases
        : artist.releases;

      let totalDailyGain = 0;
      for (const release of releasesToCheck) {
        const entry = release.dailyValues.get(hoveredDate);
        if (entry) {
          if (this.currentSourceFilter === "all" || entry.source === this.currentSourceFilter) {
            if (entry.source && !sourceLabel) {
              sourceLabel = SOURCE_LABELS[entry.source] ?? entry.source;
              sourceLogoUrl = SOURCE_LOGO_URLS[entry.source];
            }
            if (entry.value > 0) {
              totalDailyGain += entry.value;
            }
          }
        }
      }
      if (totalDailyGain > 0) dailyGain = totalDailyGain;
    }

    // Check if this date is a chart win for this release (respecting source filter)
    let winInfo: { crownLevel: number; crownLabel: string; crownSvgUrl: string } | undefined;
    if (this.dataStore && meta.artistId) {
      const dateWins = this.dataStore.chartWins.get(hoveredDate);
      if (dateWins) {
        for (const [source, winData] of dateWins) {
          if (this.currentSourceFilter !== "all" && source !== this.currentSourceFilter) continue;
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

    // Check for live performance embeds and build song breakdown (artists mode)
    let hasVideo = false;
    const hasRelease = false;
    let embedUrl: string | undefined;
    const embedUrls: string[] = [];
    let songBreakdown: { title: string; value: number; isWin?: boolean }[] | undefined;

    if (artist && sourceLabel) {
      const releasesToCheck = meta.releaseId
        ? [artist.releases.find(r => r.id === meta.releaseId)].filter(Boolean) as typeof artist.releases
        : artist.releases;

      // Build song breakdown for artists mode
      if (!meta.releaseId) {
        const breakdown: { title: string; value: number; isWin?: boolean; crownLevel?: number }[] = [];
        for (const release of releasesToCheck) {
          const entry = release.dailyValues.get(hoveredDate);
          if (entry && (this.currentSourceFilter === "all" || entry.source === this.currentSourceFilter)) {
            // Check if this release won on this date
            const releaseKey = `${meta.artistId}::${release.id}`;
            const isWin = this.dataStore?.releaseWinDates?.get(releaseKey)?.includes(hoveredDate) ?? false;
            // Get crown level for this win from chartWins
            let crownLevel: number | undefined;
            if (isWin) {
              const dateWins = this.dataStore?.chartWins.get(hoveredDate);
              if (dateWins) {
                for (const [source, winData] of dateWins) {
                  if (this.currentSourceFilter !== "all" && source !== this.currentSourceFilter) continue;
                  if (winData.artistIds.includes(meta.artistId)) {
                    crownLevel = winData.crownLevels.get(meta.artistId) ?? 1;
                    break;
                  }
                }
              }
            }
            breakdown.push({ title: release.title, value: entry.value, isWin, crownLevel });
          }
        }
        if (breakdown.length > 0) {
          breakdown.sort((a, b) => b.value - a.value);
          songBreakdown = breakdown;
        }
      }

      // Collect live performance embeds
      for (const release of releasesToCheck) {
        const embeds = release.embeds.get(hoveredDate);
        if (embeds) {
          for (const embed of embeds) {
            if (embed.type === "live_performance") {
              hasVideo = true;
              if (!embedUrl) embedUrl = embed.url;
              embedUrls.push(embed.url);
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
      koreanName: artist?.koreanName,
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
      embedUrls: embedUrls.length > 1 ? embedUrls : undefined,
      winInfo,
      songBreakdown,
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

  /** Get win count for a given line up to the current animation date, respecting source filter */
  private getWinCount(lineId: string): number {
    if (!this.dataStore) return 0;
    const meta = this.lineMetadata.get(lineId);
    if (!meta) return 0;

    const currentDate = this.state.dates[this.state.currentDateIndex] ?? "";
    if (!currentDate) return 0;

    // Songs mode: count wins for this specific release only
    if (meta.releaseId) {
      const winDates = this.dataStore.releaseWinDates?.get(lineId) ?? [];
      let count = 0;
      for (const winDate of winDates) {
        if (winDate > currentDate) continue;
        if (this.currentSourceFilter === "all") {
          count++;
        } else {
          const dateWins = this.dataStore.chartWins.get(winDate);
          if (dateWins) {
            for (const [source, winData] of dateWins) {
              if (source === this.currentSourceFilter && winData.artistIds.includes(meta.artistId)) {
                count++;
                break;
              }
            }
          }
        }
      }
      return count;
    }

    // Artists mode: count all wins for the artist
    let count = 0;
    for (const [date, sourceMap] of this.dataStore.chartWins) {
      if (date > currentDate) continue;
      for (const [source, winData] of sourceMap) {
        if (this.currentSourceFilter !== "all" && source !== this.currentSourceFilter) continue;
        if (winData.artistIds.includes(meta.artistId)) {
          count++;
        }
      }
    }
    return count;
  }

  // --- Private: Utility ---

  /** Check if any artist has chart data on a given date */
  private hasChartDataOnDate(date: string): boolean {
    return this.datesWithData.has(date);
  }

  /** Precompute last activity date index per line for label prioritization */
  private buildLastActivityCache(dataStore: DataStore): void {
    this.lastActivityByLine.clear();
    for (const [lineId, meta] of this.lineMetadata) {
      const artist = dataStore.artists.get(meta.artistId);
      if (!artist) continue;
      const releases = meta.releaseId
        ? artist.releases.filter(r => r.id === meta.releaseId)
        : artist.releases;
      let lastIdx = 0;
      for (const release of releases) {
        for (const date of release.dailyValues.keys()) {
          const idx = this.state.dates.indexOf(date);
          if (idx > lastIdx) lastIdx = idx;
        }
      }
      this.lastActivityByLine.set(lineId, lastIdx);
    }
  }

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
