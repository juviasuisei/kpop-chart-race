/**
 * Chart_Race Renderer — owns the main visualization DOM subtree.
 * Renders bars, animates transitions, manages the legend and date display.
 */

import type { ChartSnapshot, RankedEntry } from "./models.ts";
import type { ArtistType, ZoomLevel } from "./types.ts";
import { filterByZoom, computeBarWidth, toRomanNumeral, tween } from "./utils.ts";
import { EventBus } from "./event-bus.ts";
import pkg from "../package.json";

/** Colorblind-friendly palette: blue for boy/male, red-pink for girl/female, green for mixed */
const ARTIST_TYPE_COLORS: Record<ArtistType, string> = {
  boy_group: "#1565C0",
  girl_group: "#C62828",
  solo_male: "#64B5F6",
  solo_female: "#EF9A9A",
  mixed_group: "#009E73",
};

/** Secondary indicator icons per ArtistType */
const ARTIST_TYPE_INDICATORS: Record<ArtistType, string> = {
  boy_group: "▲",
  girl_group: "●",
  solo_male: "◆",
  solo_female: "★",
  mixed_group: "■",
};

/** Human-readable labels for ArtistType */
const ARTIST_TYPE_LABELS: Record<ArtistType, string> = {
  boy_group: "Boy Group",
  girl_group: "Girl Group",
  solo_male: "Solo Male",
  solo_female: "Solo Female",
  mixed_group: "Mixed Group",
};

