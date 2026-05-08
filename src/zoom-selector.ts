/**
 * Zoom_Selector — sliding toggle for visible entry count (Top 10 / All).
 * Renders a pill-style toggle that slides between two states.
 * Positioned to the left of the play button in the playback controls.
 */

import { EventBus } from "./event-bus.ts";
import type { ZoomLevel } from "./types.ts";

export class ZoomSelector {
  private eventBus: EventBus;
  private wrapper: HTMLDivElement | null = null;
  private currentLevel: ZoomLevel = 10;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /** Mount the zoom toggle into the given container */
  mount(container: HTMLElement): void {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "zoom-toggle";
    this.wrapper.setAttribute("role", "switch");
    this.wrapper.setAttribute("aria-checked", "true");
    this.wrapper.setAttribute("aria-label", "Toggle between 10 and All artists");
    this.wrapper.tabIndex = 0;

    const labelLeft = document.createElement("span");
    labelLeft.className = "zoom-toggle__label";
    labelLeft.textContent = "All";

    const track = document.createElement("span");
    track.className = "zoom-toggle__track zoom-toggle__track--on";

    const thumb = document.createElement("span");
    thumb.className = "zoom-toggle__thumb";
    track.appendChild(thumb);

    const labelRight = document.createElement("span");
    labelRight.className = "zoom-toggle__label zoom-toggle__label--active";
    labelRight.textContent = "10";

    this.wrapper.appendChild(labelLeft);
    this.wrapper.appendChild(track);
    this.wrapper.appendChild(labelRight);

    this.wrapper.addEventListener("click", this.handleClick);
    this.wrapper.addEventListener("keydown", this.handleKeydown);

    // Listen for external zoom changes to stay in sync
    this.eventBus.on("zoom:change", this.handleExternalChange);

    // Insert before the play button (first child of playback controls)
    const playbackControls = container.querySelector(".playback-controls");
    if (playbackControls && playbackControls.firstChild) {
      playbackControls.insertBefore(this.wrapper, playbackControls.firstChild);
    } else {
      container.appendChild(this.wrapper);
    }
  }

  /** Return the currently selected ZoomLevel */
  getLevel(): ZoomLevel {
    return this.currentLevel;
  }

  /** Remove DOM elements and clean up */
  destroy(): void {
    if (this.wrapper) {
      this.wrapper.removeEventListener("click", this.handleClick);
      this.wrapper.removeEventListener("keydown", this.handleKeydown);
      this.wrapper.remove();
      this.wrapper = null;
    }
    this.eventBus.off("zoom:change", this.handleExternalChange);
  }

  private handleClick = (): void => {
    this.toggle();
  };

  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      this.toggle();
    }
  };

  private handleExternalChange = (level: ZoomLevel): void => {
    if (level !== this.currentLevel) {
      this.currentLevel = level;
      this.updateVisual();
    }
  };

  private toggle(): void {
    this.currentLevel = this.currentLevel === 10 ? "all" : 10;
    this.updateVisual();
    this.eventBus.emit("zoom:change", this.currentLevel);
  }

  private updateVisual(): void {
    if (!this.wrapper) return;
    const isTen = this.currentLevel === 10;
    this.wrapper.setAttribute("aria-checked", String(isTen));

    const labels = this.wrapper.querySelectorAll(".zoom-toggle__label");
    if (labels.length === 2) {
      labels[0].classList.toggle("zoom-toggle__label--active", !isTen); // "All" label
      labels[1].classList.toggle("zoom-toggle__label--active", isTen);  // "10" label
    }

    const track = this.wrapper.querySelector(".zoom-toggle__track");
    if (track) {
      track.classList.toggle("zoom-toggle__track--on", isTen);
    }
  }
}
