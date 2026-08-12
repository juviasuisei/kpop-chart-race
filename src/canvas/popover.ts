/**
 * Popover — Floating panel for event dot details with embedded media.
 *
 * Attaches near an event dot on the highlight canvas, showing:
 *   - Event date and type
 *   - Embedded YouTube player (for MVs and live performances)
 *   - Apple Music link (for releases)
 *   - Multiple events listed if several occurred on the same date
 *
 * Positioned to avoid overflow outside the chart container.
 */

import type { EventDot, EventInfo } from "./event-dots.ts";
import { render as renderEmbed } from "../embed-renderer.ts";
import type { EventType } from "../types.ts";

/** Human-readable labels for event types */
const TYPE_LABELS: Record<string, string> = {
  chart_win: "Chart Win 👑",
  live_performance: "Live Performance 🎤",
  mv: "Music Video 🎬",
  release_date: "Release 🎵",
  chart_performance: "Chart Appearance 📊",
  trailer: "Trailer",
  promotion: "Promotion",
  behind_the_scenes: "Behind the Scenes",
  dance_practice: "Dance Practice",
  variety_show: "Variety Show",
  fan_event: "Fan Event",
};

/**
 * Manages a single popover DOM element that repositions on demand.
 */
export class Popover {
  private container: HTMLElement;
  private element: HTMLDivElement | null = null;
  private currentDot: EventDot | null = null;
  private visible = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Show the popover near an event dot.
   */
  show(dot: EventDot, containerRect: DOMRect): void {
    if (!this.element) {
      this.createElement();
    }

    this.currentDot = dot;
    this.visible = true;
    this.render(dot);
    this.position(dot, containerRect);
    this.element!.style.display = "block";
    this.element!.classList.add("popover--visible");
  }

  /**
   * Hide the popover.
   */
  hide(): void {
    if (!this.element || !this.visible) return;
    this.visible = false;
    this.currentDot = null;
    this.element.classList.remove("popover--visible");
    this.element.style.display = "none";
    // Clear embeds to stop video playback
    this.element.innerHTML = "";
  }

  /**
   * Check if the popover is currently visible.
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Get the currently shown dot (for hit testing).
   */
  getCurrentDot(): EventDot | null {
    return this.currentDot;
  }

  /**
   * Destroy the popover DOM element.
   */
  destroy(): void {
    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
    this.element = null;
    this.visible = false;
  }

  // --- Private ---

  private createElement(): void {
    this.element = document.createElement("div");
    this.element.className = "line-chart-popover";
    this.element.style.display = "none";
    this.element.style.position = "absolute";
    this.element.style.zIndex = "1000";
    this.element.setAttribute("role", "tooltip");

    // Close on click inside (stops propagation to prevent deselect)
    this.element.addEventListener("click", (e) => e.stopPropagation());

    this.container.appendChild(this.element);
  }

  private render(dot: EventDot): void {
    if (!this.element) return;
    this.element.innerHTML = "";

    // Header with date
    const header = document.createElement("div");
    header.className = "line-chart-popover__header";
    header.textContent = formatDate(dot.date);
    this.element.appendChild(header);

    // Event list
    const list = document.createElement("div");
    list.className = "line-chart-popover__events";

    for (const event of dot.events) {
      const item = this.renderEvent(event);
      list.appendChild(item);
    }

    this.element.appendChild(list);
  }

  private renderEvent(event: EventInfo): HTMLElement {
    const item = document.createElement("div");
    item.className = "line-chart-popover__event";

    // Type label
    const label = document.createElement("div");
    label.className = "line-chart-popover__event-type";
    label.textContent = TYPE_LABELS[event.type] ?? event.type;
    item.appendChild(label);

    // Source (for chart wins)
    if (event.source) {
      const source = document.createElement("div");
      source.className = "line-chart-popover__event-source";
      source.textContent = event.source;
      item.appendChild(source);
    }

    // Embedded media (for MVs and live performances with URLs)
    if (event.url && hasEmbeddableMedia(event.type)) {
      const embedContainer = document.createElement("div");
      embedContainer.className = "line-chart-popover__embed";
      renderEmbed(event.url, embedContainer);
      item.appendChild(embedContainer);
    } else if (event.url) {
      // Non-embeddable URL → show as link
      const link = document.createElement("a");
      link.className = "line-chart-popover__link";
      link.href = event.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open ↗";
      item.appendChild(link);
    }

    return item;
  }

  private position(dot: EventDot, containerRect: DOMRect): void {
    if (!this.element) return;

    const popoverWidth = 320;
    const popoverMaxHeight = 400;
    const offset = 12; // Gap between dot and popover

    // Prefer positioning to the right of the dot
    let left = dot.x + offset;
    let top = dot.y - 40;

    // If it would overflow right, position to the left
    if (left + popoverWidth > containerRect.width) {
      left = dot.x - popoverWidth - offset;
    }

    // If it would overflow left, center below
    if (left < 0) {
      left = Math.max(8, dot.x - popoverWidth / 2);
      top = dot.y + offset;
    }

    // Clamp vertical
    top = Math.max(8, Math.min(containerRect.height - popoverMaxHeight - 8, top));

    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
    this.element.style.maxWidth = `${popoverWidth}px`;
    this.element.style.maxHeight = `${popoverMaxHeight}px`;
  }
}

// --- Utilities ---

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function hasEmbeddableMedia(type: EventType | "chart_win"): boolean {
  return type === "mv" || type === "live_performance" || type === "trailer";
}
