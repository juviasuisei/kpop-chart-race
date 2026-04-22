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
const TWEEN_DURATION = 2850;

interface BarElement {
  wrapper: HTMLDivElement;
  bar: HTMLDivElement;
  wipeCover: HTMLDivElement;
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
  /** Whether this bar is currently hidden due to inactivity filtering */
  hidden: boolean;
  /** Timeout for deferred DOM removal after fade-out */
  fadeOutTimeoutId: ReturnType<typeof setTimeout> | null;
  /** The target rank this bar is animating toward */
  targetRank: number;
}

export class ChartRaceRenderer {
  private wrapper: HTMLDivElement | null = null;
  private dateDisplay: HTMLDivElement | null = null;
  private barsContainer: HTMLDivElement | null = null;
  private dataNote: HTMLDivElement | null = null;
  private bars: Map<string, BarElement> = new Map();
  private pendingFrames: Set<number> = new Set();
  /** When true, all CSS transitions are disabled (scrubbing mode) */
  private scrubbing = false;
  /** Artist IDs that have been seen before (for distinguishing new vs returning) */
  private seenArtists: Set<string> = new Set();
  /** rAF ID for the rank tracking loop during phase 1 */
  private rankTrackingFrameId: number | null = null;

  constructor(private eventBus: EventBus) {
    this.eventBus.on("scrub:start", () => {
      console.log("[DEBUG] scrub:start: bars before clear:", this.bars.size);
      this.scrubbing = true;
      this.cancelAllAnimations();
      for (const [, barEl] of this.bars) {
        barEl.wrapper.remove();
      }
      this.bars.clear();
      console.log("[DEBUG] scrub:start: bars after clear:", this.bars.size);
      if (this.barsContainer) {
        this.barsContainer.classList.add("chart-race__bars--no-transition");
      }
    });
    this.eventBus.on("scrub:end", () => {
      console.log("[DEBUG] scrub:end");
      this.scrubbing = false;
      if (this.barsContainer) {
        this.barsContainer.classList.remove("chart-race__bars--no-transition");
      }
      // Also clear any inline transition overrides from cancelAllAnimations
      for (const [, barEl] of this.bars) {
        barEl.wrapper.style.transition = "";
        barEl.bar.style.transition = "";
      }
    });
    this.eventBus.on("reset", () => {
      console.log("[DEBUG] reset: clearing", this.bars.size, "bars");
      // Remove all bars from DOM so next update starts fresh
      for (const [, barEl] of this.bars) {
        if (barEl.animationFrameId !== null) {
          cancelAnimationFrame(barEl.animationFrameId);
          this.pendingFrames.delete(barEl.animationFrameId);
        }
        if (barEl.overflowTimeoutId !== null) clearTimeout(barEl.overflowTimeoutId);
        if (barEl.fadeOutTimeoutId !== null) clearTimeout(barEl.fadeOutTimeoutId);
        barEl.wrapper.remove();
      }
      this.bars.clear();
    });
  }

