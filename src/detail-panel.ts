/**
 * Detail_Panel — modal/sidebar showing artist timeline with embedded media.
 * Full-screen overlay on mobile (<768px), sidebar on desktop (≥768px).
 * Single-column centered timeline, date-grouped entries, sticky header.
 */

import { EventBus } from "./event-bus.ts";
import type { DataStore, ParsedArtist, ParsedEmbedDateEntry, ResolvedArtist } from "./models.ts";
import type { DailyValueEntry } from "./types.ts";
import { render as renderEmbed } from "./embed-renderer.ts";
import { toRomanNumeral, generateFallbackLogoDataUri } from "./utils.ts";
import { ARTIST_TYPE_COLORS } from "./colors.ts";
import { computeCumulativeValue, computeTotalWins } from "./chart-engine.ts";

/** Known chart sources that have logo assets */
const SOURCE_LOGO_MAP: Record<string, string> = {
  inkigayo: "assets/sources/inkigayo.png",
  the_show: "assets/sources/the_show.png",
  show_champion: "assets/sources/show_champion.png",
  music_bank: "assets/sources/music_bank.png",
  m_countdown: "assets/sources/m_countdown.png",
  show_music_core: "assets/sources/show_music_core.png",
};

/** Human-readable labels for chart sources */
const SOURCE_LABELS: Record<string, string> = {
  inkigayo: "SBS Inkigayo",
  the_show: "SBS The Show",
  show_champion: "MBC M Show Champion",
  music_bank: "KBS Music Bank",
  m_countdown: "Mnet M Countdown",
  show_music_core: "MBC Show! Music Core",
};

/** Crown level visual configuration */
interface CrownConfig {
  svgPath: string;
  label: string;
  cssClass: string;
}

/**
 * Get the crown label for a given level.
 * Levels that are multiples of 3 get a "Triple Crown" suffix.
 */
function getCrownLabel(level: number): string {
  if (level === 1) return "Win";
  const ordinal = getOrdinal(level);
  const tripleCrownCount = Math.floor(level / 3);
  const isTripleCrown = level % 3 === 0;
  if (isTripleCrown) {
    if (tripleCrownCount === 1) return "Triple Crown";
    return `${getOrdinal(tripleCrownCount)} Triple Crown`;
  }
  return `${ordinal} Win`;
}

/** Get ordinal suffix for a number (1st, 2nd, 3rd, 4th, etc.) */
function getOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Get the CrownConfig for a given crown level.
 * Levels 1-12 map to crown-1.svg through crown-12.svg.
 * Levels 13+ use crown-12.svg (rendered multiple times by the caller).
 */
function getCrownConfig(level: number): CrownConfig {
  const svgIndex = Math.min(level, 12);
  return {
    svgPath: `assets/crowns/crown-${svgIndex}.svg`,
    label: getCrownLabel(level),
    cssClass: "timeline-entry__crown",
  };
}

/**
 * Returns the crown icon height in pixels based on tier.
 * Levels 1–6 → 24px, 7–9 → 48px, 10+ → 72px.
 * Exported for testability.
 */
export function getCrownHeight(level: number): number {
  if (level >= 10) return 72;
  if (level >= 7) return 48;
  return 24;
}

/** Human-readable labels for event types */
const EVENT_TYPE_LABELS: Record<string, string> = {
  trailer: "Trailer",
  mv: "Music Video",
  live_performance: "Live Performance",
  release_date: "Release Date",
  chart_performance: "Chart Performance",
  promotion: "Promotion",
  behind_the_scenes: "Behind the Scenes",
  dance_practice: "Dance Practice",
  variety_show: "Variety Show",
  fan_event: "Fan Event",
};

/**
 * Represents a single timeline entry combining daily value data and embeds
 * for a specific date and release.
 */
interface TimelineItem {
  date: string;
  releaseTitle: string;
  releaseId: string;
  dailyValue?: DailyValueEntry;
  embedGroups: ParsedEmbedDateEntry[];
  crownLevel: number;
  /** True if this is an album release marked as a pre-release single */
  isPreReleaseSingle?: boolean;
  /** Ordered array of artist IDs credited on this release */
  artistIds?: string[];
  /** Additional releases on the same date — merged into one card */
  subReleases: { title: string; releaseId: string; value: number; source?: string; episode?: number }[];
  /** Embeds from other releases merged into this card, with their release title */
  mergedEmbeds: { releaseTitle: string; groups: ParsedEmbedDateEntry[] }[];
}

