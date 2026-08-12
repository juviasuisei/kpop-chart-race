/**
 * SearchOverlay — Autocomplete search to find and highlight specific songs/artists.
 *
 * Renders a search input with a dropdown of matching results. Selecting a result
 * highlights the corresponding line on the chart. Supports keyboard navigation.
 */

export interface SearchItem {
  lineId: string;
  label: string;
}

export class SearchOverlay {
  private container: HTMLElement;
  private wrapper: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private dropdown: HTMLDivElement | null = null;
  private items: SearchItem[] = [];
  private filteredItems: SearchItem[] = [];
  private selectedIndex = -1;
  private visible = false;

  /** Called when user selects a result */
  onSelect: ((lineId: string, multiSelect: boolean) => void) | null = null;
  /** Called when search is dismissed */
  onClose: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Set the searchable items (all lines).
   */
  setItems(items: SearchItem[]): void {
    this.items = items;
  }

  /**
   * Show the search overlay.
   */
  show(): void {
    if (!this.wrapper) this.createElement();
    this.visible = true;
    this.wrapper!.style.display = "flex";
    this.input!.value = "";
    this.filteredItems = [];
    this.selectedIndex = -1;
    this.updateDropdown();
    // Focus after a frame to ensure visibility
    requestAnimationFrame(() => this.input?.focus());
  }

  /**
   * Hide the search overlay.
   */
  hide(): void {
    if (!this.wrapper) return;
    this.visible = false;
    this.wrapper.style.display = "none";
    this.input!.value = "";
    this.filteredItems = [];
    this.updateDropdown();
  }

  /**
   * Toggle visibility.
   */
  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    if (this.wrapper && this.wrapper.parentElement) {
      this.wrapper.parentElement.removeChild(this.wrapper);
    }
    this.wrapper = null;
    this.input = null;
    this.dropdown = null;
  }

  // --- Private ---

  private createElement(): void {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "line-chart-search";
    this.wrapper.style.display = "none";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "line-chart-search__input";
    this.input.placeholder = "Search songs or artists...";
    this.input.setAttribute("aria-label", "Search songs or artists");
    this.input.setAttribute("autocomplete", "off");
    this.input.addEventListener("input", this.handleInput);
    this.input.addEventListener("keydown", this.handleKeydown);

    this.dropdown = document.createElement("div");
    this.dropdown.className = "line-chart-search__dropdown";
    this.dropdown.setAttribute("role", "listbox");

    this.wrapper.appendChild(this.input);
    this.wrapper.appendChild(this.dropdown);
    this.container.appendChild(this.wrapper);
  }

  private handleInput = (): void => {
    const query = this.input!.value.trim().toLowerCase();

    if (query.length < 2) {
      this.filteredItems = [];
    } else {
      this.filteredItems = this.items
        .filter(item => item.label.toLowerCase().includes(query))
        .slice(0, 20); // Cap at 20 results
    }

    this.selectedIndex = this.filteredItems.length > 0 ? 0 : -1;
    this.updateDropdown();
  };

  private handleKeydown = (e: KeyboardEvent): void => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (this.filteredItems.length > 0) {
          this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredItems.length - 1);
          this.updateDropdown();
        }
        break;

      case "ArrowUp":
        e.preventDefault();
        if (this.filteredItems.length > 0) {
          this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
          this.updateDropdown();
        }
        break;

      case "Enter":
        e.preventDefault();
        if (this.selectedIndex >= 0 && this.selectedIndex < this.filteredItems.length) {
          const item = this.filteredItems[this.selectedIndex];
          const multiSelect = e.shiftKey || e.ctrlKey || e.metaKey;
          this.onSelect?.(item.lineId, multiSelect);
          if (!multiSelect) this.hide();
        }
        break;

      case "Escape":
        e.preventDefault();
        this.hide();
        this.onClose?.();
        break;
    }
  };

  private updateDropdown(): void {
    if (!this.dropdown) return;
    this.dropdown.innerHTML = "";

    if (this.filteredItems.length === 0) {
      if (this.input!.value.trim().length >= 2) {
        const empty = document.createElement("div");
        empty.className = "line-chart-search__empty";
        empty.textContent = "No results found";
        this.dropdown.appendChild(empty);
      }
      return;
    }

    for (let i = 0; i < this.filteredItems.length; i++) {
      const item = this.filteredItems[i];
      const el = document.createElement("div");
      el.className = "line-chart-search__item";
      el.setAttribute("role", "option");
      el.textContent = item.label;

      if (i === this.selectedIndex) {
        el.classList.add("line-chart-search__item--active");
        el.setAttribute("aria-selected", "true");
      }

      el.addEventListener("click", () => {
        this.onSelect?.(item.lineId, false);
        this.hide();
      });

      this.dropdown.appendChild(el);
    }
  }
}