/** Placeholder SVG data URI for missing logos */
const PLACEHOLDER_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#ccc"/><text x="20" y="24" text-anchor="middle" font-size="16" fill="#666">♪</text></svg>'
)}`;

/** Fixed bar height in pixels when zoom is "all" */
const BAR_HEIGHT_ALL = 40;

/** Duration for tween animation in ms */
const TWEEN_DURATION = 400;

interface BarElement {
  wrapper: HTMLDivElement;
  bar: HTMLDivElement;
  logo: HTMLImageElement;
  nameSpan: HTMLSpanElement;
  genSpan: HTMLSpanElement;
  typeIndicator: HTMLSpanElement;
  valueSpan: HTMLSpanElement;
  releaseSpan: HTMLSpanElement;
  currentDisplayValue: number;
  animationFrameId: number | null;
  clickHandler: (() => void) | null;
}

export class ChartRaceRenderer {
  private wrapper: HTMLDivElement | null = null;
  private dateDisplay: HTMLDivElement | null = null;
  private barsContainer: HTMLDivElement | null = null;
  private dataNote: HTMLDivElement | null = null;
  private bars: Map<string, BarElement> = new Map();
  private pendingFrames: Set<number> = new Set();

  constructor(private eventBus: EventBus) {}

  /**
   * Mount the chart race into the given container.
   * Creates the wrapper, date display, bars container, and legend.
   */
  mount(container: HTMLElement): void {

    this.wrapper = document.createElement("div");
    this.wrapper.className = "chart-race";

    const titleHeader = document.createElement("div");
    titleHeader.className = "chart-race__title-header";

    const titleText = document.createElement("span");
    titleText.className = "chart-race__title-text";
    titleText.textContent = "K-Pop Chart Race";

    const versionBadge = document.createElement("span");
    versionBadge.className = "chart-race__version-badge";
    versionBadge.textContent = `v${pkg.version}`;

    this.dataNote = document.createElement("div");
    this.dataNote.className = "chart-race__data-note";

    titleHeader.appendChild(titleText);
    titleHeader.appendChild(versionBadge);
    titleHeader.appendChild(this.dataNote);

    this.dateDisplay = document.createElement("div");
    this.dateDisplay.className = "chart-race__date";
    this.dateDisplay.textContent = "";

    // Wrap title and date in a shared top bar row
    const topBar = document.createElement("div");
    topBar.className = "chart-race__top-bar";
    topBar.appendChild(titleHeader);
    topBar.appendChild(this.dateDisplay);
    this.wrapper.appendChild(topBar);

    this.barsContainer = document.createElement("div");
    this.barsContainer.className = "chart-race__bars";
    this.wrapper.appendChild(this.barsContainer);

    const legend = this.createLegend();
    this.wrapper.appendChild(legend);

    container.appendChild(this.wrapper);
  }

  /**
   * Update the chart with a new snapshot at the given zoom level.
   * Creates or reuses bar elements keyed by artistId, animates positions and widths.
   */
  update(snapshot: ChartSnapshot, zoomLevel: ZoomLevel): void {
    if (!this.barsContainer || !this.dateDisplay) return;

    // Update date display
    this.dateDisplay.textContent = snapshot.date;

    const visibleEntries = filterByZoom(snapshot.entries, zoomLevel);
    const containerHeight = this.barsContainer.clientHeight || this.barsContainer.offsetHeight;
    // Bar height at zoom 10 is always containerHeight / 10 (not divided by
    // visibleEntries.length), so bars maintain consistent size even when fewer
    // than 10 entries are visible. Satisfies Requirement 3 (display-behavior-enhancements).
    const barHeight =
      zoomLevel === 10
        ? (containerHeight > 0 ? containerHeight / 10 : 50)
        : BAR_HEIGHT_ALL;

    // Enable scrolling for "all" zoom
    this.barsContainer.style.overflowY = zoomLevel === "all" ? "auto" : "hidden";

    // Compute max cumulative value among visible entries
    const maxCumulative = visibleEntries.reduce(
      (max, e) => Math.max(max, e.cumulativeValue),
      0,
    );

    // Track which artist IDs are in the current visible set
    const visibleIds = new Set<string>();

    for (const entry of visibleEntries) {
      visibleIds.add(entry.artistId);
      let barEl = this.bars.get(entry.artistId);

      if (!barEl) {
        barEl = this.createBarElement(entry);
        this.bars.set(entry.artistId, barEl);
        this.barsContainer.appendChild(barEl.wrapper);
      }

      this.updateBarElement(barEl, entry, barHeight, maxCumulative);
    }

    // Remove bars no longer visible
    for (const [artistId, barEl] of this.bars) {
      if (!visibleIds.has(artistId)) {
        if (barEl.animationFrameId !== null) {
          cancelAnimationFrame(barEl.animationFrameId);
          this.pendingFrames.delete(barEl.animationFrameId);
        }
        barEl.wrapper.remove();
        this.bars.delete(artistId);
      }
    }
  }

  /**
   * Set the data note text showing the earliest data date.
   */
  setDataNote(startDate: string): void {
    if (!this.dataNote) return;
    this.dataNote.textContent = startDate
      ? `Includes points earned from ${startDate} forward`
      : "";
  }

  /**
   * Remove the chart from the DOM and cancel pending animation frames.
   */
  destroy(): void {
    for (const frameId of this.pendingFrames) {
      cancelAnimationFrame(frameId);
    }
    this.pendingFrames.clear();

    for (const [, barEl] of this.bars) {
      if (barEl.animationFrameId !== null) {
        cancelAnimationFrame(barEl.animationFrameId);
      }
      if (barEl.clickHandler) {
        barEl.wrapper.removeEventListener('click', barEl.clickHandler);
      }
    }
    this.bars.clear();

    if (this.wrapper && this.wrapper.parentNode) {
      this.wrapper.parentNode.removeChild(this.wrapper);
    }
    this.wrapper = null;
    this.dateDisplay = null;
    this.barsContainer = null;
    this.dataNote = null;
  }

  /** Create the legend element showing all 5 ArtistType colors with indicators */
  private createLegend(): HTMLDivElement {
    const legend = document.createElement("div");
    legend.className = "chart-race__legend";

    const types: ArtistType[] = [
      "boy_group",
      "girl_group",
      "solo_male",
      "solo_female",
      "mixed_group",
    ];

    for (const type of types) {
      const item = document.createElement("div");
      item.className = "chart-race__legend-item";

      const swatch = document.createElement("span");
      swatch.className = "legend-item__swatch";
      swatch.style.backgroundColor = ARTIST_TYPE_COLORS[type];

      const indicator = document.createElement("span");
      indicator.className = "legend-item__indicator";
      indicator.textContent = ARTIST_TYPE_INDICATORS[type];
      indicator.style.color = ARTIST_TYPE_COLORS[type];

      const label = document.createElement("span");
      label.className = "legend-item__label";
      label.textContent = ARTIST_TYPE_LABELS[type];

      item.appendChild(swatch);
      item.appendChild(indicator);
      item.appendChild(label);
      legend.appendChild(item);
    }

    return legend;
  }

  /** Create a new bar element for an artist entry */
  private createBarElement(entry: RankedEntry): BarElement {
    const wrapper = document.createElement("div");
    wrapper.className = "chart-race__bar-wrapper";

    const bar = document.createElement("div");
    bar.className = "chart-race__bar";
    bar.style.backgroundColor = ARTIST_TYPE_COLORS[entry.artistType];

    const logo = document.createElement("img");
    logo.className = "bar__logo";
    logo.src = entry.logoUrl;
    logo.alt = `${entry.artistName} logo`;
    logo.onerror = () => {
      logo.src = PLACEHOLDER_SVG;
    };

    const nameSpan = document.createElement("span");
    nameSpan.className = "bar__name";
    nameSpan.textContent = entry.artistName;

    const genSpan = document.createElement("span");
    genSpan.className = "bar__gen";
    genSpan.textContent = toRomanNumeral(entry.generation);

    const typeIndicator = document.createElement("span");
    typeIndicator.className = "bar__type-indicator";
    typeIndicator.textContent = ARTIST_TYPE_INDICATORS[entry.artistType];

    bar.appendChild(logo);
    bar.appendChild(nameSpan);
    bar.appendChild(genSpan);
    bar.appendChild(typeIndicator);

    const valueSpan = document.createElement("span");
    valueSpan.className = "bar__value";
    valueSpan.textContent = "0";

    const releaseSpan = document.createElement("span");
    releaseSpan.className = "bar__release";
    releaseSpan.textContent = "";

    wrapper.appendChild(bar);
    wrapper.appendChild(valueSpan);
    wrapper.appendChild(releaseSpan);

    const clickHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      // Only emit bar:click when clicking the colored bar, value, or release — not empty wrapper space
      if (target.closest('.chart-race__bar') || target.classList.contains('bar__value') || target.classList.contains('bar__release')) {
        this.eventBus.emit('bar:click', entry.artistId);
      }
    };
    wrapper.addEventListener('click', clickHandler);

    return {
      wrapper,
      bar,
      logo,
      nameSpan,
      genSpan,
      typeIndicator,
      valueSpan,
      releaseSpan,
      currentDisplayValue: entry.previousCumulativeValue,
      animationFrameId: null,
      clickHandler,
    };
  }

  /** Update an existing bar element with new data */
  private updateBarElement(
    barEl: BarElement,
    entry: RankedEntry,
    barHeight: number,
    maxCumulative: number,
  ): void {
    // Update text content
    barEl.nameSpan.textContent = entry.artistName;
    barEl.genSpan.textContent = toRomanNumeral(entry.generation);
    barEl.typeIndicator.textContent = ARTIST_TYPE_INDICATORS[entry.artistType];
    barEl.bar.style.backgroundColor = ARTIST_TYPE_COLORS[entry.artistType];

    // Update logo if changed
    if (barEl.logo.src !== entry.logoUrl && !barEl.logo.src.startsWith("data:")) {
      barEl.logo.src = entry.logoUrl;
    }

    // Featured release
    barEl.releaseSpan.textContent = entry.featuredRelease.title
      ? `♪ ${entry.featuredRelease.title}`
      : "";

    // Bar width as percentage
    const widthPercent = computeBarWidth(entry.cumulativeValue, maxCumulative);
    barEl.bar.style.width = `${widthPercent}%`;

    // Bar position via translateY (rank is 1-based, so rank-1 for 0-based index)
    const yPosition = (entry.rank - 1) * barHeight;
    barEl.wrapper.style.transform = `translateY(${yPosition}px)`;
    barEl.wrapper.style.height = `${barHeight}px`;

    // Numeric value tweening
    this.tweenValue(barEl, entry.previousCumulativeValue, entry.cumulativeValue);
  }

  /** Animate numeric value from start to end using requestAnimationFrame */
  private tweenValue(barEl: BarElement, startValue: number, endValue: number): void {
    // Cancel any existing tween for this bar
    if (barEl.animationFrameId !== null) {
      cancelAnimationFrame(barEl.animationFrameId);
      this.pendingFrames.delete(barEl.animationFrameId);
      barEl.animationFrameId = null;
    }

    // If values are the same, just set directly
    if (startValue === endValue) {
      barEl.valueSpan.textContent = Math.round(endValue).toLocaleString();
      barEl.currentDisplayValue = endValue;
      return;
    }

    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / TWEEN_DURATION, 1);
      const currentValue = tween(startValue, endValue, progress);

      barEl.valueSpan.textContent = Math.round(currentValue).toLocaleString();
      barEl.currentDisplayValue = currentValue;

      if (progress < 1) {
        const frameId = requestAnimationFrame(animate);
        barEl.animationFrameId = frameId;
        this.pendingFrames.add(frameId);
      } else {
        barEl.animationFrameId = null;
      }
    };

    const frameId = requestAnimationFrame(animate);
    barEl.animationFrameId = frameId;
    this.pendingFrames.add(frameId);
  }
}
