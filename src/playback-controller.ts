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
  private scrubberTooltip: HTMLDivElement | null = null;
  private startDateLabel: HTMLSpanElement | null = null;
  private endDateLabel: HTMLSpanElement | null = null;
  private updateCompleteHandler: (() => void) | null = null;
  private playing = false;

  constructor(eventBus: EventBus, dates: string[]) {
    this.eventBus = eventBus;
    this.dates = dates;
  }

  mount(container: HTMLElement): void {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "playback-controls";

    // Start at the last date so the user sees current rankings on load
    this.currentIndex = this.dates.length - 1;
    const initialDate = this.dates[this.currentIndex] ?? "";

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
    this.scrubber.value = String(this.currentIndex);
    this.scrubber.setAttribute("aria-label", "Timeline scrubber");
    this.scrubber.setAttribute("aria-valuenow", initialDate);
    this.scrubber.addEventListener("input", this.handleScrubberInput);
    this.scrubber.addEventListener("mousedown", this.handleScrubStart);
    this.scrubber.addEventListener("touchstart", this.handleScrubStart);
    this.scrubber.addEventListener("change", this.handleScrubEnd);

    // Scrubber tooltip (shows date on hover/drag)
    this.scrubberTooltip = document.createElement("div");
    this.scrubberTooltip.className = "playback-controls__scrubber-tooltip";
    this.scrubberTooltip.textContent = initialDate;

    // Scrubber container (for tooltip positioning)
    const scrubberContainer = document.createElement("div");
    scrubberContainer.className = "playback-controls__scrubber-container";
    scrubberContainer.appendChild(this.scrubber);
    scrubberContainer.appendChild(this.scrubberTooltip);
    this.scrubber.addEventListener("mousemove", this.handleScrubberHover);
    this.scrubber.addEventListener("mouseleave", this.handleScrubberLeave);

    // Date labels — first and last dates flanking the scrubber
    this.startDateLabel = document.createElement("span");
    this.startDateLabel.className = "playback-controls__date-label";
    this.startDateLabel.textContent = this.dates[0] ?? "";

    this.endDateLabel = document.createElement("span");
    this.endDateLabel.className = "playback-controls__date-label";
    this.endDateLabel.textContent = this.dates[this.dates.length - 1] ?? "";

    this.wrapper.appendChild(this.playBtn);
    this.wrapper.appendChild(this.startDateLabel);
    this.wrapper.appendChild(scrubberContainer);
    this.wrapper.appendChild(this.endDateLabel);
    container.appendChild(this.wrapper);
  }

  play(): void {
    if (this.intervalId !== null) return;

    // If at the last date, reset to the beginning before starting playback
    const isWrapping = this.currentIndex >= this.dates.length - 1;
    if (isWrapping) {
      this.currentIndex = 0;
      this.updateScrubberAndLabel();
      // Clear all bars so day 1 starts fresh with bars rising from bottom
      this.eventBus.emit("reset");
      this.eventBus.emit("date:change", this.dates[0]);
    }

    this.updateButtonToPause();
    this.playing = true;
    this.eventBus.emit("play");

    // Use event-driven advancement: wait for update:complete before advancing
    const advance = () => {
      if (this.currentIndex >= this.dates.length - 1) {
        this.pause();
        return;
      }

      this.currentIndex++;
      this.updateScrubberAndLabel();
      this.eventBus.emit("date:change", this.dates[this.currentIndex]);
    };

    // Listen for update:complete to schedule next advance
    const onComplete = () => {
      if (!this.playing) return; // paused
      this.intervalId = setTimeout(() => {
        advance();
      }, 50) as unknown as ReturnType<typeof setInterval>; // small gap between days
    };

    this.eventBus.on("update:complete", onComplete);
    this.updateCompleteHandler = onComplete;

    // Start the first advance — but if wrapping, day 1 is already emitted,
    // so wait for its update:complete to trigger the first advance naturally
    if (!isWrapping) {
      advance();
    }
  }

  pause(): void {
    this.playing = false;
    if (this.intervalId !== null) {
      clearTimeout(this.intervalId as unknown as number);
      this.intervalId = null;
    }

    if (this.updateCompleteHandler) {
      this.eventBus.off("update:complete", this.updateCompleteHandler);
      this.updateCompleteHandler = null;
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
    return this.playing;
  }

  destroy(): void {
    if (this.intervalId !== null) {
      clearTimeout(this.intervalId as unknown as number);
      this.intervalId = null;
    }

    if (this.updateCompleteHandler) {
      this.eventBus.off("update:complete", this.updateCompleteHandler);
      this.updateCompleteHandler = null;
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
      this.scrubber.removeEventListener("mousedown", this.handleScrubStart);
      this.scrubber.removeEventListener("touchstart", this.handleScrubStart);
      this.scrubber.removeEventListener("change", this.handleScrubEnd);
      this.scrubber.removeEventListener("mousemove", this.handleScrubberHover);
      this.scrubber.removeEventListener("mouseleave", this.handleScrubberLeave);
    }

    if (this.wrapper && this.wrapper.parentElement) {
      this.wrapper.parentElement.removeChild(this.wrapper);
    }

    this.wrapper = null;
    this.playBtn = null;
    this.scrubber = null;
    this.scrubberTooltip = null;
    this.startDateLabel = null;
    this.endDateLabel = null;
  }

  private handlePlayPauseClick = (): void => {
    if (this.isPlaying()) {
      this.pause();
    } else {
      this.play();
    }
  };

  private isScrubbing = false;

  private handleScrubberInput = (): void => {
    if (this.rafId !== null) return;

    // Emit scrub:start on first input if not already scrubbing
    if (!this.isScrubbing) {
      this.isScrubbing = true;
      if (this.isPlaying()) {
        this.pause();
      }
      this.eventBus.emit("scrub:start");
    }

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (!this.scrubber) return;

      const position = parseInt(this.scrubber.value, 10);
      const date = positionToDate(position, this.dates);
      this.currentIndex = position;
      this.scrubber.setAttribute("aria-valuenow", date);
      // Update tooltip during drag
      if (this.scrubberTooltip) {
        this.scrubberTooltip.textContent = date;
        const fraction = position / Math.max(1, this.dates.length - 1);
        this.scrubberTooltip.style.left = `${fraction * 100}%`;
        this.scrubberTooltip.style.opacity = "1";
      }
      this.eventBus.emit("date:change", date);

      // If the user released the scrubber, end scrub mode after this update
      if (this.scrubEndPending) {
        this.scrubEndPending = false;
        this.isScrubbing = false;
        this.eventBus.emit("scrub:end");
      }
    });
  };

  private handleScrubStart = (): void => {
    // Also handle mousedown/touchstart as backup
    if (!this.isScrubbing) {
      this.isScrubbing = true;
      if (this.isPlaying()) {
        this.pause();
      }
      this.eventBus.emit("scrub:start");
    }
  };

  private handleScrubEnd = (): void => {
    // Don't emit scrub:end here — the rAF-deferred update may not have run yet.
    // Mark pending and let the next input handler emit it, or use a fallback timeout.
    this.scrubEndPending = true;
    setTimeout(() => {
      if (this.scrubEndPending) {
        this.scrubEndPending = false;
        this.isScrubbing = false;
        this.eventBus.emit("scrub:end");
      }
    }, 100);
  };

  private scrubEndPending = false;

  private handleScrubberHover = (e: MouseEvent): void => {
    if (!this.scrubber || !this.scrubberTooltip) return;
    const rect = this.scrubber.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const index = Math.round(fraction * (this.dates.length - 1));
    const date = this.dates[index] ?? "";
    this.scrubberTooltip.textContent = date;
    this.scrubberTooltip.style.left = `${fraction * 100}%`;
    this.scrubberTooltip.style.opacity = "1";
  };

  private handleScrubberLeave = (): void => {
    if (!this.scrubberTooltip) return;
    this.scrubberTooltip.style.opacity = "0";
  };

  private updateScrubberAndLabel(): void {
    if (!this.scrubber) return;

    const date = this.dates[this.currentIndex];
    this.scrubber.value = String(this.currentIndex);
    this.scrubber.setAttribute("aria-valuenow", date);
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
