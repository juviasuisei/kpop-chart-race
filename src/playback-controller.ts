/**
 * Playback controller for the K-Pop Chart Race.
 * Manages play/pause, timeline scrubbing, and date advancement.
 */

import { EventBus } from "./event-bus.ts";
import { positionToDate } from "./utils.ts";

export class PlaybackController {
  private eventBus: EventBus;
  private dates: string[];
  private currentIndex = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private rafId: number | null = null;

  private wrapper: HTMLDivElement | null = null;
  private playBtn: HTMLButtonElement | null = null;
  private scrubber: HTMLInputElement | null = null;
  private dateLabel: HTMLSpanElement | null = null;

  constructor(eventBus: EventBus, dates: string[]) {
    this.eventBus = eventBus;
    this.dates = dates;
  }

  mount(container: HTMLElement): void {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "playback-controls";

    // Play/Pause button
    this.playBtn = document.createElement("button");
    this.playBtn.className = "playback-controls__play-btn";
    this.playBtn.setAttribute("aria-label", "Play");
    this.playBtn.textContent = "▶";
    this.playBtn.addEventListener("click", this.handlePlayPauseClick);

    // Timeline scrubber
    this.scrubber = document.createElement("input");
    this.scrubber.type = "range";
    this.scrubber.className = "playback-controls__scrubber";
    this.scrubber.min = "0";
    this.scrubber.max = String(this.dates.length - 1);
    this.scrubber.value = "0";
    this.scrubber.setAttribute("aria-label", "Timeline scrubber");
    this.scrubber.setAttribute("aria-valuenow", this.dates[0] ?? "");
    this.scrubber.addEventListener("input", this.handleScrubberInput);

    // Date label
    this.dateLabel = document.createElement("span");
    this.dateLabel.className = "playback-controls__date-label";
    this.dateLabel.textContent = this.dates[0] ?? "";

    this.wrapper.appendChild(this.playBtn);
    this.wrapper.appendChild(this.scrubber);
    this.wrapper.appendChild(this.dateLabel);
    container.appendChild(this.wrapper);
  }

  play(): void {
    if (this.intervalId !== null) return;

    this.updateButtonToPause();
    this.eventBus.emit("play");

    this.intervalId = setInterval(() => {
      if (this.currentIndex >= this.dates.length - 1) {
        this.pause();
        return;
      }

      this.currentIndex++;
      this.updateScrubberAndLabel();
      this.eventBus.emit("date:change", this.dates[this.currentIndex]);
    }, 1000);
  }

  pause(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.updateButtonToPlay();
    this.eventBus.emit("pause");
  }

  seekTo(date: string): void {
    const index = this.dates.indexOf(date);
    if (index === -1) return;

    this.currentIndex = index;
    this.updateScrubberAndLabel();
    this.eventBus.emit("date:change", this.dates[this.currentIndex]);
  }

  isPlaying(): boolean {
    return this.intervalId !== null;
  }

  destroy(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.playBtn) {
      this.playBtn.removeEventListener("click", this.handlePlayPauseClick);
    }

    if (this.scrubber) {
      this.scrubber.removeEventListener("input", this.handleScrubberInput);
    }

    if (this.wrapper && this.wrapper.parentElement) {
      this.wrapper.parentElement.removeChild(this.wrapper);
    }

    this.wrapper = null;
    this.playBtn = null;
    this.scrubber = null;
    this.dateLabel = null;
  }

  private handlePlayPauseClick = (): void => {
    if (this.isPlaying()) {
      this.pause();
    } else {
      this.play();
    }
  };

  private handleScrubberInput = (): void => {
    if (this.rafId !== null) return;

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (!this.scrubber) return;

      const position = parseInt(this.scrubber.value, 10);
      const date = positionToDate(position, this.dates);
      this.currentIndex = position;
      this.updateDateLabel(date);
      this.scrubber.setAttribute("aria-valuenow", date);
      this.eventBus.emit("date:change", date);
    });
  };

  private updateScrubberAndLabel(): void {
    if (!this.scrubber || !this.dateLabel) return;

    const date = this.dates[this.currentIndex];
    this.scrubber.value = String(this.currentIndex);
    this.scrubber.setAttribute("aria-valuenow", date);
    this.dateLabel.textContent = date;
  }

  private updateDateLabel(date: string): void {
    if (this.dateLabel) {
      this.dateLabel.textContent = date;
    }
  }

  private updateButtonToPause(): void {
    if (!this.playBtn) return;
    this.playBtn.textContent = "⏸";
    this.playBtn.setAttribute("aria-label", "Pause");
  }

  private updateButtonToPlay(): void {
    if (!this.playBtn) return;
    this.playBtn.textContent = "▶";
    this.playBtn.setAttribute("aria-label", "Play");
  }
}
