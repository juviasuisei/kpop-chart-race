/**
 * Chart_Race Renderer — owns the main visualization DOM subtree.
 * Renders bars, animates transitions, manages the legend and date display.
 */

import type { ChartSnapshot, DataStore, RankedEntry } from "./models.ts";
import type { ArtistType, ZoomLevel } from "./types.ts";
import { filterByActivity, computeBarWidth, toRomanNumeral, tween } from "./utils.ts";
import { EventBus } from "./event-bus.ts";
import { ARTIST_TYPE_COLORS } from "./colors.ts";
import { computeTotalWins, computeReleaseCumulativeValue } from "./chart-engine.ts";
import pkg from "../package.json";

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
  mixed_group: "Non-Gendered Group",
};

/** Placeholder SVG data URI for missing logos */
const PLACEHOLDER_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#ccc"/><text x="20" y="24" text-anchor="middle" font-size="16" fill="#666">♪</text></svg>'
)}`;

/** Fixed bar height in pixels when zoom is "all" */
const BAR_HEIGHT_ALL = 40;

/** Duration for tween animation in ms — matches the 1s playback interval */
const TWEEN_DURATION = 950;

interface BarElement {
  wrapper: HTMLDivElement;
  bar: HTMLDivElement;
  rankSpan: HTMLSpanElement;
  logo: HTMLImageElement;
  nameSpan: HTMLSpanElement;
  genSpan: HTMLSpanElement;
  typeIndicator: HTMLSpanElement;
  valueSpan: HTMLSpanElement;
  releaseSpan: HTMLSpanElement;
  winsSpan: HTMLSpanElement;
  currentDisplayValue: number;
  animationFrameId: number | null;
  overflowTimeoutId: ReturnType<typeof setTimeout> | null;
  clickHandler: ((e: Event) => void) | null;
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
  update(snapshot: ChartSnapshot, zoomLevel: ZoomLevel, dataStore: DataStore): void {
    if (!this.barsContainer || !this.dateDisplay) return;

    // Update date display
    this.dateDisplay.textContent = snapshot.date;

    const visibleEntries = filterByActivity(snapshot.entries, snapshot.date, dataStore, zoomLevel);
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

        // Start new bars at the bottom with zero width for entrance animation
        const bottomY = containerHeight > 0 ? containerHeight : 500;
        barEl.wrapper.style.transform = `translateY(${bottomY}px)`;
        barEl.wrapper.style.opacity = "0";
        barEl.bar.style.width = "0%";
        // Force reflow so the initial position is applied before transition
        barEl.wrapper.offsetHeight;
      }

      this.updateBarElement(barEl, entry, barHeight, maxCumulative, snapshot.date, dataStore);
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

    // Toggle logo visibility based on zoom level
    for (const [artistId, barEl] of this.bars) {
      if (visibleIds.has(artistId)) {
        barEl.logo.classList.toggle("bar__logo--hidden", zoomLevel === "all");
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

      const indicator = document.createElement("span");
      indicator.className = "legend-item__indicator";
      indicator.textContent = ARTIST_TYPE_INDICATORS[type];
      indicator.style.color = ARTIST_TYPE_COLORS[type];

      const label = document.createElement("span");
      label.className = "legend-item__label";
      label.textContent = ARTIST_TYPE_LABELS[type];

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

    const rankSpan = document.createElement("span");
    rankSpan.className = "bar__rank";
    rankSpan.textContent = `#${entry.rank}`;

    const nameSpan = document.createElement("span");
    nameSpan.className = "bar__name";
    nameSpan.textContent = entry.artistName;

    const genSpan = document.createElement("span");
    genSpan.className = "bar__gen";
    genSpan.textContent = toRomanNumeral(entry.generation);

    const typeIndicator = document.createElement("span");
    typeIndicator.className = "bar__type-indicator";
    typeIndicator.textContent = ARTIST_TYPE_INDICATORS[entry.artistType];

    const releaseSpan = document.createElement("span");
    releaseSpan.className = "bar__release";
    releaseSpan.textContent = "";

    bar.appendChild(logo);
    bar.appendChild(nameSpan);
    bar.appendChild(genSpan);
    bar.appendChild(typeIndicator);
    bar.appendChild(releaseSpan);

    const valueSpan = document.createElement("span");
    valueSpan.className = "bar__value";
    valueSpan.textContent = "0";

    const winsSpan = document.createElement("span");
    winsSpan.className = "bar__wins";
    winsSpan.textContent = "";

    wrapper.appendChild(rankSpan);
    wrapper.appendChild(bar);
    wrapper.appendChild(valueSpan);
    wrapper.appendChild(winsSpan);

    const clickHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.closest('.chart-race__bar') || target.classList.contains('bar__value') || target.classList.contains('bar__release') || target.classList.contains('bar__name') || target.classList.contains('bar__gen') || target.classList.contains('bar__type-indicator') || target.classList.contains('bar__wins') || target.classList.contains('bar__rank')) {
        this.eventBus.emit('bar:click', entry.artistId);
      }
    };
    wrapper.addEventListener('click', clickHandler);

    return {
      wrapper,
      bar,
      rankSpan,
      logo,
      nameSpan,
      genSpan,
      typeIndicator,
      valueSpan,
      releaseSpan,
      winsSpan,
      currentDisplayValue: entry.previousCumulativeValue,
      animationFrameId: null,
      overflowTimeoutId: null,
      clickHandler,
    };
  }

  /** Update an existing bar element with new data */
  private updateBarElement(
    barEl: BarElement,
    entry: RankedEntry,
    barHeight: number,
    maxCumulative: number,
    snapshotDate: string,
    dataStore: DataStore,
  ): void {
    // Update text content
    barEl.rankSpan.textContent = `#${entry.rank}`;
    barEl.rankSpan.style.backgroundColor = ARTIST_TYPE_COLORS[entry.artistType];
    barEl.nameSpan.textContent = entry.artistName;
    barEl.genSpan.textContent = toRomanNumeral(entry.generation);
    barEl.typeIndicator.textContent = ARTIST_TYPE_INDICATORS[entry.artistType];
    barEl.bar.style.backgroundColor = ARTIST_TYPE_COLORS[entry.artistType];

    // Update logo if changed
    if (barEl.logo.src !== entry.logoUrl && !barEl.logo.src.startsWith("data:")) {
      barEl.logo.src = entry.logoUrl;
    }

    // Featured release with per-song count if artist has multiple releases
    const artist = dataStore.artists.get(entry.artistId);
    const hasMultipleReleases = artist ? artist.releases.filter(r => {
      for (const d of dataStore.dates) {
        if (d > snapshotDate) break;
        if (r.dailyValues.has(d)) return true;
      }
      return false;
    }).length > 1 : false;

    if (entry.featuredRelease.title) {
      if (hasMultipleReleases && artist) {
        const songPts = computeReleaseCumulativeValue(artist, entry.featuredRelease.releaseId, snapshotDate, dataStore.dates);
        barEl.releaseSpan.textContent = `♪ ${entry.featuredRelease.title} (${songPts.toLocaleString()})`;
      } else {
        barEl.releaseSpan.textContent = `♪ ${entry.featuredRelease.title}`;
      }
    } else {
      barEl.releaseSpan.textContent = "";
    }

    // Total wins count
    const totalWins = computeTotalWins(entry.artistId, snapshotDate, dataStore);
    barEl.winsSpan.textContent = totalWins > 0 ? `${totalWins} ${totalWins === 1 ? "win" : "wins"}` : "";
    barEl.winsSpan.style.display = totalWins > 0 ? "" : "none";

    // Bar width as percentage
    const widthPercent = computeBarWidth(entry.cumulativeValue, maxCumulative);
    const oldWidth = barEl.bar.style.width;
    barEl.bar.style.width = `${widthPercent}%`;

    // Ensure opacity is 1 (transitions from 0 for new bars)
    barEl.wrapper.style.opacity = "1";

    // Bar position via translateY (rank is 1-based, so rank-1 for 0-based index)
    const yPosition = (entry.rank - 1) * barHeight;
    barEl.wrapper.style.transform = `translateY(${yPosition}px)`;
    barEl.wrapper.style.height = `${barHeight}px`;

    // Smart overflow: only reset inside when the bar is growing (more room available).
    // Otherwise leave the current overflow state to avoid flicker.
    const newWidth = `${widthPercent}%`;
    if (parseFloat(newWidth) > parseFloat(oldWidth || "0")) {
      this.moveAllInside(barEl);
    }
    // Cancel any pending overflow check from the previous update
    if (barEl.overflowTimeoutId !== null) {
      clearTimeout(barEl.overflowTimeoutId);
    }
    // After transition completes, reset inside and re-check what fits.
    barEl.overflowTimeoutId = setTimeout(() => {
      barEl.overflowTimeoutId = null;
      this.moveAllInside(barEl);
      barEl.bar.offsetHeight; // force layout
      this.checkBarOverflow(barEl);
    }, 960);

    // Numeric value tweening
    this.tweenValue(barEl, entry.previousCumulativeValue, entry.cumulativeValue);
  }

  /** Move all overflow elements back inside the bar */
  private moveAllInside(barEl: BarElement): void {
    if (barEl.releaseSpan.parentElement !== barEl.bar) {
      barEl.bar.appendChild(barEl.releaseSpan);
    }
    barEl.releaseSpan.classList.remove("bar__release--outside");
    if (barEl.nameSpan.parentElement !== barEl.bar) {
      barEl.bar.insertBefore(barEl.nameSpan, barEl.releaseSpan);
    }
    if (barEl.genSpan.parentElement !== barEl.bar) {
      barEl.bar.insertBefore(barEl.genSpan, barEl.releaseSpan);
    }
    if (barEl.typeIndicator.parentElement !== barEl.bar) {
      barEl.bar.insertBefore(barEl.typeIndicator, barEl.releaseSpan);
    }
    barEl.nameSpan.classList.remove("bar__name--outside");
    barEl.genSpan.classList.remove("bar__gen--outside");
    barEl.typeIndicator.classList.remove("bar__type-indicator--outside");
  }

  /** Check if bar content overflows and move elements outside as needed */
  private checkBarOverflow(barEl: BarElement): void {
    if (!barEl.bar.parentElement) return; // destroyed

    // Temporarily remove overflow:hidden to get true content measurements
    barEl.bar.style.overflow = "visible";

    const releaseIsTruncated = barEl.releaseSpan.scrollWidth > barEl.releaseSpan.offsetWidth;
    const barIsOverflowing = barEl.bar.scrollWidth > barEl.bar.clientWidth;

    // Restore overflow
    barEl.bar.style.overflow = "";

    if (releaseIsTruncated || barIsOverflowing) {
      barEl.wrapper.insertBefore(barEl.releaseSpan, barEl.valueSpan.nextSibling);
      barEl.releaseSpan.classList.add("bar__release--outside");

      // Re-measure with release removed
      barEl.bar.style.overflow = "visible";
      const nameIsTruncated = barEl.nameSpan.scrollWidth > barEl.nameSpan.offsetWidth;
      const stillOverflowing = barEl.bar.scrollWidth > barEl.bar.clientWidth;
      barEl.bar.style.overflow = "";

      if (nameIsTruncated || stillOverflowing) {
        barEl.wrapper.insertBefore(barEl.nameSpan, barEl.valueSpan);
        barEl.wrapper.insertBefore(barEl.genSpan, barEl.valueSpan);
        barEl.wrapper.insertBefore(barEl.typeIndicator, barEl.valueSpan);
        barEl.wrapper.insertBefore(barEl.winsSpan, barEl.valueSpan);
        barEl.nameSpan.classList.add("bar__name--outside");
        barEl.genSpan.classList.add("bar__gen--outside");
        barEl.typeIndicator.classList.add("bar__type-indicator--outside");
      }
    }
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