  /** Cancel all in-flight animations, timeouts, and pending phase 2 work */
  private cancelAllAnimations(): void {
    // Cancel phase 2 timeout
    if (this.phase2TimeoutId !== null) {
      clearTimeout(this.phase2TimeoutId);
      this.phase2TimeoutId = null;
    }

    // Stop rank tracking
    this.stopRankTracking();

    // Cancel all per-bar animations and timeouts, reset hidden bars
    for (const [artistId, barEl] of this.bars) {
      // Cancel tween
      if (barEl.animationFrameId !== null) {
        cancelAnimationFrame(barEl.animationFrameId);
        this.pendingFrames.delete(barEl.animationFrameId);
        barEl.animationFrameId = null;
      }
      // Cancel overflow check
      if (barEl.overflowTimeoutId !== null) {
        clearTimeout(barEl.overflowTimeoutId);
        barEl.overflowTimeoutId = null;
      }
      // Cancel fade-out / collapse timeout
      if (barEl.fadeOutTimeoutId !== null) {
        clearTimeout(barEl.fadeOutTimeoutId);
        barEl.fadeOutTimeoutId = null;
      }
      // Remove hidden bars from DOM immediately
      if (barEl.hidden) {
        barEl.wrapper.remove();
        if (barEl.clickHandler) {
          barEl.wrapper.removeEventListener('click', barEl.clickHandler);
        }
        this.bars.delete(artistId);
        continue;
      }
      // Snap visible bars: disable transitions first, then set current computed position
      barEl.wrapper.style.transition = "none";
      barEl.bar.style.transition = "none";
      barEl.wipeCover.style.transition = "none";
      barEl.wipeCover.style.height = "0";
      barEl.wrapper.offsetHeight; // force reflow so transition:none takes effect

      const computed = getComputedStyle(barEl.wrapper);
      const matrix = computed.transform;
      if (matrix && matrix !== 'none') {
        const match = matrix.match(/matrix.*\((.+)\)/);
        if (match) {
          const values = match[1].split(',').map(Number);
          const ty = values[5] ?? 0;
          barEl.wrapper.style.transform = `translateY(${ty}px)`;
        }
      }
      // Snap bar width to current computed width
      const computedBar = getComputedStyle(barEl.bar);
      barEl.bar.style.width = computedBar.width;

      // Snap value display
      barEl.valueSpan.textContent = Math.round(barEl.currentDisplayValue).toLocaleString();
    }
  }

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

