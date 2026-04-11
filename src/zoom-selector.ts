/**
 * Zoom_Selector — toggle button for visible entry count (Top 10 / All).
 * Renders a single toggle button and emits `zoom:change` via EventBus.
 * Positioned to the left of the play button in the playback controls.
 */

import { EventBus } from "./event-bus.ts";
import type { ZoomLevel } from "./types.ts";

export class ZoomSelector {
  private eventBus: EventBus;
  private button: HTMLButtonElement | null = null;
  private currentLevel: ZoomLevel = 10;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /** Mount the zoom toggle into the given container */
  mount(container: HTMLElement): void {
    this.button = document.createElement("button");
    this.button.className = "zoom-toggle";
    this.button.setAttribute("aria-label", "Toggle zoom level");
    this.updateButtonLabel();
    this.button.addEventListener("click", this.handleClick);

    // Insert before the play button (first child of playback controls)
    const playbackControls = container.querySelector(".playback-controls");
    if (playbackControls && playbackControls.firstChild) {
      playbackControls.insertBefore(this.button, playbackControls.firstChild);
    } else {
      container.appendChild(this.button);
    }
  }

  /** Return the currently selected ZoomLevel */
  getLevel(): ZoomLevel {
    return this.currentLevel;
  }

  /** Remove DOM elements and clean up */
  destroy(): void {
    if (this.button) {
      this.button.removeEventListener("click", this.handleClick);
      this.button.remove();
      this.button = null;
    }
  }

  private handleClick = (): void => {
    this.currentLevel = this.currentLevel === 10 ? "all" : 10;
    this.updateButtonLabel();
    this.eventBus.emit("zoom:change", this.currentLevel);
  };

  private updateButtonLabel(): void {
    if (!this.button) return;
    if (this.currentLevel === 10) {
      this.button.textContent = "🔍 Zoom Out";
      this.button.setAttribute("aria-label", "Zoom out to show all artists");
    } else {
      this.button.textContent = "🔍 Zoom In";
      this.button.setAttribute("aria-label", "Zoom in to show top 10");
    }
  }
}
