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
  /** Compact label shown when bar is in goalpost mode */
  goalpostLabel: HTMLSpanElement;
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
  /** Last known Y positions for bars removed from DOM (for smooth reappearance) */
  private lastKnownY: Map<string, number> = new Map();
  /** Previous zoom level for detecting zoom changes */
  private previousZoom: ZoomLevel | null = null;
  /** rAF ID for the rank tracking loop during phase 1 */
  private rankTrackingFrameId: number | null = null;

  constructor(private eventBus: EventBus) {
    this.eventBus.on("scrub:start", () => {
      this.scrubbing = true;
      this.cancelAllAnimations();
      for (const [, barEl] of this.bars) {
        barEl.wrapper.remove();
      }
      this.bars.clear();
      this.lastKnownY.clear();
      if (this.barsContainer) {
        this.barsContainer.classList.add("chart-race__bars--no-transition");
      }
    });
    this.eventBus.on("scrub:end", () => {
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
      this.lastKnownY.clear();
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
    if (!this.barsContainer || !this.dateDisplay) return;

    // Cancel any pending timeout from a previous update
    if (this.phase2TimeoutId !== null) {
      clearTimeout(this.phase2TimeoutId);
      this.phase2TimeoutId = null;
    }

    // Detect zoom change for faster transition
    const isZoomChange = this.previousZoom !== null && this.previousZoom !== zoomLevel;
    this.previousZoom = zoomLevel;
    const ZOOM_TRANSITION_MS = 400; // fast transition for zoom toggles

    // Update date display
    this.dateDisplay.textContent = snapshot.date;

    // 1. Get visible entries
    const visibleEntries = filterByActivity(snapshot.entries, snapshot.date, dataStore, zoomLevel);
    const containerHeight = this.barsContainer.clientHeight || this.barsContainer.offsetHeight;

    // Compute bar heights: goalposts get a fixed small height, regular bars share the rest
    const GOALPOST_HEIGHT = 16;
    const PHASE2_DURATION = 1440; // half of phase 1

    // Detect goalpost state changes (bars switching between regular and goalpost)
    const becomingGoalpost: Set<string> = new Set();
    const leavingGoalpost: Set<string> = new Set();
    if (!this.scrubbing) {
      for (const entry of visibleEntries) {
        const barEl = this.bars.get(entry.artistId);
        if (!barEl) continue;
        const currentlyGoalpost = barEl.wrapper.classList.contains("chart-race__bar-wrapper--goalpost");
        if (entry.isGoalpost && !currentlyGoalpost) {
          becomingGoalpost.add(entry.artistId);
        } else if (!entry.isGoalpost && currentlyGoalpost) {
          leavingGoalpost.add(entry.artistId);
        }
      }
    }
    const hasPhase2Work = becomingGoalpost.size > 0 || leavingGoalpost.size > 0;

    // For phase 1 height calculation, bars changing state keep their CURRENT height
    // becomingGoalpost bars stay full height; leavingGoalpost bars stay at 16px
    const phase1GoalpostCount = zoomLevel === 10
      ? visibleEntries.filter(e =>
          (e.isGoalpost && !becomingGoalpost.has(e.artistId)) ||
          leavingGoalpost.has(e.artistId)
        ).length
      : 0;
    const phase1RemainingHeight = containerHeight - (phase1GoalpostCount * GOALPOST_HEIGHT);
    const phase1RegularBarHeight =
      zoomLevel === 10
        ? (phase1RemainingHeight > 0 ? phase1RemainingHeight / 10 : 50)
        : BAR_HEIGHT_ALL;

    // Phase 1 Y-offsets: use current state for transitioning bars (unless zoom change)
    const yOffsets: number[] = [];
    const heights: number[] = [];
    let yAccum = 0;
    for (const entry of visibleEntries) {
      let h: number;
      if (zoomLevel !== "all") {
        if (isZoomChange) {
          // During zoom change, use target heights directly (no deferral)
          h = entry.isGoalpost ? GOALPOST_HEIGHT : phase1RegularBarHeight;
        } else if (becomingGoalpost.has(entry.artistId)) {
          h = phase1RegularBarHeight; // stays full during phase 1
        } else if (leavingGoalpost.has(entry.artistId)) {
          h = GOALPOST_HEIGHT; // stays small during phase 1
        } else if (entry.isGoalpost) {
          h = GOALPOST_HEIGHT;
        } else {
          h = phase1RegularBarHeight;
        }
      } else {
        h = BAR_HEIGHT_ALL;
      }
      yOffsets.push(yAccum);
      heights.push(h);
      yAccum += h;
    }

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

        // Position new bar: use last known Y if returning, otherwise rise from bottom
        barEl.wrapper.style.transition = "none";
        barEl.bar.style.transition = "none";
        const lastY = this.lastKnownY.get(entry.artistId);
        if (lastY !== undefined) {
          // Returning bar: start at last known position with current width
          barEl.wrapper.style.transform = `translateY(${lastY}px)`;
          const widthPercent = computeBarWidth(entry.cumulativeValue, maxCumulative);
          barEl.bar.style.width = `${widthPercent}%`;
          this.lastKnownY.delete(entry.artistId);
        } else {
          // Truly new bar: start at bottom with 0 width
          const bottomY = containerHeight > 0 ? containerHeight : 500;
          barEl.wrapper.style.transform = `translateY(${bottomY}px)`;
          barEl.bar.style.width = "0%";
        }
        barEl.wrapper.style.height = `${heights[visIdx]}px`;
        barEl.wrapper.style.opacity = "1";
        barEl.bar.style.width = "0%";
        barEl.wrapper.offsetHeight; // force reflow

        // Enable transitions (unless scrubbing)
        if (!this.scrubbing) {
          if (isZoomChange) {
            barEl.wrapper.style.transition = `transform ${ZOOM_TRANSITION_MS}ms ease-in-out, height ${ZOOM_TRANSITION_MS}ms ease-in-out`;
            barEl.bar.style.transition = `width ${ZOOM_TRANSITION_MS}ms ease-in-out`;
          } else {
            barEl.wrapper.style.transition = "";
            barEl.bar.style.transition = "";
          }
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
          barEl.wrapper.style.transform = `translateY(${yOffsets[visIdx]}px)`;
          barEl.wrapper.style.height = `${heights[visIdx]}px`;
          barEl.wrapper.style.opacity = "1";
          barEl.wrapper.offsetHeight; // force reflow
          barEl.wrapper.style.transition = "";
          barEl.bar.style.transition = "";
        }
      }

      // Set transitions
      if (this.scrubbing) {
        barEl.wrapper.style.transition = "none";
        barEl.bar.style.transition = "none";
        barEl.wrapper.offsetHeight; // force reflow
      } else if (isZoomChange) {
        // Fast transition for zoom toggles (including goalposts changing state)
        barEl.wrapper.style.transition = `transform ${ZOOM_TRANSITION_MS}ms ease-in-out, height ${ZOOM_TRANSITION_MS}ms ease-in-out`;
        barEl.bar.style.transition = `width ${ZOOM_TRANSITION_MS}ms ease-in-out`;
      } else if (entry.isGoalpost && !becomingGoalpost.has(entry.artistId)) {
        // Stable goalposts: no transition
        barEl.wrapper.style.transition = "none";
        barEl.bar.style.transition = "none";
      } else {
        // Normal transition speed
        barEl.wrapper.style.transition = "";
        barEl.bar.style.transition = "";
      }

      // 5. Update bar element (position, width, value, etc.)
      // For bars changing goalpost state: defer during normal playback, apply immediately during zoom change
      const phase1GoalpostOverride = isZoomChange ? undefined
        : becomingGoalpost.has(entry.artistId) ? false
        : leavingGoalpost.has(entry.artistId) ? true
        : undefined;
      this.updateBarElement(barEl, entry, yOffsets[visIdx], heights[visIdx], maxCumulative, snapshot.date, dataStore, phase1GoalpostOverride);
      visIdx++;
    }

    // 6. Remove bars no longer visible — save positions first, then remove
    for (const [artistId, barEl] of this.bars) {
      if (visibleIds.has(artistId)) continue;
      // Save last known Y position for smooth reappearance
      const yMatch = barEl.wrapper.style.transform.match(/translateY\(([0-9.]+)px\)/);
      if (yMatch) {
        this.lastKnownY.set(artistId, parseFloat(yMatch[1]));
      }
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
      this.startRankTracking(visibleIds);
    } else {
      this.stopRankTracking();
    }

    // 8. Emit update:complete after transition duration (or immediately if scrubbing)
    const phase1Duration = isZoomChange ? ZOOM_TRANSITION_MS : 2880;
    if (this.scrubbing) {
      this.eventBus.emit("update:complete");
    } else if (hasPhase2Work && !isZoomChange) {
      // Phase 1 complete → execute phase 2 (goalpost state changes)
      this.phase2TimeoutId = setTimeout(() => {
        this.phase2TimeoutId = null;
        this.stopRankTracking();

        // Compute target heights for phase 2
        const targetGoalpostCount = visibleEntries.filter(e => e.isGoalpost).length;
        const targetRemainingHeight = containerHeight - (targetGoalpostCount * GOALPOST_HEIGHT);
        const targetRegularBarHeight = zoomLevel === 10
          ? (targetRemainingHeight > 0 ? targetRemainingHeight / 10 : 50)
          : BAR_HEIGHT_ALL;

        // Apply goalpost state changes and compute new Y offsets
        let phase2YAccum = 0;
        let phase2VisIdx = 0;
        for (const entry of visibleEntries) {
          const barEl = this.bars.get(entry.artistId);
          if (!barEl) { phase2VisIdx++; continue; }

          const targetHeight = entry.isGoalpost ? GOALPOST_HEIGHT : targetRegularBarHeight;
          const isChanging = becomingGoalpost.has(entry.artistId) || leavingGoalpost.has(entry.artistId);

          if (isChanging) {
            // Enable height transition for the state change
            barEl.wrapper.style.transition = `transform ${PHASE2_DURATION}ms ease-in-out, height ${PHASE2_DURATION}ms ease-in-out`;
            barEl.bar.style.transition = `width ${PHASE2_DURATION}ms ease-in-out`;

            if (becomingGoalpost.has(entry.artistId)) {
              // COLLAPSING: keep regular appearance, just shrink height + reposition
              // Appearance swap happens after the transition completes
              barEl.wrapper.style.transform = `translateY(${phase2YAccum}px)`;
              barEl.wrapper.style.height = `${targetHeight}px`;
            } else {
              // EXPANDING: apply regular appearance immediately, then grow height
              this.updateBarElement(barEl, entry, phase2YAccum, targetHeight, maxCumulative, snapshot.date, dataStore);
            }
          } else {
            // Non-changing bars just slide to new Y position
            barEl.wrapper.style.transition = `transform ${PHASE2_DURATION}ms ease-in-out`;
            barEl.wrapper.style.transform = `translateY(${phase2YAccum}px)`;
          }

          phase2YAccum += targetHeight;
          phase2VisIdx++;
        }

        // Emit update:complete after phase 2
        this.phase2TimeoutId = setTimeout(() => {
          this.phase2TimeoutId = null;

          // Apply goalpost appearance to bars that finished collapsing
          for (const artistId of becomingGoalpost) {
            const barEl = this.bars.get(artistId);
            const entry = visibleEntries.find(e => e.artistId === artistId);
            if (!barEl || !entry) continue;
            const visIdx = visibleEntries.indexOf(entry);
            const finalY = visibleEntries.slice(0, visIdx).reduce((sum, e) => {
              return sum + (e.isGoalpost ? GOALPOST_HEIGHT : targetRegularBarHeight);
            }, 0);
            // Snap to goalpost appearance (no transition)
            barEl.wrapper.style.transition = "none";
            barEl.bar.style.transition = "none";
            barEl.wrapper.offsetHeight;
            this.updateBarElement(barEl, entry, finalY, GOALPOST_HEIGHT, maxCumulative, snapshot.date, dataStore);
          }

          // Set rank text for bars that just left goalpost state
          // (stopRankTracking skipped them because they were still goalposts at that point)
          for (const artistId of leavingGoalpost) {
            const barEl = this.bars.get(artistId);
            if (barEl && !barEl.hidden) {
              barEl.rankSpan.textContent = `#${barEl.targetRank}`;
            }
          }

          // Reset transitions back to default
          for (const [, barEl] of this.bars) {
            if (!barEl.hidden) {
              const isGp = barEl.wrapper.classList.contains("chart-race__bar-wrapper--goalpost");
              if (isGp) {
                barEl.wrapper.style.transition = "none";
                barEl.bar.style.transition = "none";
              } else {
                barEl.wrapper.style.transition = "";
                barEl.bar.style.transition = "";
              }
            }
          }
          this.eventBus.emit("update:complete");
        }, PHASE2_DURATION);
      }, 2880);
    } else {
      // No phase 2 needed — just wait for phase 1
      this.phase2TimeoutId = setTimeout(() => {
        this.phase2TimeoutId = null;
        this.stopRankTracking();
        this.eventBus.emit("update:complete");
      }, phase1Duration);
    }
  }

  /**
   * Start a rAF loop that reads each visible bar's current visual Y position,
   * sorts them by position, and assigns rank numbers based on visual order.
   * Sorts bars by current visual Y position each frame and assigns ranks
   * 1, 2, 3, ... based on that order. Deterministic and handles all cases.
   */
  private startRankTracking(visibleArtistIds: Set<string>): void {
    // Cancel any existing rank tracking loop
    if (this.rankTrackingFrameId !== null) {
      cancelAnimationFrame(this.rankTrackingFrameId);
      this.rankTrackingFrameId = null;
    }

    // Collect tracked bars (exclude hidden and goalpost bars)
    const trackedBars: BarElement[] = [];
    for (const [artistId, barEl] of this.bars) {
      if (!visibleArtistIds.has(artistId) || barEl.hidden) continue;
      if (barEl.wrapper.classList.contains("chart-race__bar-wrapper--goalpost")) continue;
      trackedBars.push(barEl);
    }

    // Collect all ranks that are in play (from targetRank of tracked bars)
    // Sort them so we can assign rank 1 to topmost, rank 2 to next, etc.
    const allRanks = trackedBars.map(b => b.targetRank).sort((a, b) => a - b);

    const track = () => {
      // Get current Y positions via getBoundingClientRect
      const barPositions: Array<{ barEl: BarElement; y: number }> = [];
      for (const barEl of trackedBars) {
        if (barEl.hidden || !barEl.wrapper.parentElement) continue;
        const rect = barEl.wrapper.getBoundingClientRect();
        barPositions.push({ barEl, y: rect.top });
      }

      // Sort by Y position (topmost first)
      barPositions.sort((a, b) => a.y - b.y);

      // Assign ranks based on visual order
      for (let i = 0; i < barPositions.length; i++) {
        const rank = allRanks[i] ?? (i + 1);
        const label = `#${rank}`;
        if (barPositions[i].barEl.rankSpan.textContent !== label) {
          barPositions[i].barEl.rankSpan.textContent = label;
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
    // Set final rank values (skip goalpost bars — they show rank in the label)
    for (const [, barEl] of this.bars) {
      if (!barEl.hidden && !barEl.wrapper.classList.contains("chart-race__bar-wrapper--goalpost")) {
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
    this.lastKnownY.clear();

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

    // Goalpost label — compact summary shown when bar is in goalpost mode
    const goalpostLabel = document.createElement("span");
    goalpostLabel.className = "bar__goalpost-label";

    wrapper.appendChild(rankSpan);
    wrapper.appendChild(bar);
    wrapper.appendChild(valueSpan);
    wrapper.appendChild(winsSpan);
    wrapper.appendChild(goalpostLabel);
    wrapper.appendChild(wipeCover);

    const clickHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      // For goalpost bars, any click on the wrapper triggers the detail panel
      if (wrapper.classList.contains('chart-race__bar-wrapper--goalpost')) {
        this.eventBus.emit('bar:click', entry.artistId);
        return;
      }
      if (target.closest('.chart-race__bar') || target.classList.contains('bar__value') || target.classList.contains('bar__release') || target.classList.contains('bar__name') || target.classList.contains('bar__gen') || target.classList.contains('bar__type-indicator') || target.classList.contains('bar__wins') || target.classList.contains('bar__rank') || target.classList.contains('bar__goalpost-label')) {
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
      goalpostLabel,
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
    yPosition: number,
    height: number,
    maxCumulative: number,
    snapshotDate: string,
    dataStore: DataStore,
    goalpostOverride?: boolean,
  ): void {
    // Store target rank — actual rank text is updated by the rank tracking loop
    barEl.targetRank = entry.rank;
    barEl.rankSpan.style.backgroundColor = ARTIST_TYPE_COLORS[entry.artistType];
    barEl.nameSpan.textContent = entry.artistName;
    barEl.genSpan.textContent = toRomanNumeral(entry.generation);
    barEl.typeIndicator.textContent = ARTIST_TYPE_INDICATORS[entry.artistType];
    barEl.bar.style.backgroundColor = ARTIST_TYPE_COLORS[entry.artistType];

    // Compute total wins (used by both goalpost label and normal display)
    const totalWins = computeTotalWins(entry.artistId, snapshotDate, dataStore);

    // Toggle goalpost mode (use override if provided, otherwise use entry flag)
    const isGoalpost = goalpostOverride !== undefined ? goalpostOverride : !!entry.isGoalpost;
    barEl.wrapper.classList.toggle("chart-race__bar-wrapper--goalpost", isGoalpost);
    barEl.bar.classList.toggle("chart-race__bar--goalpost", isGoalpost);

    if (isGoalpost) {
      // Goalpost mode: hide normal elements, bar becomes a thin dashed line
      barEl.rankSpan.style.display = "none";
      barEl.rankSpan.textContent = "";
      barEl.logo.style.display = "none";
      barEl.nameSpan.style.display = "none";
      barEl.genSpan.style.display = "none";
      barEl.typeIndicator.style.display = "none";
      barEl.releaseSpan.style.display = "none";
      barEl.valueSpan.style.display = "none";
      barEl.winsSpan.style.display = "none";

      // Bar becomes a dashed line (keeps its percentage width + rank badge width)
      barEl.bar.style.display = "";
      barEl.bar.style.height = "0";
      barEl.bar.style.padding = "0";
      barEl.bar.style.backgroundColor = "transparent";
      barEl.bar.style.borderRadius = "0";
      barEl.bar.style.borderTop = `2px dashed ${ARTIST_TYPE_COLORS[entry.artistType]}`;
      barEl.bar.style.overflow = "visible";
      barEl.wrapper.style.borderBottom = "";

      // Build compact label: #X · Artist · Points · N wins
      const winsText = totalWins > 0 ? ` · ${totalWins} ${totalWins === 1 ? "win" : "wins"}` : "";
      barEl.goalpostLabel.textContent = `#${entry.rank} · ${entry.artistName} · ${Math.round(entry.cumulativeValue).toLocaleString()}${winsText}`;
      barEl.goalpostLabel.style.display = "inline";
      barEl.goalpostLabel.style.color = ARTIST_TYPE_COLORS[entry.artistType];

      // Goalposts have no animations — snap to position instantly
      barEl.wrapper.style.transition = "none";
      barEl.bar.style.transition = "none";
    } else {
      // Normal mode: show normal elements, hide goalpost label
      barEl.rankSpan.style.display = "";
      barEl.bar.style.display = "";
      barEl.bar.style.height = "";
      barEl.bar.style.padding = "";
      barEl.bar.style.backgroundColor = ARTIST_TYPE_COLORS[entry.artistType];
      barEl.bar.style.borderRadius = "";
      barEl.bar.style.borderTop = "";
      barEl.bar.style.overflow = "";
      barEl.logo.style.display = "";
      barEl.nameSpan.style.display = "";
      barEl.genSpan.style.display = "";
      barEl.typeIndicator.style.display = "";
      barEl.releaseSpan.style.display = "";
      barEl.valueSpan.style.display = "";
      barEl.winsSpan.textContent = totalWins > 0 ? `${totalWins} ${totalWins === 1 ? "win" : "wins"}` : "";
      barEl.winsSpan.style.display = totalWins > 0 ? "" : "none";
      barEl.goalpostLabel.style.display = "none";
      barEl.wrapper.style.borderBottom = "";
    }

    // Update logo if changed
    if (barEl.logo.src !== entry.logoUrl && !barEl.logo.src.startsWith("data:")) {
      barEl.logo.src = entry.logoUrl;
    }

    // Featured release with per-song count if artist has multiple releases
    // Skip for goalposts (release span is hidden)
    if (!isGoalpost) {
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
    }

    // Bar width as percentage
    const widthPercent = computeBarWidth(entry.cumulativeValue, maxCumulative);
    const oldWidth = barEl.bar.style.width;
    if (isGoalpost) {
      // Add rank badge pixel width so dashed line visually matches regular bar alignment
      barEl.bar.style.width = `calc(${widthPercent}% + 30px)`;
    } else {
      barEl.bar.style.width = `${widthPercent}%`;
    }

    // Z-index based on TARGET position: bars heading to higher positions
    // (lower Y) get higher z-index so they're visually on top as they rise.
    // This makes the rising bar's rank badge visible as it crosses others.

    // Bar position via translateY
    barEl.wrapper.style.transform = `translateY(${yPosition}px)`;
    barEl.wrapper.style.height = `${height}px`;
    barEl.wrapper.style.opacity = "1";
    barEl.wrapper.style.zIndex = String(1000 - Math.round(yPosition));

    // Smart overflow: skip for goalposts (their elements are hidden)
    if (barEl.overflowTimeoutId !== null) {
      clearTimeout(barEl.overflowTimeoutId);
    }
    if (!isGoalpost) {
      const newWidthNum = widthPercent;
      const oldWidthNum = parseFloat(oldWidth || "0");
      const barGrew = newWidthNum > oldWidthNum + 1;
      if (this.scrubbing) {
        this.moveAllInside(barEl);
        barEl.bar.offsetHeight;
        this.checkBarOverflow(barEl);
      } else {
        barEl.overflowTimeoutId = setTimeout(() => {
          barEl.overflowTimeoutId = null;
          if (barGrew) {
            this.moveAllInside(barEl);
            barEl.bar.offsetHeight;
          }
          this.checkBarOverflow(barEl);
        }, 2880);
      }
    }

    // Numeric value tweening (snap in scrub mode or goalpost mode)
    if (this.scrubbing || isGoalpost) {
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