/** A date group containing all timeline items for that date */
interface DateGroup {
  date: string;
  items: TimelineItem[];
}

export class DetailPanel {
  private eventBus: EventBus;
  private panelEl: HTMLElement | null = null;
  private previouslyFocusedEl: HTMLElement | null = null;
  private observer: IntersectionObserver | null = null;
  private currentArtistDebut: string | undefined = undefined;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Open the detail panel for a given artist.
   * When coArtists is provided and has >1 entry, renders stacked multi-artist sections
   * with visual dividers between each artist's section.
   */
  open(artistId: string, dataStore: DataStore, currentDate?: string, currentRank?: number, coArtists?: ResolvedArtist[]): void {
    // Close any existing panel first
    if (this.panelEl) {
      this.close();
    }

    // Determine if we should render stacked multi-artist
    const isMultiArtist = coArtists !== undefined && coArtists.length > 1;

    const artist = dataStore.artists.get(artistId);
    if (!artist) return;

    this.currentArtistDebut = artist.debut;

    // Store the currently focused element for focus return
    this.previouslyFocusedEl = document.activeElement as HTMLElement | null;

    // Determine mobile vs desktop
    const isMobile = window.innerWidth < 768;

    // Create panel element
    const panel = document.createElement("div");
    panel.className = `detail-panel ${isMobile ? "detail-panel--mobile" : "detail-panel--desktop"}`;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    if (isMultiArtist) {
      panel.setAttribute("aria-label", `Details for ${coArtists!.map(a => a.name).join(", ")}`);
    } else {
      panel.setAttribute("aria-label", `Details for ${artist.name}`);
    }

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "detail-panel__close-btn";
    closeBtn.setAttribute("aria-label", "Close detail panel");
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.close());
    panel.appendChild(closeBtn);

    if (isMultiArtist) {
      // --- Multi-artist stacked rendering ---
      this.renderMultiArtistContent(panel, coArtists!, dataStore, currentDate, currentRank);
    } else {
      // --- Single artist rendering (existing behavior) ---
      this.renderSingleArtistContent(panel, artist, artistId, dataStore, currentDate, currentRank);
    }

    // Add to DOM
    document.body.appendChild(panel);
    this.panelEl = panel;

    // On desktop, squeeze the main app area to make room for the panel
    if (!isMobile) {
      const appEl = document.getElementById("app");
      if (appEl) {
        appEl.style.marginRight = "500px";
        appEl.style.transition = "margin-right 0.3s ease";
      }
    }

    // Set up focus trap
    this.setupFocusTrap(panel);

