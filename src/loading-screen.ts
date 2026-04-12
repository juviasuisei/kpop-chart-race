/**
 * LoadingScreen — pure UI component for the data loading phase.
 * Receives method calls from the outside (no EventBus dependency).
 */

export class LoadingScreen {
  private root: HTMLElement | null = null;
  private progressText: HTMLElement | null = null;
  private progressBarFill: HTMLElement | null = null;
  private artistCredits: HTMLElement | null = null;
  private errorArea: HTMLElement | null = null;
  private progressBarContainer: HTMLElement | null = null;

  /** Create and append the loading screen UI to the container. */
  mount(container: HTMLElement): void {
    const wrapper = document.createElement("div");
    wrapper.className = "loading-screen";

    const title = document.createElement("h1");
    title.className = "loading-screen__title";
    title.textContent = "K-Pop Chart Race";
    wrapper.appendChild(title);

    this.progressText = document.createElement("p");
    this.progressText.className = "loading-screen__progress-text";
    this.progressText.textContent = "Loading artists...";
    wrapper.appendChild(this.progressText);

    this.progressBarContainer = document.createElement("div");
    this.progressBarContainer.className = "progress-bar";

    this.progressBarFill = document.createElement("div");
    this.progressBarFill.className = "progress-bar-fill";
    this.progressBarFill.style.width = "0%";
    this.progressBarContainer.appendChild(this.progressBarFill);
    wrapper.appendChild(this.progressBarContainer);

    this.artistCredits = document.createElement("div");
    this.artistCredits.className = "artist-credits";
    wrapper.appendChild(this.artistCredits);

    this.errorArea = document.createElement("div");
    this.errorArea.className = "loading-screen__error";
    this.errorArea.style.display = "none";
    wrapper.appendChild(this.errorArea);

    this.root = wrapper;
    container.appendChild(wrapper);
  }

  /** Update progress for a single artist being loaded. */
  onFileProgress(loaded: number, total: number, artistNames: string[]): void {
    if (this.progressText && artistNames.length > 0) {
      this.progressText.textContent = `Loading ${artistNames[artistNames.length - 1]}`;
    } else if (this.progressText) {
      this.progressText.textContent = `Loading artists...`;
    }

    if (this.progressBarFill && total > 0) {
      const pct = (loaded / total) * 100;
      this.progressBarFill.style.width = `${pct}%`;
    }
  }

  /** Trigger fade-out transition, then destroy. Returns a promise that resolves when removed. */
  onComplete(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.root) {
        resolve();
        return;
      }

      this.root.classList.add("loading-screen--complete");

      const onEnd = (): void => {
        this.root?.removeEventListener("transitionend", onEnd);
        this.destroy();
        resolve();
      };

      this.root.addEventListener("transitionend", onEnd);

      // Safety fallback in case transitionend never fires
      setTimeout(() => {
        if (this.root) {
          this.root.removeEventListener("transitionend", onEnd);
          this.destroy();
        }
        resolve();
      }, 500);
    });
  }

  /** Show error message, hide progress bar and credits. */
  onError(message: string): void {
    if (this.errorArea) {
      this.errorArea.textContent = message;
      this.errorArea.style.display = "";
    }
    if (this.progressBarContainer) {
      this.progressBarContainer.style.display = "none";
    }
    if (this.artistCredits) {
      this.artistCredits.style.display = "none";
    }
  }

  /** Remove the loading screen element from the DOM. */
  destroy(): void {
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
    this.progressText = null;
    this.progressBarFill = null;
    this.progressBarContainer = null;
    this.artistCredits = null;
    this.errorArea = null;
  }
}