  /** Timeout ID for the pending phase 2 */
  private phase2TimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Update the chart with a new snapshot at the given zoom level.
   * Simplified debugging baseline: create/reuse bars, position them,
   * remove non-visible bars immediately. No phase logic or wipe covers.
   * Emits "update:complete" when the transition completes.
   */
  update(snapshot: ChartSnapshot, zoomLevel: ZoomLevel, dataStore: DataStore): void {
    console.log("[DEBUG] update:", snapshot.date, "scrubbing:", this.scrubbing, "existing bars:", this.bars.size);
    if (!this.barsContainer || !this.dateDisplay) return;

    // Cancel any pending timeout from a previous update
    if (this.phase2TimeoutId !== null) {
      clearTimeout(this.phase2TimeoutId);
      this.phase2TimeoutId = null;
    }

    // Update date display
    this.dateDisplay.textContent = snapshot.date;

    // 1. Phase 1 uses unfiltered top-10 by rank (all bars participate in position animation)
    // Phase 2 (after transition) applies activity filter to hide/show bars
    const filteredEntries = filterByActivity(snapshot.entries, snapshot.date, dataStore, zoomLevel);
    const filteredIds = new Set(filteredEntries.map(e => e.artistId));

    // Use filtered entries directly when scrubbing or on initial load (no existing bars).
    // For playback: phase 1 includes bars currently in DOM + bars in filtered set,
    // but NOT bars that were hidden and are still not in the filtered set.
    const needsTwoPhase = !this.scrubbing && this.bars.size > 0;
    let visibleEntries: RankedEntry[];
    if (!needsTwoPhase) {
      visibleEntries = filteredEntries;
    } else {
      // Build phase 1 set: existing DOM bars + filtered entries, sorted by rank
      const existingIds = new Set(Array.from(this.bars.keys()).filter(id => !this.bars.get(id)!.hidden));
      const phase1Ids = new Set([...existingIds, ...filteredIds]);
      // Look up entries from the FULL snapshot (not just top 10)
      visibleEntries = snapshot.entries.filter(e => phase1Ids.has(e.artistId));
    }
    const containerHeight = this.barsContainer.clientHeight || this.barsContainer.offsetHeight;
    const barHeight =
      zoomLevel === 10
        ? (containerHeight > 0 ? containerHeight / 10 : 50)
        : BAR_HEIGHT_ALL;

    this.barsContainer.style.overflowY = zoomLevel === "all" ? "auto" : "hidden";

    const visibleIds = new Set(visibleEntries.map(e => e.artistId));
    const maxCumulative = visibleEntries.reduce(
      (max, e) => Math.max(max, e.cumulativeValue), 0);

    // 2–5. For each visible entry: create bar if needed, restore if hidden, update
    let visIdx = 0;
    for (const entry of visibleEntries) {
      let barEl = this.bars.get(entry.artistId);

      if (!barEl) {
        // 2. Create new bar
        barEl = this.createBarElement(entry);
        this.bars.set(entry.artistId, barEl);
        this.barsContainer.appendChild(barEl.wrapper);
        this.seenArtists.add(entry.artistId);

        // New bar: start at bottom with 0 width, then animate to target
        barEl.wrapper.style.transition = "none";
        barEl.bar.style.transition = "none";
        const bottomY = containerHeight > 0 ? containerHeight : 500;
        barEl.wrapper.style.transform = `translateY(${bottomY}px)`;
        barEl.wrapper.style.height = `${barHeight}px`;
        barEl.wrapper.style.opacity = "1";
        barEl.bar.style.width = "0%";
        barEl.wrapper.offsetHeight; // force reflow

        // Enable transitions (unless scrubbing)
        if (!this.scrubbing) {
          barEl.wrapper.style.transition = "";
          barEl.bar.style.transition = "";
        }
      } else if (barEl.hidden) {
        // 4. Restore hidden bar: cancel timeouts, re-attach, place at target
        if (barEl.fadeOutTimeoutId !== null) {
          clearTimeout(barEl.fadeOutTimeoutId);
          barEl.fadeOutTimeoutId = null;
        }
        if (barEl.animationFrameId !== null) {
          cancelAnimationFrame(barEl.animationFrameId);
          this.pendingFrames.delete(barEl.animationFrameId);
          barEl.animationFrameId = null;
        }
        if (!barEl.wrapper.parentElement) {
          this.barsContainer.appendChild(barEl.wrapper);
        }
        barEl.hidden = false;
        barEl.wrapper.style.pointerEvents = "";
        barEl.wipeCover.style.transition = "none";
        barEl.wipeCover.style.height = "0";

        if (this.scrubbing) {
          barEl.wrapper.style.transition = "none";
          barEl.bar.style.transition = "none";
        } else {
          barEl.wrapper.style.transition = "none";
          barEl.bar.style.transition = "none";
          barEl.wrapper.style.transform = `translateY(${visIdx * barHeight}px)`;
          barEl.wrapper.style.height = `${barHeight}px`;
          barEl.wrapper.style.opacity = "1";
          barEl.wrapper.offsetHeight; // force reflow
          barEl.wrapper.style.transition = "";
          barEl.bar.style.transition = "";
        }
      }

      // Set scrubbing transitions
      if (this.scrubbing) {
        barEl.wrapper.style.transition = "none";
        barEl.bar.style.transition = "none";
        barEl.wrapper.offsetHeight; // force reflow
      } else {
        // Ensure transitions are enabled (clears any leftover inline overrides)
        barEl.wrapper.style.transition = "";
        barEl.bar.style.transition = "";
      }

      // 5. Update bar element (position, width, value, etc.)
      this.updateBarElement(barEl, entry, barHeight, maxCumulative, snapshot.date, dataStore, visIdx);
      visIdx++;
    }

    // 6. Remove bars no longer visible — immediately (hide animation handled by applyVisibilityFilter)
    for (const [artistId, barEl] of this.bars) {
      if (visibleIds.has(artistId)) continue;
      if (barEl.hidden) continue; // already being hidden
      // Cancel any pending animations/timeouts
      if (barEl.animationFrameId !== null) {
        cancelAnimationFrame(barEl.animationFrameId);
        this.pendingFrames.delete(barEl.animationFrameId);
        barEl.animationFrameId = null;
      }
      if (barEl.overflowTimeoutId !== null) {
        clearTimeout(barEl.overflowTimeoutId);
        barEl.overflowTimeoutId = null;
      }
      if (barEl.fadeOutTimeoutId !== null) {
        clearTimeout(barEl.fadeOutTimeoutId);
        barEl.fadeOutTimeoutId = null;
      }
      barEl.wrapper.remove();
      if (barEl.clickHandler) {
        barEl.wrapper.removeEventListener('click', barEl.clickHandler);
      }
      this.bars.delete(artistId);
    }

    // 7. Toggle logo visibility
    for (const [artistId, barEl] of this.bars) {
      if (visibleIds.has(artistId)) {
        barEl.logo.classList.toggle("bar__logo--hidden", zoomLevel === "all");
      }
    }

    // Rank tracking
    if (!this.scrubbing) {
      this.startRankTracking();
    } else {
      this.stopRankTracking();
    }

    // 8. Emit update:complete after transition duration (or immediately if scrubbing)
    if (this.scrubbing) {
      this.applyVisibilityFilter(filteredIds, barHeight);
      this.eventBus.emit("update:complete");
    } else if (!needsTwoPhase) {
      // Initial load or no existing bars — already showing filtered set, just wait for animation
      this.phase2TimeoutId = setTimeout(() => {
        this.phase2TimeoutId = null;
        this.stopRankTracking();
        this.eventBus.emit("update:complete");
      }, 2880);
    } else {
      this.phase2TimeoutId = setTimeout(() => {
        this.phase2TimeoutId = null;
        this.stopRankTracking();
        // Phase 2: apply activity filter — hide bars not in filtered set
        this.applyVisibilityFilter(filteredIds, barHeight);
        // Reposition existing visible bars and create replacements simultaneously
        let idx = 0;
        for (const entry of filteredEntries) {
          let barEl = this.bars.get(entry.artistId);
          if (barEl && barEl.hidden) {
            continue;
          }
          if (!barEl) {
            // Replacement bar — create at bottom, animate up to target
            barEl = this.createBarElement(entry);
            this.bars.set(entry.artistId, barEl);
            this.barsContainer!.appendChild(barEl.wrapper);
            this.seenArtists.add(entry.artistId);
            // Start at bottom with previous width
            barEl.wrapper.style.transition = "none";
            barEl.bar.style.transition = "none";
            const bottomY = containerHeight > 0 ? containerHeight : 500;
            barEl.wrapper.style.transform = `translateY(${bottomY}px)`;
            barEl.wrapper.style.height = `${barHeight}px`;
            barEl.wrapper.style.opacity = "1";
            barEl.wrapper.style.zIndex = String(1000 - entry.rank);
            const startWidth = maxCumulative > 0
              ? computeBarWidth(entry.previousCumulativeValue, maxCumulative) : 0;
            barEl.bar.style.width = `${startWidth}%`;
            barEl.wrapper.offsetHeight; // force reflow
            // Enable transitions and set target
            barEl.wrapper.style.transition = "";
            barEl.bar.style.transition = "";
            barEl.wrapper.style.transform = `translateY(${idx * barHeight}px)`;
            barEl.bar.style.width = `${computeBarWidth(entry.cumulativeValue, maxCumulative)}%`;
            barEl.targetRank = entry.rank;
            barEl.rankSpan.textContent = `#${entry.rank}`;
            this.updateBarElement(barEl, entry, barHeight, maxCumulative, snapshot.date, dataStore, idx);
          } else {
            // Existing bar — reposition to close gap
            const yPosition = idx * barHeight;
            barEl.wrapper.style.transform = `translateY(${yPosition}px)`;
            barEl.wrapper.style.zIndex = String(1000 - entry.rank);
            barEl.targetRank = entry.rank;
            barEl.rankSpan.textContent = `#${entry.rank}`;
          }
          idx++;
        }
        // Wait for wipe/reposition/slide-up animation, then signal done
        const hasHides = Array.from(this.bars.values()).some(b => b.hidden);
        if (hasHides) {
          setTimeout(() => {
            this.eventBus.emit("update:complete");
          }, 2880);
        } else {
          this.eventBus.emit("update:complete");
        }
      }, 2880);
    }
  }