    // Focus the close button
    closeBtn.focus();
  }

  /**
   * Renders stacked multi-artist content with visual dividers between each artist section.
   */
  private renderMultiArtistContent(
    panel: HTMLElement,
    coArtists: ResolvedArtist[],
    dataStore: DataStore,
    currentDate?: string,
    currentRank?: number,
  ): void {
    // Single scrollable container for all stacked artist sections
    const scrollContainer = document.createElement("div");
    scrollContainer.className = "detail-panel__timeline";
    scrollContainer.style.flex = "1 1 auto";
    scrollContainer.style.overflowY = "auto";

    const scrollInner = document.createElement("div");
    scrollInner.className = "detail-panel__timeline-inner detail-panel__timeline-inner--multi";

    // Set up IntersectionObserver for lazy-loading embeds
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const placeholder = entry.target as HTMLElement;
            const linkData = placeholder.dataset.embedUrl;
            if (linkData) {
              renderEmbed(linkData, placeholder);
              placeholder.classList.remove("detail-panel__embed-placeholder");
              this.observer?.unobserve(placeholder);
            }
          }
        }
      },
      { root: scrollContainer, rootMargin: "200px" },
    );

    for (let idx = 0; idx < coArtists.length; idx++) {
      const resolvedArtist = coArtists[idx];
      const artist = dataStore.artists.get(resolvedArtist.id);
      if (!artist) continue;

      // Add visual divider between artist sections (not before the first)
      if (idx > 0) {
        const divider = document.createElement("hr");
        divider.className = "detail-panel__divider";
        scrollInner.appendChild(divider);
      }

      // Create a section wrapper for this artist
      const section = document.createElement("div");
      section.className = "detail-panel__artist-section";

      // Render header for this artist (centered like single-artist mode)
      const header = this.createArtistHeader(artist, resolvedArtist.id, dataStore, currentDate, idx === 0 ? currentRank : undefined);
      header.style.textAlign = "center";
      section.appendChild(header);

      // Store debut for this artist
      this.currentArtistDebut = artist.debut;

      const dateGroups = this.buildDateGroups(artist, dataStore, currentDate);

      for (const group of dateGroups) {
        const groupContainer = document.createElement("div");
        groupContainer.className = "timeline-date-group";
        groupContainer.dataset.date = group.date;

        for (let i = 0; i < group.items.length; i++) {
          const entryEl = this.createTimelineEntry(group.items[i], i === 0 ? group.date : undefined);
          groupContainer.appendChild(entryEl);
        }

        section.appendChild(groupContainer);
      }

      scrollInner.appendChild(section);
    }

    scrollContainer.appendChild(scrollInner);
    panel.appendChild(scrollContainer);
  }

  /**
   * Renders single artist content (original behavior extracted into a method).
   */
  private renderSingleArtistContent(
    panel: HTMLElement,
    artist: ParsedArtist,
    artistId: string,
    dataStore: DataStore,
    currentDate?: string,
    currentRank?: number,
  ): void {
    // Compute cumulative value if currentDate provided
    let cumulativeValue: number | undefined;
    if (currentDate) {
      cumulativeValue = computeCumulativeValue(artist, currentDate, dataStore.dates);
    }

    // Sticky Header
    const header = document.createElement("div");
    header.className = "detail-panel__header detail-panel__header--sticky";

    // Logo with colored background
    const logoBg = document.createElement("div");
    logoBg.className = "detail-panel__logo-bg";
    logoBg.style.backgroundColor = ARTIST_TYPE_COLORS[artist.artistType];

    const logoImg = document.createElement("img");
    logoImg.className = "detail-panel__logo-img";
    logoImg.src = artist.logoUrl;
    logoImg.alt = `${artist.name} logo`;
    logoImg.width = 80;
    logoImg.height = 80;
    logoImg.onerror = () => {
      logoImg.src = generateFallbackLogoDataUri(artist.koreanName ?? artist.name);
    };
    logoBg.appendChild(logoImg);
    header.appendChild(logoBg);

    // Artist name (+ Korean name)
    const nameEl = document.createElement("h2");
    nameEl.className = "detail-panel__artist-name";
    const nameHtml = artist.koreanName
      ? `${this.escapeHtml(artist.name)} (${this.escapeHtml(artist.koreanName)})`
      : this.escapeHtml(artist.name);
    nameEl.innerHTML = nameHtml;
    header.appendChild(nameEl);

    // Generation (+ debut) — use "solo debut" for solo artists
    const metaEl = document.createElement("span");
    metaEl.className = "detail-panel__artist-meta";
    const genLabel = toRomanNumeral(artist.generation);
    const isSolo = artist.artistType.startsWith("solo_");
    const debutPrefix = isSolo ? "solo debut" : "debut";
    const debutHtml = artist.debut
      ? ` <span class="detail-panel__debut">(${debutPrefix}: ${this.escapeHtml(artist.debut)})</span>`
      : "";
    metaEl.innerHTML = `${genLabel}${debutHtml}`;
    header.appendChild(metaEl);

    // Rank and cumulative value on one line
    if (currentRank !== undefined || cumulativeValue !== undefined) {
      const statsEl = document.createElement("div");
      statsEl.className = "detail-panel__stats";
      const parts: string[] = [];
      if (currentRank !== undefined && currentRank > 0) {
        parts.push(`#${currentRank}`);
      }
      if (cumulativeValue !== undefined) {
        parts.push(`${cumulativeValue.toLocaleString()} pts`);
      }
      statsEl.textContent = parts.join(" · ");
      header.appendChild(statsEl);
    }

    // Total wins count
    if (currentDate) {
      const totalWins = computeTotalWins(artistId, currentDate, dataStore);
      if (totalWins > 0) {
        const winsEl = document.createElement("div");
        winsEl.className = "detail-panel__total-wins";
        winsEl.textContent = `${totalWins} ${totalWins === 1 ? "win" : "wins"}`;
        header.appendChild(winsEl);
      }
    }

    panel.appendChild(header);

    // Timeline container
    const timeline = document.createElement("div");
    timeline.className = "detail-panel__timeline";

    // Inner wrapper grows with content so the ::before line covers full scroll height
    const timelineInner = document.createElement("div");
    timelineInner.className = "detail-panel__timeline-inner";

    // Build date-grouped timeline items
    const dateGroups = this.buildDateGroups(artist, dataStore, currentDate);

    // Set up IntersectionObserver for lazy-loading embeds
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const placeholder = entry.target as HTMLElement;
            const linkData = placeholder.dataset.embedUrl;
            if (linkData) {
              renderEmbed(linkData, placeholder);
              placeholder.classList.remove("detail-panel__embed-placeholder");
              this.observer?.unobserve(placeholder);
            }
          }
        }
      },
      { root: timeline, rootMargin: "200px" },
    );

    // Render date groups into the inner wrapper
    for (const group of dateGroups) {
      // Date group container
      const groupContainer = document.createElement("div");
      groupContainer.className = "timeline-date-group";
      groupContainer.dataset.date = group.date;

      for (let i = 0; i < group.items.length; i++) {
        const entryEl = this.createTimelineEntry(group.items[i], i === 0 ? group.date : undefined);
        groupContainer.appendChild(entryEl);
      }

      timelineInner.appendChild(groupContainer);
    }

    timeline.appendChild(timelineInner);
    panel.appendChild(timeline);
  }

  /**
   * Creates the header section for an artist (used in both single and multi-artist modes).
   */
  private createArtistHeader(
    artist: ParsedArtist,
    artistId: string,
    dataStore: DataStore,
    currentDate?: string,
    currentRank?: number,
  ): HTMLElement {
    const header = document.createElement("div");
    header.className = "detail-panel__header";

    // Logo with colored background
    const logoBg = document.createElement("div");
    logoBg.className = "detail-panel__logo-bg";
    logoBg.style.backgroundColor = ARTIST_TYPE_COLORS[artist.artistType];

    const logoImg = document.createElement("img");
    logoImg.className = "detail-panel__logo-img";
    logoImg.src = artist.logoUrl;
    logoImg.alt = `${artist.name} logo`;
    logoImg.width = 80;
    logoImg.height = 80;
    logoImg.onerror = () => {
      logoImg.src = generateFallbackLogoDataUri(artist.koreanName ?? artist.name);
    };
    logoBg.appendChild(logoImg);
    header.appendChild(logoBg);

    // Artist name (+ Korean name)
    const nameEl = document.createElement("h2");
    nameEl.className = "detail-panel__artist-name";
    const nameHtml = artist.koreanName
      ? `${this.escapeHtml(artist.name)} (${this.escapeHtml(artist.koreanName)})`
      : this.escapeHtml(artist.name);
    nameEl.innerHTML = nameHtml;
    header.appendChild(nameEl);

    // Generation (+ debut) — use "solo debut" for solo artists
    const metaEl = document.createElement("span");
    metaEl.className = "detail-panel__artist-meta";
    const genLabel = toRomanNumeral(artist.generation);
    const isSolo = artist.artistType.startsWith("solo_");
    const debutPrefix = isSolo ? "solo debut" : "debut";
    const debutHtml = artist.debut
      ? ` <span class="detail-panel__debut">(${debutPrefix}: ${this.escapeHtml(artist.debut)})</span>`
      : "";
    metaEl.innerHTML = `${genLabel}${debutHtml}`;
    header.appendChild(metaEl);

    // Compute cumulative value if currentDate provided
    let cumulativeValue: number | undefined;
    if (currentDate) {
      cumulativeValue = computeCumulativeValue(artist, currentDate, dataStore.dates);
    }

    // Rank and cumulative value on one line
    if (currentRank !== undefined || cumulativeValue !== undefined) {
      const statsEl = document.createElement("div");
      statsEl.className = "detail-panel__stats";
      const parts: string[] = [];
      if (currentRank !== undefined && currentRank > 0) {
        parts.push(`#${currentRank}`);
      }
      if (cumulativeValue !== undefined) {
        parts.push(`${cumulativeValue.toLocaleString()} pts`);
      }
      statsEl.textContent = parts.join(" · ");
      header.appendChild(statsEl);
    }

    // Total wins count
    if (currentDate) {
      const totalWins = computeTotalWins(artistId, currentDate, dataStore);
      if (totalWins > 0) {
        const winsEl = document.createElement("div");
        winsEl.className = "detail-panel__total-wins";
        winsEl.textContent = `${totalWins} ${totalWins === 1 ? "win" : "wins"}`;
        header.appendChild(winsEl);
      }
    }

    return header;
  }

  /**
   * Close the detail panel and return focus.
   */
  close(): void {
    if (!this.panelEl) return;

    // Clean up observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Remove keyboard handler
    if (this.boundKeyHandler) {
      document.removeEventListener("keydown", this.boundKeyHandler);
      this.boundKeyHandler = null;
    }

    // Remove from DOM
    this.panelEl.remove();
    this.panelEl = null;

    // Restore main app area width
    const appEl = document.getElementById("app");
    if (appEl) {
      appEl.style.marginRight = "";
    }

    // Return focus
    if (this.previouslyFocusedEl && document.contains(this.previouslyFocusedEl)) {
      this.previouslyFocusedEl.focus();
    }
    this.previouslyFocusedEl = null;

    // Emit close event
    this.eventBus.emit("panel:close");
  }

  /**
   * Check if the panel is currently open.
   */
  isOpen(): boolean {
    return this.panelEl !== null && document.contains(this.panelEl);
  }

  /**
   * Destroy the panel, cleaning up all resources.
   */
  destroy(): void {
    if (this.isOpen()) {
      this.close();
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  /**
   * Build date-grouped timeline items from the artist's data.
   * Returns groups sorted in reverse chronological order.
   * Within each group, chart performance items come before embed-only items.
   */
  private buildDateGroups(artist: ParsedArtist, dataStore: DataStore, currentDate?: string): DateGroup[] {
    const items: TimelineItem[] = [];

    for (const release of artist.releases) {
      // Collect all dates from both dailyValues and embeds
      const allDates = new Set<string>();
      for (const date of release.dailyValues.keys()) {
        allDates.add(date);
      }
      for (const date of release.embeds.keys()) {
        allDates.add(date);
      }

      for (const date of allDates) {
        const dailyValue = release.dailyValues.get(date);
        const embedGroups = release.embeds.get(date) ?? [];

        // Determine crown level from chart wins
        let crownLevel = 0;
        if (dailyValue) {
          const dateWins = dataStore.chartWins.get(date);
          if (dateWins) {
            const sourceWins = dateWins.get(dailyValue.source);
            if (sourceWins && sourceWins.artistIds.includes(artist.id)) {
              crownLevel = sourceWins.crownLevels.get(artist.id) ?? 0;
            }
          }
        }

        items.push({
          date,
          releaseTitle: release.title,
          releaseId: release.id,
          dailyValue,
          embedGroups,
          crownLevel,
          artistIds: release.artistIds,
          subReleases: [],
          mergedEmbeds: [],
        });
      }
    }

    // Inject albumReleases as timeline items with release_date embeds
    for (const albumRelease of artist.albumReleases) {
      items.push({
        date: albumRelease.date,
        releaseTitle: "",
        releaseId: "",
        dailyValue: undefined,
        embedGroups: [{ type: "release_date", url: albumRelease.appleMusicUrl }],
        crownLevel: 0,
        isPreReleaseSingle: albumRelease.isSingle,
        artistIds: albumRelease.artistIds,
        subReleases: [],
        mergedEmbeds: [],
      });
    }

    // Merge items that share the same (date, source, episode) into one card.
    // The highest-value release becomes the primary; others become subReleases.
    // Only the primary gets the crown.
    const mergedItems: TimelineItem[] = [];
    const mergeMap = new Map<string, TimelineItem>();

    for (const item of items) {
      const key = item.date;
      const existing = mergeMap.get(key);

      if (item.dailyValue) {
        if (existing && existing.dailyValue) {
          // Merge: add as sub-release
          if (item.dailyValue.value > existing.dailyValue.value) {
            // New item is higher — swap: existing becomes sub-release
            existing.subReleases.push({
              title: existing.releaseTitle,
              releaseId: existing.releaseId,
              value: existing.dailyValue.value,
              source: existing.dailyValue.source,
              episode: existing.dailyValue.episode,
            });
            // Move existing's embeds to mergedEmbeds if they belong to the old release
            if (existing.embedGroups.length > 0) {
              existing.mergedEmbeds.push({ releaseTitle: existing.releaseTitle, groups: existing.embedGroups });
              existing.embedGroups = [];
            }
            existing.releaseTitle = item.releaseTitle;
            existing.releaseId = item.releaseId;
            existing.dailyValue = item.dailyValue;
            existing.crownLevel = item.crownLevel;
            if (item.embedGroups.length > 0) {
              existing.embedGroups = item.embedGroups;
            }
          } else {
            // Existing is higher or equal — add new as sub-release
            existing.subReleases.push({
              title: item.releaseTitle,
              releaseId: item.releaseId,
              value: item.dailyValue.value,
              source: item.dailyValue.source,
              episode: item.dailyValue.episode,
            });
            if (item.embedGroups.length > 0) {
              existing.mergedEmbeds.push({ releaseTitle: item.releaseTitle, groups: item.embedGroups });
            }
          }
        } else if (existing) {
          // Existing is embed-only, new has chart data — new becomes primary
          // Keep existing embeds as merged (they're from a different release)
          if (existing.embedGroups.length > 0) {
            existing.mergedEmbeds.push({ releaseTitle: existing.releaseTitle, groups: existing.embedGroups });
            existing.embedGroups = [];
          }
          existing.releaseTitle = item.releaseTitle;
          existing.releaseId = item.releaseId;
          existing.dailyValue = item.dailyValue;
          existing.crownLevel = item.crownLevel;
          if (item.embedGroups.length > 0) {
            existing.embedGroups = item.embedGroups;
          }
        } else {
          mergeMap.set(key, item);
          mergedItems.push(item);
        }
      } else {
        // Embed-only item — merge into existing card for same date
        if (existing) {
          if (item.embedGroups.length > 0) {
            existing.mergedEmbeds.push({ releaseTitle: item.releaseTitle, groups: item.embedGroups });
          }
          // Propagate isPreReleaseSingle flag from album release items
          if (item.isPreReleaseSingle) {
            existing.isPreReleaseSingle = true;
          }
        } else {
          mergeMap.set(key, item);
          mergedItems.push(item);
        }
      }
    }

    // Group by date
    const groupMap = new Map<string, TimelineItem[]>();
    for (const item of mergedItems) {
      const existing = groupMap.get(item.date);
      if (existing) {
        existing.push(item);
      } else {
        groupMap.set(item.date, [item]);
      }
    }

    // Sort each group: chart performance items before embed-only items
    for (const [, groupItems] of groupMap) {
      groupItems.sort((a, b) => {
        const aHasChart = a.dailyValue ? 0 : 1;
        const bHasChart = b.dailyValue ? 0 : 1;
        return aHasChart - bHasChart;
      });
    }

    // Sort date keys descending (reverse chronological), filtered to currentDate
    const allDates = Array.from(groupMap.keys())
      .filter(d => !currentDate || d <= currentDate)
      .sort((a, b) => b.localeCompare(a));

    return allDates.map((date) => ({
      date,
      items: groupMap.get(date)!,
    }));
  }

  /**
   * Create a single timeline entry DOM element.
   * Single-column layout — no left/right alternation.
   */
  private createTimelineEntry(item: TimelineItem, showDate?: string): HTMLElement {
    const entry = document.createElement("div");
    entry.className = "timeline-entry";

    // Date inside the card (only for first item in a date group)
    if (showDate) {
      const dateEl = document.createElement("div");
      dateEl.className = "timeline-entry__date";
      dateEl.textContent = showDate;
      entry.appendChild(dateEl);
    }

    // Chart source + episode + value
    if (item.dailyValue) {
      const sourceEl = document.createElement("div");
      sourceEl.className = "timeline-entry__source";

      const sourceName = item.dailyValue.source;
      if (SOURCE_LOGO_MAP[sourceName]) {
        const logo = document.createElement("img");
        logo.src = SOURCE_LOGO_MAP[sourceName];
        logo.alt = SOURCE_LABELS[sourceName] ?? sourceName;
        logo.className = "timeline-entry__source-logo";
        logo.width = 80;

        // Custom instant tooltip on hover
        const tooltipText = SOURCE_LABELS[sourceName] ?? sourceName;
        logo.addEventListener("mouseenter", () => {
          let tooltip = document.querySelector(".custom-tooltip") as HTMLElement | null;
          if (!tooltip) {
            tooltip = document.createElement("div");
            tooltip.className = "custom-tooltip";
            document.body.appendChild(tooltip);
          }
          tooltip.textContent = tooltipText;
          tooltip.style.display = "block";
          const rect = logo.getBoundingClientRect();
          let left = rect.left + rect.width / 2;
          tooltip.style.left = `${left}px`;
          tooltip.style.top = `${rect.top - 6}px`;
          // Clamp to viewport
          const tipRect = tooltip.getBoundingClientRect();
          if (tipRect.right > window.innerWidth - 8) {
            tooltip.style.left = `${window.innerWidth - 8 - tipRect.width / 2}px`;
          }
          if (tipRect.left < 8) {
            tooltip.style.left = `${8 + tipRect.width / 2}px`;
          }
        });
        logo.addEventListener("mouseleave", () => {
          const tooltip = document.querySelector(".custom-tooltip") as HTMLElement | null;
          if (tooltip) tooltip.style.display = "none";
        });
        sourceEl.appendChild(logo);
      } else {
        const sourceText = document.createElement("span");
        sourceText.textContent = sourceName;
        sourceEl.appendChild(sourceText);
      }

      // Episode number as separate block element below logo
      const episodeEl = document.createElement("div");
      episodeEl.className = "timeline-entry__episode";
      episodeEl.textContent = `Ep ${item.dailyValue.episode}`;
      sourceEl.appendChild(episodeEl);
      entry.appendChild(sourceEl);

      // Crown icon with label next to it (if applicable)
      if (item.crownLevel > 0) {
        const config = getCrownConfig(item.crownLevel);
        const crownEl = document.createElement("div");
        crownEl.className = "timeline-entry__crown";

        const iconSpan = document.createElement("span");
        const tier = item.crownLevel >= 10 ? 3 : item.crownLevel >= 7 ? 2 : 1;
        iconSpan.className = `crown__icon crown__icon--tier-${tier}`;

        // For levels 1-12: single img. For 13+: multiple crown-12 imgs.
        if (item.crownLevel <= 12) {
          const img = document.createElement("img");
          img.src = config.svgPath;
          img.alt = config.label;
          iconSpan.appendChild(img);
        } else {
          const iconCount = item.crownLevel - 11;
          for (let i = 0; i < iconCount; i++) {
            const img = document.createElement("img");
            img.src = config.svgPath;
            img.alt = config.label;
            iconSpan.appendChild(img);
          }
        }
        crownEl.appendChild(iconSpan);

        const labelSpan = document.createElement("span");
        labelSpan.className = "crown__label";
        labelSpan.textContent = config.label;
        crownEl.appendChild(labelSpan);

        if (item.crownLevel === 3) {
          crownEl.title = "Triple Crown";
        }
        entry.appendChild(crownEl);
      }

      // Release title right above points
      const releaseEl = document.createElement("div");
      releaseEl.className = "timeline-entry__release";
      releaseEl.textContent = `♪ ${item.releaseTitle}`;
      entry.appendChild(releaseEl);

      // Performance value with commas and "pts" suffix
      const valueEl = document.createElement("div");
      valueEl.className = "timeline-entry__value";
      valueEl.textContent = `${item.dailyValue.value.toLocaleString()} pts`;
      entry.appendChild(valueEl);

      // Sub-releases (other songs on the same day, possibly different shows)
      for (const sub of item.subReleases) {
        const subEl = document.createElement("div");
        subEl.className = "timeline-entry__sub-release";
        const sourceLabel = sub.source && sub.source !== item.dailyValue.source
          ? ` (${sub.source} Ep ${sub.episode})`
          : "";
        subEl.textContent = `♪ ${sub.title}${sourceLabel} — ${sub.value.toLocaleString()} pts`;
        entry.appendChild(subEl);
      }
    } else {
      // Embed-only entry — show release title only if it has one (albumReleases have empty title)
      if (item.releaseTitle) {
        const releaseEl = document.createElement("div");
        releaseEl.className = "timeline-entry__release";
        releaseEl.textContent = `♪ ${item.releaseTitle}`;
        entry.appendChild(releaseEl);
      }
    }

    // Embed groups — sorted so live performances come first (closest to chart data)
    const sortedEmbeds = [...item.embedGroups].sort((a, b) => {
      const order: Record<string, number> = {
        live_performance: 0,
        chart_performance: 1,
        mv: 2,
        release_date: 3,
        trailer: 4,
        dance_practice: 5,
        promotion: 6,
        behind_the_scenes: 7,
        variety_show: 8,
        fan_event: 9,
      };
      return (order[a.type] ?? 10) - (order[b.type] ?? 10);
    });
    for (const group of sortedEmbeds) {
      const groupEl = document.createElement("div");
      groupEl.className = "timeline-entry__embed-group";

      // Event type label — use "Debut", "Pre-Release Single", "Collaboration", or "Comeback" for release_date entries
      const labelEl = document.createElement("div");
      labelEl.className = "timeline-entry__event-type";
      if (group.type === "release_date") {
        if (item.isPreReleaseSingle) {
          labelEl.textContent = "Pre-Release Single";
        } else if (item.artistIds && item.artistIds.length > 1) {
          labelEl.textContent = "Collaboration";
        } else if (this.currentArtistDebut && item.date === this.currentArtistDebut) {
          labelEl.textContent = "Debut";
        } else {
          labelEl.textContent = "Comeback";
        }
      } else {
        labelEl.textContent = EVENT_TYPE_LABELS[group.type] ?? group.type;
      }
      groupEl.appendChild(labelEl);

      // Embed — lazy-loaded via IntersectionObserver
      const placeholder = document.createElement("div");
      placeholder.className = "detail-panel__embed-placeholder";
      placeholder.dataset.embedUrl = group.url;
      groupEl.appendChild(placeholder);

      if (this.observer) {
        this.observer.observe(placeholder);
      }

      entry.appendChild(groupEl);
    }

    // Merged embeds from other releases on the same date — with song headings
    for (const merged of item.mergedEmbeds) {
      // Only show song heading if it has a title (albumReleases have empty title)
      if (merged.releaseTitle) {
        const songHeading = document.createElement("div");
        songHeading.className = "timeline-entry__release";
        songHeading.textContent = `♪ ${merged.releaseTitle}`;
        songHeading.style.marginTop = "0.75rem";
        entry.appendChild(songHeading);
      }

      const sortedMerged = [...merged.groups].sort((a, b) => {
        const order: Record<string, number> = {
          live_performance: 0, chart_performance: 1, mv: 2, release_date: 3,
          trailer: 4, dance_practice: 5, promotion: 6, behind_the_scenes: 7,
          variety_show: 8, fan_event: 9,
        };
        return (order[a.type] ?? 10) - (order[b.type] ?? 10);
      });

      for (const group of sortedMerged) {
        const groupEl = document.createElement("div");
        groupEl.className = "timeline-entry__embed-group";

        const labelEl = document.createElement("div");
        labelEl.className = "timeline-entry__event-type";
        if (group.type === "release_date") {
          if (item.isPreReleaseSingle) {
            labelEl.textContent = "Pre-Release Single";
          } else if (item.artistIds && item.artistIds.length > 1) {
            labelEl.textContent = "Collaboration";
          } else if (this.currentArtistDebut && item.date === this.currentArtistDebut) {
            labelEl.textContent = "Debut";
          } else {
            labelEl.textContent = "Comeback";
          }
        } else {
          labelEl.textContent = EVENT_TYPE_LABELS[group.type] ?? group.type;
        }
        groupEl.appendChild(labelEl);

        const placeholder = document.createElement("div");
        placeholder.className = "detail-panel__embed-placeholder";
        placeholder.dataset.embedUrl = group.url;
        groupEl.appendChild(placeholder);
        if (this.observer) {
          this.observer.observe(placeholder);
        }

        entry.appendChild(groupEl);
      }
    }

    return entry;
  }

  /**
   * Set up a focus trap within the panel.
   */
  private setupFocusTrap(panel: HTMLElement): void {
    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.close();
        return;
      }

      if (e.key !== "Tab") return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", this.boundKeyHandler);
  }

  /**
   * Escape HTML special characters to prevent XSS.
   */
  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
