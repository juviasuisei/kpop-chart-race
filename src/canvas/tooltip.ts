/**
 * Tooltip — Lightweight floating label shown on line hover.
 * Shows the song/artist name and current cumulative value.
 */

export class Tooltip {
  private element: HTMLDivElement | null = null;
  private container: HTMLElement;
  private visible = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  show(label: string, x: number, y: number): void {
    if (!this.element) this.createElement();

    this.element!.textContent = label;
    this.element!.style.display = "block";
    this.visible = true;

    // Position above the cursor with a small offset
    const offset = 12;
    let left = x + offset;
    let top = y - 30;

    // Avoid overflow
    const rect = this.container.getBoundingClientRect();
    const elWidth = this.element!.offsetWidth || 150;
    if (left + elWidth > rect.width) {
      left = x - elWidth - offset;
    }
    if (top < 0) {
      top = y + offset;
    }

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
    this.element.style.position = "absolute";
    this.element.style.pointerEvents = "none";
    this.element.style.zIndex = "900";
    this.element.setAttribute("role", "tooltip");
    this.container.appendChild(this.element);
  }
}