  /**
   * Apply visibility filter after position animations complete.
   * Bars not in the filtered set get the wipe cover treatment (hide).
   * Called after phase 1 (position/width transitions) finishes.
   * For scrubbing, removes bars instantly.
   */
  applyVisibilityFilter(
    filteredIds: Set<string>,
    _barHeight: number,
  ): void {
    const toHide: string[] = [];
    for (const [artistId, barEl] of this.bars) {
      if (!filteredIds.has(artistId) && !barEl.hidden) {
        toHide.push(artistId);
      }
    }

    if (toHide.length === 0) return;

    for (const artistId of toHide) {
      const barEl = this.bars.get(artistId)!;
      if (barEl.animationFrameId !== null) {
        cancelAnimationFrame(barEl.animationFrameId);
        this.pendingFrames.delete(barEl.animationFrameId);
        barEl.animationFrameId = null;
      }
      if (barEl.overflowTimeoutId !== null) {
        clearTimeout(barEl.overflowTimeoutId);
        barEl.overflowTimeoutId = null;
      }

      if (this.scrubbing) {
        barEl.wrapper.remove();
        if (barEl.clickHandler) {
          barEl.wrapper.removeEventListener('click', barEl.clickHandler);
        }
        this.bars.delete(artistId);
      } else {
        barEl.hidden = true;
        barEl.wrapper.style.pointerEvents = "none";
        barEl.wrapper.style.zIndex = "0";
        barEl.wipeCover.style.height = "100%";
        barEl.fadeOutTimeoutId = setTimeout(() => {
          barEl.fadeOutTimeoutId = null;
          if (barEl.hidden) {
            barEl.wrapper.remove();
            if (barEl.clickHandler) {
              barEl.wrapper.removeEventListener('click', barEl.clickHandler);
            }
            this.bars.delete(artistId);
          }
        }, 2880);
      }
    }
  }

