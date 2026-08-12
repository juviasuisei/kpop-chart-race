/**
 * Tooltip — Rich floating tooltip shown on line hover.
 * Matches the prototype's style: colored background matching the line,
 * date row with source logo, artist initials, song name, stats, embed placeholders.
 */

export interface TooltipData {
  label: string;
  artistName: string;
  songTitle?: string;
  color: string;
  value?: number;
  dailyGain?: number;
  date?: string;
  /** Source logo URL (chart show) */
  sourceLogoUrl?: string;
  /** Source display label */
  sourceLabel?: string;
  /** Event type labels (e.g. "Chart Win · Live Performance") */
  eventLabel?: string;
  /** Whether to show embed placeholders */
  showEmbed?: boolean;
  /** Whether there is a video embed */
  hasVideo?: boolean;
  /** Whether there is a release/apple music embed */
  hasRelease?: boolean;
  /** Artist type label (e.g. "Girl Group") */
  artistTypeLabel?: string;
  /** Generation label (e.g. "Gen IV") */
  generationLabel?: string;
  /** Logo image URL (artist SVG) */
  logoUrl?: string;
}

export class Tooltip {
  private element: HTMLDivElement | null = null;
  private container: HTMLElement;
  private visible = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  show(data: TooltipData, x: number, y: number): void {
    if (!this.element) this.createElement();

    const initials = data.artistName.slice(0, 2).toUpperCase();

    let html = "";

    // Date row (+ source logo + event badge)
    if (data.date) {
      html += `<div class="tooltip-date-row">${data.date}`;
      if (data.sourceLogoUrl && data.sourceLabel) {
        html += ` <span style="display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;background:#fff;border-radius:3px;"><img src="${data.sourceLogoUrl}" alt="${data.sourceLabel}" style="width:14px;height:14px;object-fit:contain;"></span>${data.sourceLabel}</span>`;
      }
      if (data.eventLabel) {
        html += ` · <span class="tooltip-event-badge">${data.eventLabel}</span>`;
      }
      html += `</div>`;
    }

    // Logo + artist info side by side
    const logoContent = data.logoUrl
      ? `<img src="${data.logoUrl}" alt="${data.artistName}">`
      : `<span class="tooltip-logo-initials">${initials}</span>`;

    html += `
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
        <div class="tooltip-logo">
          ${logoContent}
        </div>
        <div>
          <div class="tooltip-artist-name">${data.artistName}</div>`;
    if (data.artistTypeLabel || data.generationLabel) {
      const meta = [data.artistTypeLabel, data.generationLabel].filter(Boolean).join(" · ");
      html += `<div class="tooltip-meta">${meta}</div>`;
    }
    html += `
        </div>
      </div>
    `;

    // Song title
    if (data.songTitle) {
      html += `<div class="tooltip-song">${data.songTitle}</div>`;
    }

    // Stats (points + daily gain)
    if (data.value !== undefined && data.value > 0) {
      if (data.dailyGain && data.dailyGain > 0) {
        html += `<div class="tooltip-stats">${data.value.toLocaleString()} <span style="font-size: 0.6rem; color: rgba(255,255,255,0.5);">+ ${data.dailyGain.toLocaleString()}</span></div>`;
      } else {
        html += `<div class="tooltip-stats">${data.value.toLocaleString()} pts</div>`;
      }
    }

    // Embed placeholders (when hovering event dots)
    if (data.showEmbed) {
      if (data.hasVideo) {
        html += `<div class="tooltip-embed tooltip-embed--video">\u25B6</div>`;
      }
      if (data.hasRelease) {
        html += `<div class="tooltip-embed tooltip-embed--apple"><div style="text-align:center;padding:12px;font-size:0.65rem;color:#999;">\uD83C\uDFB5 Apple Music<br>Album embed here<br>(scrollable)</div></div>`;
      }
      html += `<div class="tooltip-click-hint">click to engage</div>`;
    }

    this.element!.innerHTML = html;
    this.element!.style.background = data.color;
    this.element!.style.borderColor = data.color;
    this.element!.style.display = "block";
    this.visible = true;

    this.positionElement(x, y);
  }

  /** Show a "N lines here — click to choose" hint */
  showClusterHint(count: number, x: number, y: number): void {
    if (!this.element) this.createElement();

    this.element!.innerHTML = `<div style="font-size: 0.75rem; color: #fff;">${count} lines here \u2014 click to choose</div>`;
    this.element!.style.background = "rgba(50, 50, 50, 0.9)";
    this.element!.style.borderColor = "rgba(50, 50, 50, 0.9)";
    this.element!.style.display = "block";
    this.visible = true;

    this.positionElement(x, y);
  }

  /** Simple text-only show (fallback for basic hover) */
  showSimple(label: string, color: string, x: number, y: number): void {
    if (!this.element) this.createElement();

    this.element!.innerHTML = `<div class="tooltip-artist-name">${label}</div>`;
    this.element!.style.background = color;
    this.element!.style.borderColor = color;
    this.element!.style.display = "block";
    this.visible = true;

    this.positionElement(x, y);
  }

  hide(): void {
    if (!this.element || !this.visible) return;
    this.element.style.display = "none";
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Get current position (for popover to reuse) */
  getPosition(): { left: string; top: string } {
    if (!this.element) return { left: "0px", top: "0px" };
    return { left: this.element.style.left, top: this.element.style.top };
  }

  destroy(): void {
    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
    this.element = null;
  }

  private createElement(): void {
    this.element = document.createElement("div");
    this.element.className = "line-chart-tooltip";
    this.element.style.display = "none";
    this.element.setAttribute("role", "tooltip");
    this.container.appendChild(this.element);
  }

  private positionElement(x: number, y: number): void {
    // Position with edge detection (14px gap like prototype)
    const containerRect = this.container.getBoundingClientRect();
    const elRect = this.element!.getBoundingClientRect();
    const tw = elRect.width || 200;
    const th = elRect.height || 120;

    let left = x + 14;
    let top = y - 10;

    // Right edge
    if (left + tw > containerRect.width - 8) {
      left = x - tw - 14;
    }
    // Left edge
    if (left < 8) left = 8;
    // Bottom edge
    if (top + th > containerRect.height - 8) {
      top = containerRect.height - th - 8;
    }
    // Top edge
    if (top < 8) top = 8;

    this.element!.style.left = `${left}px`;
    this.element!.style.top = `${top}px`;
  }
}
