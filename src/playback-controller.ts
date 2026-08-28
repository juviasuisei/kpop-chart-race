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
  private progressHandler: ((position: number) => void) | null = null;
  private pauseHandler: (() => void) | null = null;
  private trailingSlot: HTMLElement | null = null;
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
    // Allow fractional thumb positions so playback glides smoothly rather than
    // snapping to whole dates. User drags still resolve to an integer index in
    // handleScrubberInput.
    this.scrubber.step = "any";
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
    this.startDateLabel.style.cursor = "pointer";
    this.startDateLabel.addEventListener("click", () => {
      if (this.isPlaying()) this.pause();
      this.eventBus.emit("scrub:start");
      this.seekTo(this.dates[0]);
      this.eventBus.emit("scrub:end");
    });

    this.endDateLabel = document.createElement("span");
    this.endDateLabel.className = "playback-controls__date-label";
    this.endDateLabel.textContent = this.dates[this.dates.length - 1] ?? "";
    this.endDateLabel.style.cursor = "pointer";
    this.endDateLabel.addEventListener("click", () => {
      if (this.isPlaying()) this.pause();
      this.eventBus.emit("scrub:start");
      this.seekTo(this.dates[this.dates.length - 1]);
      this.eventBus.emit("scrub:end");
    });

    this.wrapper.appendChild(this.playBtn);
    this.wrapper.appendChild(this.startDateLabel);
    this.wrapper.appendChild(scrubberContainer);
    this.wrapper.appendChild(this.endDateLabel);
    // Trailing slot: view-specific control (e.g. the value-axis detail zoom)
    // sits to the right of the end-date label. Populated via setTrailingControl.
    this.trailingSlot = document.createElement("div");
    this.trailingSlot.className = "playback-controls__trailing";
    this.wrapper.appendChild(this.trailingSlot);
    container.appendChild(this.wrapper);

    // Glide the scrubber thumb with the animation's fractional position. We
    // only move the visual thumb here; currentIndex (the integer date used for
    // labels and data) is still driven by date:change / syncTo. Ignore while
    // the user is dragging so we don't fight their input.
    this.progressHandler = (position: number) => {
      if (!this.scrubber || this.isScrubbing) return;
      this.scrubber.value = String(position);
    };
    this.eventBus.on("playback:progress", this.progressHandler);

    // The animation can end on its own (reaching the last date), which emits
    // "pause" without going through our pause(). Reset our button + playing
    // flag so the UI reflects the stopped state. Guard against re-entry since
    // our own pause() also emits "pause".
    this.pauseHandler = () => {
      if (!this.playing) return;
      this.playing = false;
      this.updateButtonToPlay();
    };
    this.eventBus.on("pause", this.pauseHandler);
  }

  /**
   * Place a view-specific control in the scrubber row, to the right of the
   * end-date label (e.g. the race view's value-axis detail zoom). Replaces any
   * previously set trailing control.
   */
  setTrailingControl(el: HTMLElement | null): void {
    if (!this.trailingSlot) return;
    this.trailingSlot.innerHTML = "";
    if (el) this.trailingSlot.appendChild(el);
  }

  play(): void {
    if (this.playing) return;

    // If at the last date, reset to the beginning before starting playback
    const isWrapping = this.currentIndex >= this.dates.length - 1;
    if (isWrapping) {
      this.currentIndex = 0;
      this.updateScrubberAndLabel();
    }

    this.updateButtonToPause();
    this.playing = true;
    this.eventBus.emit("play");

    if (isWrapping) {
      this.eventBus.emit("reset");
    }

    // LineChartController now owns the animation loop entirely.
    // This controller only manages the UI (button state, scrubber position).
    // Listen for date:change to keep scrubber in sync with the animation.
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

  /** Update scrubber position without emitting date:change (for animation sync) */
  syncTo(date: string): void {
    const index = this.dates.indexOf(date);
    if (index === -1) return;
    this.currentIndex = index;
    // While playing, the smooth playback:progress handler owns the thumb
    // position, so only refresh the aria/label here — otherwise the thumb would
    // snap back to the integer index each time the date ticks over, undoing the
    // smoothing. When paused (e.g. keyboard step), move the thumb as usual.
    this.updateScrubberAndLabel({ moveThumb: !this.playing });
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

    if (this.progressHandler) {
      this.eventBus.off("playback:progress", this.progressHandler);
      this.progressHandler = null;
    }

    if (this.pauseHandler) {
      this.eventBus.off("pause", this.pauseHandler);
      this.pauseHandler = null;
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

  private updateScrubberAndLabel(opts: { moveThumb?: boolean } = {}): void {
    if (!this.scrubber) return;
    const { moveThumb = true } = opts;

    const date = this.dates[this.currentIndex] ?? "";
    if (moveThumb) {
      this.scrubber.value = String(this.currentIndex);
    }
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
