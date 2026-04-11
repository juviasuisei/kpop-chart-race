/**
 * Zoom_Selector — toggle control for visible entry count (Top 10 / All).
 * Renders a fieldset with radio buttons and emits `zoom:change` via EventBus.
 */

import { EventBus } from "./event-bus.ts";
import type { ZoomLevel } from "./types.ts";

export class ZoomSelector {
  private eventBus: EventBus;
  private fieldset: HTMLFieldSetElement | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /** Mount the zoom selector into the given container */
  mount(container: HTMLElement): void {
    this.fieldset = document.createElement("fieldset");
    this.fieldset.className = "zoom-selector";

    const legend = document.createElement("legend");
    legend.textContent = "Zoom Level";
    legend.className = "visually-hidden";
    this.fieldset.appendChild(legend);

    const options: { label: string; value: string }[] = [
      { label: "Top 10", value: "10" },
      { label: "All", value: "all" },
    ];

    for (const opt of options) {
      const label = document.createElement("label");
      label.className = "zoom-selector__option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "zoom-level";
      radio.value = opt.value;
      if (opt.value === "10") {
        radio.checked = true;
      }

      label.appendChild(radio);
      label.appendChild(document.createTextNode(` ${opt.label}`));
      this.fieldset.appendChild(label);
    }

    this.fieldset.addEventListener("change", this.handleChange);
    container.appendChild(this.fieldset);
  }

  /** Return the currently selected ZoomLevel */
  getLevel(): ZoomLevel {
    if (!this.fieldset) return 10;
    const checked = this.fieldset.querySelector<HTMLInputElement>(
      'input[name="zoom-level"]:checked'
    );
    if (!checked) return 10;
    return checked.value === "all" ? "all" : 10;
  }

  /** Remove DOM elements and clean up */
  destroy(): void {
    if (this.fieldset) {
      this.fieldset.removeEventListener("change", this.handleChange);
      this.fieldset.remove();
      this.fieldset = null;
    }
  }

  private handleChange = (): void => {
    this.eventBus.emit("zoom:change", this.getLevel());
  };
}
