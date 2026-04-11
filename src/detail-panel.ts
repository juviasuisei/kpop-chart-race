/**
 * Detail_Panel — modal/sidebar showing artist timeline with embedded media.
 * Full-screen overlay on mobile (<768px), sidebar on desktop (≥768px).
 * Single-column centered timeline, date-grouped entries, sticky header.
 */

import { EventBus } from "./event-bus.ts";
import type { DataStore, ParsedArtist, ParsedEmbedDateEntry } from "./models.ts";
import type { DailyValueEntry } from "./types.ts";
import { render as renderEmbed } from "./embed-renderer.ts";
import { toRomanNumeral } from "./utils.ts";
import { ARTIST_TYPE_COLORS } from "./colors.ts";
import { computeCumulativeValue } from "./chart-engine.ts";

/** Known chart sources that have logo assets */
const SOURCE_LOGO_MAP: Record<string, string> = {
  inkigayo: "assets/sources/inkigayo.png",
  the_show: "assets/sources/the_show.png",
  show_champion: "assets/sources/show_champion.png",
  music_bank: "assets/sources/music_bank.png",
  m_countdown: "assets/sources/m_countdown.png",
  show_music_core: "assets/sources/show_music_core.png",
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
  const tripleCrownCount = Math.floor(level / 3);
  const isTripleCrown = level % 3 === 0;
  if (isTripleCrown) {
    if (tripleCrownCount === 1) return `${level}x Win (Triple Crown)`;
    return `${level}x Win (${tripleCrownCount}x Triple Crown)`;
  }
  return `${level}x Win`;
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
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Open the detail panel for a given artist.
   */
  open(artistId: string, dataStore: DataStore, currentDate?: string): void {
    // Close any existing panel first
    if (this.panelEl) {
      this.close();
    }

    const artist = dataStore.artists.get(artistId);
    if (!artist) return;

    // Store the currently focused element for focus return
    this.previouslyFocusedEl = document.activeElement as HTMLElement | null;

    // Compute cumulative value if currentDate provided
    let cumulativeValue: number | undefined;
    if (currentDate) {
      cumulativeValue = computeCumulativeValue(artist, currentDate, dataStore.dates);
    }

    // Determine mobile vs desktop
    const isMobile = window.innerWidth < 768;

    // Create panel element
    const panel = document.createElement("div");
    panel.className = `detail-panel ${isMobile ? "detail-panel--mobile" : "detail-panel--desktop"}`;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", `Details for ${artist.name}`);

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "detail-panel__close-btn";
    closeBtn.setAttribute("aria-label", "Close detail panel");
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.close());
    panel.appendChild(closeBtn);

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

    // Type · Generation (+ debut)
    const metaEl = document.createElement("span");
    metaEl.className = "detail-panel__artist-meta";
    const genLabel = `${this.escapeHtml(this.formatArtistType(artist.artistType))} · ${toRomanNumeral(artist.generation)}`;
    const debutHtml = artist.debut
      ? ` <span class="detail-panel__debut">(debut: ${this.escapeHtml(artist.debut)})</span>`
      : "";
    metaEl.innerHTML = `${genLabel}${debutHtml}`;
    header.appendChild(metaEl);

    // Cumulative value
    if (cumulativeValue !== undefined) {
      const cumulEl = document.createElement("div");
      cumulEl.className = "detail-panel__cumulative";
      cumulEl.textContent = `${cumulativeValue.toLocaleString()} pts`;
      header.appendChild(cumulEl);
    }

    panel.appendChild(header);

    // Timeline container
    const timeline = document.createElement("div");
    timeline.className = "detail-panel__timeline";

    // Inner wrapper grows with content so the ::before line covers full scroll height
    const timelineInner = document.createElement("div");
    timelineInner.className = "detail-panel__timeline-inner";

    // Build date-grouped timeline items
    const dateGroups = this.buildDateGroups(artist, dataStore);

    // Set up IntersectionObserver for lazy-loading embeds
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const placeholder = entry.target as HTMLElement;
            const linkData = placeholder.dataset.embedUrl;
            const linkDesc = placeholder.dataset.embedDescription;
            if (linkData) {
              renderEmbed({ url: linkData, description: linkDesc || undefined }, placeholder);
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
      // Date header
      const dateHeader = document.createElement("div");
      dateHeader.className = "timeline-date-header";
      dateHeader.textContent = group.date;
      timelineInner.appendChild(dateHeader);

      // Date group container
      const groupContainer = document.createElement("div");
      groupContainer.className = "timeline-date-group";
      groupContainer.dataset.date = group.date;

      for (const item of group.items) {
        const entryEl = this.createTimelineEntry(item);
        groupContainer.appendChild(entryEl);
      }

      timelineInner.appendChild(groupContainer);
    }

    timeline.appendChild(timelineInner);
    panel.appendChild(timeline);

    // Add to DOM
    document.body.appendChild(panel);
    this.panelEl = panel;

    // Set up focus trap
    this.setupFocusTrap(panel);

    // Focus the close button
    closeBtn.focus();
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
  private buildDateGroups(artist: ParsedArtist, dataStore: DataStore): DateGroup[] {
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
        });
      }
    }

    // Group by date
    const groupMap = new Map<string, TimelineItem[]>();
    for (const item of items) {
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

    // Sort date keys descending (reverse chronological)
    const sortedDates = Array.from(groupMap.keys()).sort((a, b) => b.localeCompare(a));

    return sortedDates.map((date) => ({
      date,
      items: groupMap.get(date)!,
    }));
  }

  /**
   * Create a single timeline entry DOM element.
   * Single-column layout — no left/right alternation.
   */
  private createTimelineEntry(item: TimelineItem): HTMLElement {
    const entry = document.createElement("div");
    entry.className = "timeline-entry";

    // Release title
    const releaseEl = document.createElement("div");
    releaseEl.className = "timeline-entry__release";
    releaseEl.textContent = `♪ ${item.releaseTitle}`;
    entry.appendChild(releaseEl);

    // Chart source + episode + value
    if (item.dailyValue) {
      const sourceEl = document.createElement("div");
      sourceEl.className = "timeline-entry__source";

      const sourceName = item.dailyValue.source;
      if (SOURCE_LOGO_MAP[sourceName]) {
        const logo = document.createElement("img");
        logo.src = SOURCE_LOGO_MAP[sourceName];
        logo.alt = sourceName;
        logo.className = "timeline-entry__source-logo";
        logo.width = 80;
        logo.height = 80;
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

      // Crown icon above points value (if applicable)
      if (item.crownLevel > 0) {
        const config = getCrownConfig(item.crownLevel);
        const crownEl = document.createElement("div");
        crownEl.className = "timeline-entry__crown";

        const iconSpan = document.createElement("span");
        iconSpan.className = "crown__icon";

        const crownHeight = getCrownHeight(item.crownLevel);

        // For levels 1-12: single img. For 13+: multiple crown-12 imgs.
        if (item.crownLevel <= 12) {
          const img = document.createElement("img");
          img.src = config.svgPath;
          img.alt = config.label;
          img.width = crownHeight;
          img.height = crownHeight;
          iconSpan.appendChild(img);
        } else {
          const iconCount = item.crownLevel - 11;
          for (let i = 0; i < iconCount; i++) {
            const img = document.createElement("img");
            img.src = config.svgPath;
            img.alt = config.label;
            img.width = crownHeight;
            img.height = crownHeight;
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

      // Performance value with "pts" suffix
      const valueEl = document.createElement("div");
      valueEl.className = "timeline-entry__value";
      valueEl.textContent = `${item.dailyValue.value} pts`;
      entry.appendChild(valueEl);
    }

    // Embed groups
    for (const group of item.embedGroups) {
      const groupEl = document.createElement("div");
      groupEl.className = "timeline-entry__embed-group";

      // Event type label
      const labelEl = document.createElement("div");
      labelEl.className = "timeline-entry__event-type";
      labelEl.textContent = EVENT_TYPE_LABELS[group.eventType] ?? group.eventType;
      groupEl.appendChild(labelEl);

      // Embed links — lazy-loaded via IntersectionObserver
      for (const link of group.links) {
        const placeholder = document.createElement("div");
        placeholder.className = "detail-panel__embed-placeholder";
        placeholder.dataset.embedUrl = link.url;
        if (link.description) {
          placeholder.dataset.embedDescription = link.description;
        }
        groupEl.appendChild(placeholder);

        if (this.observer) {
          this.observer.observe(placeholder);
        }
      }

      entry.appendChild(groupEl);
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
   * Format an artist type string for display.
   */
  private formatArtistType(type: string): string {
    return type
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
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
