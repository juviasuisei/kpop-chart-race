/**
 * Legend — Renders the chart legend below the canvas container.
 * Shows artist type color swatches and event dot type indicators.
 * Matches the prototype's renderLegend function exactly.
 */

export class Legend {
  private element: HTMLDivElement | null = null;

  mount(afterElement: HTMLElement): void {
    if (this.element) return;

    this.element = document.createElement("div");
    this.element.className = "line-chart-legend";
    afterElement.insertAdjacentElement("afterend", this.element);
    this.render();
  }

  destroy(): void {
    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
    this.element = null;
  }

  private render(): void {
    if (!this.element) return;
    this.element.innerHTML = "";

    // Artist type line swatches
    const types: { color: string; label: string }[] = [
      { color: "#2E7D32", label: "Boy Group" },
      { color: "#7B1FA2", label: "Girl Group" },
      { color: "#81C784", label: "Solo Male" },
      { color: "#CE93D8", label: "Solo Female" },
      { color: "#1565C0", label: "Mixed Group" },
      { color: "#90CAF9", label: "Solo Non-Binary" },
    ];

    for (const t of types) {
      const item = document.createElement("div");
      item.className = "line-chart-legend__item";
      item.innerHTML = `<div class="line-chart-legend__swatch" style="background: ${t.color}"></div>${t.label}`;
      this.element.appendChild(item);
    }

    // Event dot type legend
    const dots: { icon: string; label: string }[] = [
      { icon: "\uD83D\uDC51", label: "Win" },
      { icon: "\uD83C\uDFA4", label: "Live Performance" },
      { icon: "\uD83D\uDCCA", label: "Chart Appearance" },
      { icon: "\u25C6", label: "MV Release" },
      { icon: "\u25CF", label: "Album Release" },
    ];

    for (const d of dots) {
      const item = document.createElement("div");
      item.className = "line-chart-legend__item";
      item.innerHTML = `<div class="line-chart-legend__dot">${d.icon}</div>${d.label}`;
      this.element.appendChild(item);
    }
  }
}