  /**
   * Start a rAF loop that reads each visible bar's current visual Y position,
   * sorts them by position, and assigns rank numbers based on visual order.
   * This makes rank badges update progressively as bars pass each other.
   */
  private startRankTracking(): void {
    this.stopRankTracking();

    // Initialize displayed ranks from current rankSpan text
    const displayedRanks = new Map<BarElement, number>();
    for (const [, barEl] of this.bars) {
      if (barEl.hidden) continue;
      const current = parseInt(barEl.rankSpan.textContent?.replace('#', '') || '0', 10);
      displayedRanks.set(barEl, current || barEl.targetRank);
    }

    const track = () => {
      const barPositions: { barEl: BarElement; y: number }[] = [];
      for (const [, barEl] of this.bars) {
        if (barEl.hidden) continue;
        const rect = barEl.wrapper.getBoundingClientRect();
        barPositions.push({ barEl, y: rect.top });
      }
      barPositions.sort((a, b) => a.y - b.y);

      // Debug: log Say My Name's rank on first frame
      for (const { barEl } of barPositions) {
        if (barEl.nameSpan.textContent === 'SAY MY NAME') {
          const dr = displayedRanks.get(barEl);
          console.log('[RANK DEBUG] SAY MY NAME displayed:', dr, 'target:', barEl.targetRank, 'span:', barEl.rankSpan.textContent);
          break;
        }
      }

      // Pairwise swap: if adjacent bars are out of order by displayed rank, swap
      let swapped = true;
      while (swapped) {
        swapped = false;
        for (let i = 0; i < barPositions.length - 1; i++) {
          const rankA = displayedRanks.get(barPositions[i].barEl) ?? 0;
          const rankB = displayedRanks.get(barPositions[i + 1].barEl) ?? 0;
          if (rankA > rankB) {
            displayedRanks.set(barPositions[i].barEl, rankB);
            displayedRanks.set(barPositions[i + 1].barEl, rankA);
            swapped = true;
          }
        }
      }

      // Apply displayed ranks
      for (const { barEl } of barPositions) {
        const rank = displayedRanks.get(barEl) ?? barEl.targetRank;
        const label = `#${rank}`;
        if (barEl.rankSpan.textContent !== label) {
          barEl.rankSpan.textContent = label;
        }
      }

      this.rankTrackingFrameId = requestAnimationFrame(track);
    };

    this.rankTrackingFrameId = requestAnimationFrame(track);
  }

