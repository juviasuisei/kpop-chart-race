/**
 * Popover — Interactive version of tooltip, shown on event dot click.
 * Same colored background as tooltip, same HTML structure, but with pointer-events enabled
 * and embed placeholders. Positioned at the same spot as the tooltip.
 * Matches the prototype's showPopover behavior exactly.
 */

import { generateFallbackLogoDataUri } from "../utils.ts";

export interface PopoverData {
  artistName: string;
  songTitle: string;
  color: string;
  value?: number;
  dailyGain?: number;
  date?: string;
  /** Source logo URL */
  sourceLogoUrl?: string;
  /** Source label */
  sourceLabel?: string;
  /** Event label string */
  eventLabel?: string;
  /** Artist type label */
  artistTypeLabel?: string;
  /** Generation label */
  generationLabel?: string;
  /** Logo URL */
  logoUrl?: string;
  /** Korean name for logo fallback */
  koreanName?: string;
  /** Whether event has video content */
  hasVideo?: boolean;
  /** Whether event has a release/album */
  hasRelease?: boolean;
}

export class Popover {
  private element: HTMLDivElement | null = null;
  private container: HTMLElement;
  private visible = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  show(data: PopoverData, position: { left: string; top: string }): void {
    if (!this.element) this.createElement();

    const initials = data.artistName.slice(0, 2).toUpperCase();

    let html = "";

    // Date row
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

    // Logo + artist info
    const fallbackSrc = generateFallbackLogoDataUri(data.koreanName ?? data.artistName);
    const logoContent = data.logoUrl
      ? `<img src="${data.logoUrl}" alt="${data.artistName}" onerror="this.onerror=null;this.src='${fallbackSrc.replace(/'/g, "\\'")}';">`
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

    // Song
    html += `<div class="tooltip-song">${data.songTitle}</div>`;

    // Stats
    if (data.value !== undefined && data.value > 0) {
      if (data.dailyGain && data.dailyGain > 0) {
        html += `<div class="tooltip-stats">${data.value.toLocaleString()} <span style="font-size: 0.6rem; color: rgba(255,255,255,0.5);">+ ${data.dailyGain.toLocaleString()}</span></div>`;
      } else {
        html += `<div class="tooltip-stats">${data.value.toLocaleString()} pts</div>`;
      }
    }

    // Embeds
    if (data.hasVideo) {
      html += `<div class="tooltip-embed tooltip-embed--video">\u25B6</div>`;
    }
    if (data.hasRelease) {
      html += `<div class="tooltip-embed tooltip-embed--apple"><div style="text-align:center;padding:12px;font-size:0.65rem;color:#999;">\uD83C\uDFB5 Apple Music<br>Album embed here<br>(scrollable)</div></div>`;
    }

    this.element!.innerHTML = html;
    this.element!.style.background = data.color;
    this.element!.style.borderColor = data.color;
    this.element!.style.display = "block";
    this.element!.style.left = position.left;
    this.element!.style.top = position.top;
    this.visible = true;
  }

  hide(): void {
    if (!this.element || !this.visible) return;
    this.element.style.display = "none";
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
    this.element = null;
  }

  private createElement(): void {
    this.element = document.createElement("div");
    this.element.className = "line-chart-popover";
    this.element.style.display = "none";
    this.container.appendChild(this.element);
  }
}
