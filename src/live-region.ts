/**
 * LiveRegionAnnouncer — manages an ARIA live region for screen reader announcements.
 * Renders a visually hidden <div role="log" aria-live="polite"> and provides
 * an announce() method that returns a Promise resolving after an estimated read time.
 */
export class LiveRegionAnnouncer {
  private el: HTMLDivElement | null = null;

  /**
   * Create and append a visually hidden live region element to the container.
   */
  mount(container: HTMLElement): void {
    this.el = document.createElement("div");
    this.el.setAttribute("role", "log");
    this.el.setAttribute("aria-live", "polite");
    this.el.classList.add("live-region", "visually-hidden");
    container.appendChild(this.el);
  }

  /**
   * Set the live region's text content and return a Promise that resolves
   * after an estimated read time (50ms per word, minimum 500ms).
   */
  announce(message: string): Promise<void> {
    if (this.el) {
      this.el.textContent = message;
    }

    const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
    const delay = Math.max(500, wordCount * 50);

    return new Promise((resolve) => {
      setTimeout(resolve, delay);
    });
  }

  /**
   * Remove the live region element from the DOM.
   */
  destroy(): void {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }
}
