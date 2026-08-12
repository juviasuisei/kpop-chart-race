/**
 * TimeNavigation — Zoom preset buttons for the line chart.
 * Only shows presets that have enough data (e.g., no "Year" if < 365 days).
 * Centered below the scrubber with a "Zoom Level:" label.
 */

import type { TimeZoomPreset } from "../views/line-chart-controller.ts";

const PRESETS: { label: string; value: TimeZoomPreset; minDays: number }[] = [
  { label: "Year", value: "year", minDays: 270 },
  { label: "Decade", value: "decade", minDays: 2555 },  // ~7 years
  { label: "All", value: "all", minDays: 3650 },        // ~10 years
];

export class TimeNavigation {
  private wrapper: HTMLDivElement | null = null;
  private buttons: HTMLButtonElement[] = [];
  private activePreset: TimeZoomPreset = "daily";
  private totalDays = 0;

  /** Called when a preset is selected */
  onPresetSelect: ((preset: TimeZoomPreset) => void) | null = null;

  /** Set the total number of days in the dataset (controls which presets are visible) */
  setTotalDays(days: number): void {
    this.totalDays = days;
    this.rebuild();
  }

  mount(container: HTMLElement): void {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "time-navigation";
    this.wrapper.setAttribute("role", "group");
    this.wrapper.setAttribute("aria-label", "Zoom level");

    this.rebuild();
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

  private rebuild(): void {
    if (!this.wrapper) return;
    this.wrapper.innerHTML = "";
    this.buttons = [];

    // Determine which presets to show based on data length
    const availablePresets = PRESETS.filter(p => this.totalDays >= p.minDays);

    // Don't show if only "All" is available (not enough data for any zoom)
    if (availablePresets.length <= 1) {
      this.wrapper.style.display = "none";
      return;
    }
    this.wrapper.style.display = "";

    // Label
    const label = document.createElement("span");
    label.className = "time-navigation__label";
    label.textContent = "Zoom Level:";
    this.wrapper.appendChild(label);

    // Buttons
    for (const preset of availablePresets) {
      const btn = document.createElement("button");
      btn.className = "time-navigation__btn";
      btn.textContent = preset.label;
      btn.setAttribute("aria-pressed", preset.value === this.activePreset ? "true" : "false");
      btn.addEventListener("click", () => this.selectPreset(preset.value));
      this.buttons.push(btn);
      this.wrapper.appendChild(btn);
    }

    this.updateActiveButton();
  }

  private selectPreset(preset: TimeZoomPreset): void {
    this.activePreset = preset;
    this.updateActiveButton();
    this.onPresetSelect?.(preset);
  }

  private updateActiveButton(): void {
    const availablePresets = PRESETS.filter(p => this.totalDays >= p.minDays);
    for (let i = 0; i < availablePresets.length; i++) {
      const isActive = availablePresets[i].value === this.activePreset;
      this.buttons[i]?.classList.toggle("time-navigation__btn--active", isActive);
      this.buttons[i]?.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
  }
}
