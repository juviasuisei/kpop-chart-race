/**
 * TimeNavigation — Zoom preset buttons and scrubber for the line chart.
 *
 * Provides:
 *   - Zoom preset buttons: All / Decade / Year / Quarter / 90d
 *   - Integrates with the LineChartController's viewport management
 */

import type { TimeZoomPreset } from "../views/line-chart-controller.ts";

const PRESETS: { label: string; value: TimeZoomPreset }[] = [
  { label: "90d", value: "90d" },
  { label: "Year", value: "year" },
  { label: "Decade", value: "decade" },
  { label: "All", value: "all" },
];

export class TimeNavigation {
  private wrapper: HTMLDivElement | null = null;
  private buttons: HTMLButtonElement[] = [];
  private activePreset: TimeZoomPreset = "90d";

  /** Called when a preset is selected */
  onPresetSelect: ((preset: TimeZoomPreset) => void) | null = null;

  mount(container: HTMLElement): void {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "time-navigation";
    this.wrapper.setAttribute("role", "group");
    this.wrapper.setAttribute("aria-label", "Time zoom presets");

    for (const preset of PRESETS) {
      const btn = document.createElement("button");
      btn.className = "time-navigation__btn";
      btn.textContent = preset.label;
      btn.setAttribute("aria-pressed", preset.value === this.activePreset ? "true" : "false");
      btn.addEventListener("click", () => this.selectPreset(preset.value));
      this.buttons.push(btn);
      this.wrapper.appendChild(btn);
    }

    this.updateActiveButton();
    container.appendChild(this.wrapper);
  }

  setActivePreset(preset: TimeZoomPreset): void {
    this.activePreset = preset;
    this.updateActiveButton();
  }

  destroy(): void {
    if (this.wrapper && this.wrapper.parentElement) {
      this.wrapper.parentElement.removeChild(this.wrapper);
    }
    this.wrapper = null;
    this.buttons = [];
  }

  private selectPreset(preset: TimeZoomPreset): void {
    this.activePreset = preset;
    this.updateActiveButton();
    this.onPresetSelect?.(preset);
  }

  private updateActiveButton(): void {
    for (let i = 0; i < PRESETS.length; i++) {
      const isActive = PRESETS[i].value === this.activePreset;
      this.buttons[i]?.classList.toggle("time-navigation__btn--active", isActive);
      this.buttons[i]?.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
  }
}
