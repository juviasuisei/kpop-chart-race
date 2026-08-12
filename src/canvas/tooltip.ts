/**
 * Tooltip — Rich floating tooltip shown on line hover.
 * Matches the prototype's style: colored background matching the line,
 * artist initials, date row, song name, cumulative points.
 */

export interface TooltipData {
  label: string;
  artistName: string;
  songTitle?: string;
  color: string;
  value?: number;
  dailyGain?: number;
  date?: string;
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

    // Date row
    if (data.date) {
      html += `<div class="tooltip-date-row">${data.date}</div>`;
    }

    // Logo + artist info
    html += `
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
        <div class="tooltip-logo">
          <span class="tooltip-logo-initials">${initials}</span>
        </div>
        <div>
          <div class="tooltip-artist-name">${data.artistName}</div>
        </div>
      </div>
    `;

    // Song title
    if (data.songTitle) {
      html += `<div class="tooltip-song">${data.songTitle}</div>`;
    }

    // Stats
    if (data.value !== undefined && data.value > 0) {
      if (data.dailyGain && data.dailyGain > 0) {
        html += `<div class="tooltip-stats">${data.value.toLocaleString()} <span style="font-size: 0.6rem; color: rgba(255,255,255,0.5);">+ ${data.dailyGain.toLocaleString()}</span></div>`;
      } else {
        html += `<div class="tooltip-stats">${data.value.toLocaleString()} pts</div>`;
      }
    }

    this.element!.innerHTML = html;
    this.element!.style.background = data.color;
    this.element!.style.borderColor = data.color;
    this.element!.style.display = "block";
    this.visible = true;

    // Position with edge detection (14px gap like prototype)
    const containerRect = this.container.getBoundingClientRect();
    const elRect = this.element!.getBoundingClientRect();
    const tw = elRect.width || 200;
    const th = elRect.height || 100;

    let left = x + 14;
    let top = y - 10;

    if (left + tw > containerRect.width - 8) left = x - tw - 14;
    if (left < 8) left = 8;
    if (top + th > containerRect.height - 8) top = containerRect.height - th - 8;
    if (top < 8) top = 8;

    this.element!.style.left = `${left}px`;
    this.element!.style.top = `${top}px`;
  }

  /** Simple text-only show (fallback for basic hover) */
  showSimple(label: string, color: string, x: number, y: number): void {
    if (!this.element) this.createElement();

    this.element!.innerHTML = `<div class="tooltip-artist-name">${label}</div>`;
    this.element!.style.background = color;
    this.element!.style.borderColor = color;
    this.element!.style.display = "block";
    this.visible = true;

    const containerRect = this.container.getBoundingClientRect();
    let left = x + 14;
    let top = y - 10;
    if (left + 200 > containerRect.width - 8) left = x - 200 - 14;
    if (left < 8) left = 8;
    if (top < 8) top = 8;

    this.element!.style.left = `${left}px`;
    this.element!.style.top = `${top}px`;
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
    this.element.className = "line-chart-tooltip";
    this.element.style.display = "none";
    this.element.setAttribute("role", "tooltip");
    this.container.appendChild(this.element);
  }
}
