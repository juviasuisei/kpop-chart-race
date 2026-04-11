/**
 * ScreenReaderPacedMode — controls configurable announcement depth
 * for screen reader users during chart playback.
 */
import type { ChartSnapshot } from "./models.ts";

const VALID_COUNTS = [1, 3, 5, 10] as const;

export class ScreenReaderPacedMode {
  private announcementCount = 1;
  private controlEl: HTMLElement | null = null;

  /**
   * Check if paced mode should be active based on prefers-reduced-motion.
   */
  isActive(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /**
   * Return the configured number of top artists to announce per date.
   */
  getAnnouncementCount(): number {
    return this.announcementCount;
  }

  /**
   * Set the number of top artists to announce. Valid values: 1, 3, 5, 10.
   */
  setAnnouncementCount(count: number): void {
    if ((VALID_COUNTS as readonly number[]).includes(count)) {
      this.announcementCount = count;
    }
  }

  /**
   * Format an announcement string with the date and top-N artist names
   * plus cumulative values.
   * E.g. "May 13, 2024: #1 Stellar Nova (2,450)"
   */
  formatAnnouncement(snapshot: ChartSnapshot): string {
    const dateStr = formatDate(snapshot.date);
    const count = Math.min(this.announcementCount, snapshot.entries.length);
    const parts: string[] = [];

    for (let i = 0; i < count; i++) {
      const entry = snapshot.entries[i];
      parts.push(`#${entry.rank} ${entry.artistName} (${formatNumber(entry.cumulativeValue)})`);
    }

    return `${dateStr}: ${parts.join(", ")}`;
  }

  /**
   * Create a visually hidden <select> control for configuring announcement count.
   * Accessible to screen readers and keyboard users.
   */
  mountControl(container: HTMLElement): void {
    const wrapper = document.createElement("div");
    wrapper.classList.add("visually-hidden");

    const label = document.createElement("label");
    label.textContent = "Artists announced per date";
    const labelId = "sr-paced-mode-label";
    label.id = labelId;

    const select = document.createElement("select");
    select.setAttribute("aria-labelledby", labelId);

    for (const val of VALID_COUNTS) {
      const option = document.createElement("option");
      option.value = String(val);
      option.textContent = String(val);
      if (val === this.announcementCount) {
        option.selected = true;
      }
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      this.setAnnouncementCount(Number(select.value));
    });

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    container.appendChild(wrapper);
    this.controlEl = wrapper;
  }

  /**
   * Remove the control from the DOM.
   */
  destroy(): void {
    if (this.controlEl) {
      this.controlEl.remove();
      this.controlEl = null;
    }
  }
}

/**
 * Format a YYYY-MM-DD date string into a human-readable form (e.g. "May 13, 2024").
 */
function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Format a number with comma separators (e.g. 2450 → "2,450").
 */
function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}