  /** Stop the rank tracking rAF loop */
  private stopRankTracking(): void {
    if (this.rankTrackingFrameId !== null) {
      cancelAnimationFrame(this.rankTrackingFrameId);
      this.rankTrackingFrameId = null;
    }
    // Set final rank values
    for (const [, barEl] of this.bars) {
      if (!barEl.hidden) {
        barEl.rankSpan.textContent = `#${barEl.targetRank}`;
      }
    }
  }

  /**
   * Set the data note text showing the earliest data date.
   */
  setDataNote(startDate: string): void {
    if (!this.dataNote) return;
    this.dataNote.textContent = startDate
      ? `Points from ${startDate} forward. Inactive artists may be hidden — switch to All to see full rankings.`
      : "";
  }

  /**
   * Re-check overflow on all bars (e.g., after panel open/close resizes the viewport).
   */
  recheckOverflow(): void {
    // Delay to let the CSS transition (margin change) complete
    setTimeout(() => {
      for (const [, barEl] of this.bars) {
        this.moveAllInside(barEl);
        barEl.bar.offsetHeight;
        this.checkBarOverflow(barEl);
      }
    }, 350);
  }

  /**
   * Remove the chart from the DOM and cancel pending animation frames.
   */
  destroy(): void {
    if (this.phase2TimeoutId !== null) {
      clearTimeout(this.phase2TimeoutId);
      this.phase2TimeoutId = null;
    }
    this.stopRankTracking();
    for (const frameId of this.pendingFrames) {
      cancelAnimationFrame(frameId);
    }
    this.pendingFrames.clear();

    for (const [, barEl] of this.bars) {
      if (barEl.animationFrameId !== null) {
        cancelAnimationFrame(barEl.animationFrameId);
      }
      if (barEl.fadeOutTimeoutId !== null) {
        clearTimeout(barEl.fadeOutTimeoutId);
      }
      if (barEl.clickHandler) {
        barEl.wrapper.removeEventListener('click', barEl.clickHandler);
      }
    }
    this.bars.clear();
    this.seenArtists.clear();

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

    // Wipe cover — white overlay that grows to cover the bar for wipe-up animation
    const wipeCover = document.createElement("div");
    wipeCover.className = "bar__wipe-cover";

    wrapper.appendChild(rankSpan);
    wrapper.appendChild(bar);
    wrapper.appendChild(valueSpan);
    wrapper.appendChild(winsSpan);
    wrapper.appendChild(wipeCover);

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
      wipeCover,
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
      hidden: false,
      fadeOutTimeoutId: null,
      targetRank: entry.rank,
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
    visualIndex: number,
  ): void {
    // Store target rank — rank text updated by rank tracking loop during animation
    barEl.targetRank = entry.rank;
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

    // Bar position via translateY (use visual index for contiguous positioning)
    const yPosition = visualIndex * barHeight;
    barEl.wrapper.style.transform = `translateY(${yPosition}px)`;
    barEl.wrapper.style.height = `${barHeight}px`;
    barEl.wrapper.style.opacity = "1";
    // Higher rank (lower number) = higher z-index so rising bars overlap falling ones
    barEl.wrapper.style.zIndex = String(1000 - entry.rank);

    // Smart overflow: never reset inside during the update to avoid flicker.
    // Only check after the transition completes.
    const newWidthNum = widthPercent;
    const oldWidthNum = parseFloat(oldWidth || "0");
    const barGrew = newWidthNum > oldWidthNum + 1; // significant growth only
    // Cancel any pending overflow check from the previous update
    if (barEl.overflowTimeoutId !== null) {
      clearTimeout(barEl.overflowTimeoutId);
    }
    if (this.scrubbing) {
      // Snap: check overflow immediately
      this.moveAllInside(barEl);
      barEl.bar.offsetHeight;
      this.checkBarOverflow(barEl);
    } else {
      // After transition completes, check what fits.
      barEl.overflowTimeoutId = setTimeout(() => {
        barEl.overflowTimeoutId = null;
        if (barGrew) {
          this.moveAllInside(barEl);
          barEl.bar.offsetHeight; // force layout
        }
        this.checkBarOverflow(barEl);
      }, 2880);
    }

    // Numeric value tweening (snap in scrub mode)
    if (this.scrubbing) {
      barEl.valueSpan.textContent = Math.round(entry.cumulativeValue).toLocaleString();
      barEl.currentDisplayValue = entry.cumulativeValue;
      // Cancel any running tween
      if (barEl.animationFrameId !== null) {
        cancelAnimationFrame(barEl.animationFrameId);
        this.pendingFrames.delete(barEl.animationFrameId);
        barEl.animationFrameId = null;
      }
    } else {
      this.tweenValue(barEl, entry.previousCumulativeValue, entry.cumulativeValue);
    }
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

    // Ensure wins stays right after value in the wrapper
    if (barEl.winsSpan.previousElementSibling !== barEl.valueSpan) {
      barEl.wrapper.insertBefore(barEl.winsSpan, barEl.valueSpan.nextSibling);
    }
  }

