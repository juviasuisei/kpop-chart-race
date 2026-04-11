/**
 * Detail_Panel — modal/sidebar showing artist timeline with embedded media.
 * Full-screen overlay on mobile (<768px), sidebar on desktop (≥768px).
 * Vertical timeline with alternating left/right entries, lazy-loaded embeds.
 */

import { EventBus } from "./event-bus.ts";
import type { DataStore, ParsedArtist, ParsedEmbedDateEntry } from "./models.ts";
import type { DailyValueEntry } from "./types.ts";
import { render as renderEmbed } from "./embed-renderer.ts";
import { toRomanNumeral } from "./utils.ts";

/** Known chart sources that have logo assets */
const SOURCE_LOGO_MAP: Record<string, string> = {
  inkigayo: "assets/sources/inkigayo.svg",
  the_show: "assets/sources/the_show.svg",
  show_champion: "assets/sources/show_champion.svg",
  music_bank: "assets/sources/music_bank.svg",
};

/** Crown level emoji representations */
const CROWN_ICONS: Record<number, string> = {
  1: "👑",
  2: "👑👑",
  3: "👑👑👑",
  4: "👑👑👑👑",
  5: "👑👑👑👑👑",
};

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
  open(artistId: string, dataStore: DataStore): void {
    // Close any existing panel first
    if (this.panelEl) {
      this.close();
    }

    const artist = dataStore.artists.get(artistId);
    if (!artist) return;

    // Store the currently focused element for focus return
    this.previouslyFocusedEl = document.activeElement as HTMLElement | null;

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

    // Header
    const header = document.createElement("div");
    header.className = "detail-panel__header";
    header.innerHTML = `
      <h2 class="detail-panel__artist-name">${this.escapeHtml(artist.name)}</h2>
      <span class="detail-panel__artist-meta">${this.escapeHtml(this.formatArtistType(artist.artistType))} · ${toRomanNumeral(artist.generation)}</span>
    `;
    panel.appendChild(header);

    // Timeline container
    const timeline = document.createElement("div");
    timeline.className = "detail-panel__timeline";

    // Build timeline items
    const items = this.buildTimelineItems(artist, dataStore);

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

    // Render timeline entries
    items.forEach((item, index) => {
      const side = index % 2 === 0 ? "left" : "right";
      const entryEl = this.createTimelineEntry(item, side);
      timeline.appendChild(entryEl);
    });

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
   * Build a sorted list of timeline items from the artist's data.
   */
  private buildTimelineItems(artist: ParsedArtist, dataStore: DataStore): TimelineItem[] {
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

    // Sort by date ascending
    items.sort((a, b) => a.date.localeCompare(b.date));
    return items;
  }

  /**
   * Create a single timeline entry DOM element.
   */
  private createTimelineEntry(item: TimelineItem, side: "left" | "right"): HTMLElement {
    const entry = document.createElement("div");
    entry.className = `timeline-entry timeline-entry--${side}`;

    // Date heading
    const dateEl = document.createElement("div");
    dateEl.className = "timeline-entry__date";
    dateEl.textContent = item.date;
    entry.appendChild(dateEl);

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
        logo.width = 20;
        logo.height = 20;
        sourceEl.appendChild(logo);
      } else {
        const sourceText = document.createElement("span");
        sourceText.textContent = sourceName;
        sourceEl.appendChild(sourceText);
      }

      const episodeSpan = document.createElement("span");
      episodeSpan.textContent = ` Ep ${item.dailyValue.episode}`;
      sourceEl.appendChild(episodeSpan);
      entry.appendChild(sourceEl);

      // Performance value
      const valueEl = document.createElement("div");
      valueEl.className = "timeline-entry__value";
      valueEl.textContent = String(item.dailyValue.value);
      entry.appendChild(valueEl);

      // Crown icon if applicable
      if (item.crownLevel > 0) {
        const crownEl = document.createElement("div");
        crownEl.className = "timeline-entry__crown";
        const level = Math.min(item.crownLevel, 5) as 1 | 2 | 3 | 4 | 5;
        crownEl.textContent = CROWN_ICONS[level];
        if (item.crownLevel === 3) {
          crownEl.title = "Triple Crown";
        }
        entry.appendChild(crownEl);
      }
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
