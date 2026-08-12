/**
 * Disambiguation — popup shown when multiple lines are within hit radius.
 * Displays a white list with color swatches so the user can pick which line to select.
 * Matches the prototype's showDisambiguation behavior exactly.
 */

export interface DisambiguationItem {
  lineId: string;
  label: string;
  color: string;
}

export class Disambiguation {
  private element: HTMLDivElement | null = null;
  private container: HTMLElement;
  private visible = false;

  /** Callback when user selects a line from the list */
  onSelect: ((lineId: string) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  show(x: number, y: number, items: DisambiguationItem[]): void {
    if (!this.element) this.createElement();

    this.element!.innerHTML = "";
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "line-chart-disambiguation__item";
      row.innerHTML = `<div class="color-swatch" style="background: ${item.color}"></div>${item.label}`;
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onSelect?.(item.lineId);
        this.hide();
      });
      this.element!.appendChild(row);
    }

    this.element!.style.display = "block";
    this.visible = true;

    // Position with edge detection
    const containerRect = this.container.getBoundingClientRect();
    let left = x;
    let top = y;

    // Wait a frame for the element to have dimensions
    requestAnimationFrame(() => {
      if (!this.element) return;
      const popupRect = this.element.getBoundingClientRect();
      if (left + popupRect.width > containerRect.width - 8) {
        left = containerRect.width - popupRect.width - 8;
      }
      if (left < 8) left = 8;
      if (top + popupRect.height > containerRect.height - 8) {
        top = containerRect.height - popupRect.height - 8;
      }
      if (top < 8) top = 8;
      this.element!.style.left = `${left}px`;
      this.element!.style.top = `${top}px`;
    });

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
    this.element.className = "line-chart-disambiguation";
    this.element.style.display = "none";
    this.container.appendChild(this.element);
  }
}