  /** Check if bar content overflows and move elements outside as needed */
  private checkBarOverflow(barEl: BarElement): void {
    if (!barEl.bar.parentElement) return; // destroyed

    // Temporarily remove overflow:hidden and flex-shrink to measure true content size
    barEl.bar.style.overflow = "visible";
    barEl.releaseSpan.style.flexShrink = "0";
    barEl.nameSpan.style.flexShrink = "0";

    // Force layout to get accurate measurements
    barEl.bar.offsetHeight;

    const releaseIsTruncated = barEl.releaseSpan.scrollWidth > barEl.releaseSpan.offsetWidth;
    const barIsOverflowing = barEl.bar.scrollWidth > barEl.bar.clientWidth;

    // Restore
    barEl.bar.style.overflow = "";
    barEl.releaseSpan.style.flexShrink = "";
    barEl.nameSpan.style.flexShrink = "";

    if (releaseIsTruncated || barIsOverflowing) {
      barEl.wrapper.insertBefore(barEl.releaseSpan, barEl.winsSpan.nextSibling);
      barEl.releaseSpan.classList.add("bar__release--outside");

      // Re-measure with release removed
      barEl.bar.style.overflow = "visible";
      barEl.nameSpan.style.flexShrink = "0";
      barEl.bar.offsetHeight;
      const nameIsTruncated = barEl.nameSpan.scrollWidth > barEl.nameSpan.offsetWidth;
      const stillOverflowing = barEl.bar.scrollWidth > barEl.bar.clientWidth;
      barEl.bar.style.overflow = "";
      barEl.nameSpan.style.flexShrink = "";

      if (nameIsTruncated || stillOverflowing) {
        barEl.wrapper.insertBefore(barEl.nameSpan, barEl.valueSpan);
        barEl.wrapper.insertBefore(barEl.genSpan, barEl.valueSpan);
        barEl.wrapper.insertBefore(barEl.typeIndicator, barEl.valueSpan);
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
