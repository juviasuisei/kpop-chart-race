/**
 * Toolbar component — persistent horizontal control strip.
 * Renders all filter/toggle controls and communicates with FilterStateManager via EventBus.
 * Implements mobile drawer behavior (< 768px) with chip summary and auto-dismiss.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.2
 */

import type { EventBus } from "./event-bus.ts";
import type { FilterStateManager } from "./filter-state-manager.ts";

/** Human-readable labels for chart sources */
const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All Sources" },
  { value: "inkigayo", label: "Inkigayo" },
  { value: "the_show", label: "The Show" },
  { value: "show_champion", label: "Show Champion" },
  { value: "music_bank", label: "Music Bank" },
  { value: "m_countdown", label: "M Countdown" },
  { value: "show_music_core", label: "Show! Music Core" },
];

export class Toolbar {
  private eventBus: EventBus;
  private filterState: FilterStateManager;
  private container: HTMLElement | null = null;
  private wrapper: HTMLElement | null = null;
  private isMobile = false;
  private drawerOpen = false;
  private outsideClickHandler: ((e: Event) => void) | null = null;

  // Control elements
  private generationSelect: HTMLSelectElement | null = null;
  private sourceSelect: HTMLSelectElement | null = null;

  // Artist filter state
  private artists: { id: string; name: string; generation: number }[] = [];
  private artistDropdownEl: HTMLElement | null = null;
  private artistListEl: HTMLElement | null = null;
  private artistSearchEl: HTMLInputElement | null = null;
  private artistTriggerEl: HTMLButtonElement | null = null;
  private allArtistsItemEl: HTMLElement | null = null;
  private artistDropdownOpen = false;
  private artistOutsideClickHandler: ((e: Event) => void) | null = null;
  private artistSelectedIndex = -1;

  constructor(eventBus: EventBus, filterState: FilterStateManager) {
    this.eventBus = eventBus;
    this.filterState = filterState;
  }

  mount(container: HTMLElement): void {
    this.container = container;
    this.isMobile = typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 767px)").matches
      : false;

    if (this.isMobile) {
      this.renderMobile();
    } else {
      this.renderDesktop();
    }

    this.syncControlsToState();
    this.eventBus.on("filter:change", () => this.syncControlsToState());
  }

  unmount(): void {
    if (this.wrapper && this.container) {
      this.container.removeChild(this.wrapper);
    }
    this.removeOutsideClickListener();
    this.removeArtistOutsideClickListener();
    this.wrapper = null;
    this.container = null;
    this.generationSelect = null;
    this.artistDropdownEl = null;
    this.artistListEl = null;
    this.artistSearchEl = null;
    this.artistTriggerEl = null;
  }

  /** Update available generations from data — sorted descending with "All" first */
  setGenerations(generations: number[]): void {
    if (!this.generationSelect) return;
    const sorted = [...generations].sort((a, b) => b - a);

    // Clear existing options
    this.generationSelect.innerHTML = "";

    // Add "All" option
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All Gens";
    this.generationSelect.appendChild(allOpt);

    // Add generation options
    for (const gen of sorted) {
      const opt = document.createElement("option");
      opt.value = String(gen);
      opt.textContent = `${gen}${getOrdinalSuffix(gen)} Gen`;
      this.generationSelect.appendChild(opt);
    }
  }

  /** Set the full list of artists available for filtering */
  setArtists(artists: { id: string; name: string; generation: number }[]): void {
    this.artists = artists;
    this.renderArtistList();
  }

  /** Show/hide yearly-only controls (Points/Wins metric toggle) */
  setViewMode(view: "race" | "episodes" | "yearly" | "line" | "artist-timeline"): void {
    if (!this.wrapper) return;
    const metricControl = this.wrapper.querySelector(
      '[data-control="metric"]',
    ) as HTMLElement | null;
    const zoomControl = this.wrapper.querySelector(
      '[data-control="zoom"]',
    ) as HTMLElement | null;
    const generationControl = this.wrapper.querySelector(
      '[data-control="generation"]',
    ) as HTMLElement | null;

    if (view === "yearly") {
      metricControl?.classList.remove("toolbar__control--hidden");
      zoomControl?.classList.remove("toolbar__control--hidden");
    } else {
      metricControl?.classList.add("toolbar__control--hidden");
      zoomControl?.classList.add("toolbar__control--hidden");
    }

    // Hide generation filter in artist-timeline view (single artist, gen is irrelevant)
    if (view === "artist-timeline") {
      generationControl?.classList.add("toolbar__control--hidden");
    } else {
      generationControl?.classList.remove("toolbar__control--hidden");
    }

    // Update segmented button active states
    const viewControl = this.wrapper.querySelector('[data-control="view"]');
    if (viewControl) {
      const buttons = viewControl.querySelectorAll(".toolbar__view-btn");
      // Map "line" to "race" button value
      const activeValue = view === "line" ? "race" : view === "artist-timeline" ? "artist-timeline" : view;
      buttons.forEach((btn) => {
        const btnEl = btn as HTMLElement;
        btnEl.classList.toggle(
          "toolbar__view-btn--active",
          btnEl.dataset.view === activeValue,
        );
      });
    }
  }

  /** Programmatically open the artist dropdown (used when switching to artist-timeline without a selection) */
  openArtistFilter(): void {
    this.openArtistDropdown();
  }

  /**
   * Sync all control visuals to the current filter state.
   * Called on mount and whenever filter:change fires.
   */
  private syncControlsToState(): void {
    if (!this.wrapper) return;
    const state = this.filterState.getState();

    // Generation select
    if (this.generationSelect) {
      this.generationSelect.value = String(state.generation);
    }

    // Source select
    if (this.sourceSelect) {
      this.sourceSelect.value = state.source;
    }

    // Metric segmented control (points/wins/appearances)
    const metricControl = this.wrapper.querySelector('[data-control="metric"]') as HTMLElement | null;
    if (metricControl) {
      const buttons = metricControl.querySelectorAll(".toolbar__metric-btn");
      buttons.forEach((btn) => {
        const btnEl = btn as HTMLElement;
        btnEl.classList.toggle(
          "toolbar__view-btn--active",
          btnEl.dataset.metric === state.metric,
        );
      });
    }

    // Zoom toggle (all/10)
    const zoomControl = this.wrapper.querySelector('[data-control="zoom"]') as HTMLElement | null;
    if (zoomControl) {
      const track = zoomControl.querySelector(".view-switcher__track");
      const labels = zoomControl.querySelectorAll(".view-switcher__label");
      const isTen = state.zoom === 10;
      track?.classList.toggle("view-switcher__track--on", isTen);
      // labels[0] = All, labels[1] = 10
      labels[0]?.classList.toggle("view-switcher__label--active", !isTen);
      labels[1]?.classList.toggle("view-switcher__label--active", isTen);
    }

    // Display mode toggle (artists/songs)
    const displayControl = this.wrapper.querySelector('[data-control="display-mode"]') as HTMLElement | null;
    if (displayControl) {
      const track = displayControl.querySelector(".view-switcher__track");
      const labels = displayControl.querySelectorAll(".view-switcher__label");
      const isSongs = state.displayMode === "songs";
      track?.classList.toggle("view-switcher__track--on", isSongs);
      // labels[0] = Artists, labels[1] = Songs
      labels[0]?.classList.toggle("view-switcher__label--active", !isSongs);
      labels[1]?.classList.toggle("view-switcher__label--active", isSongs);
    }

    // View buttons
    this.setViewMode(state.view);

    // Artist trigger label
    if (this.artistTriggerEl) {
      if (state.artist === "all") {
        this.artistTriggerEl.textContent = "All Artists";
      } else {
        const artist = this.artists.find(a => a.id === state.artist);
        if (artist) this.artistTriggerEl.textContent = artist.name;
      }
    }
  }

  // ─── Private rendering methods ───────────────────────────────────────

  private renderDesktop(): void {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "toolbar";

    const controls = this.createControls();
    for (const ctrl of controls) {
      this.wrapper.appendChild(ctrl);
    }

    this.container!.appendChild(this.wrapper);

    // Default: hide metric in race mode
    const state = this.filterState.getState();
    this.setViewMode(state.view);
  }

  private renderMobile(): void {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "toolbar toolbar--mobile";

    // Add drawer class
    const drawer = document.createElement("div");
    drawer.className = "toolbar__drawer";

    // Trigger button (hamburger icon)
    const trigger = document.createElement("button");
    trigger.className = "toolbar__drawer-trigger";
    trigger.setAttribute("aria-label", "Open controls");
    trigger.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
    trigger.addEventListener("click", () => this.toggleDrawer());
    drawer.appendChild(trigger);

    // Drawer content (controls)
    const drawerContent = document.createElement("div");
    drawerContent.className = "toolbar__drawer-content";

    // Close button at top of fullscreen drawer
    const closeBtn = document.createElement("button");
    closeBtn.className = "toolbar__drawer-close";
    closeBtn.setAttribute("aria-label", "Close controls");
    closeBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>`;
    closeBtn.addEventListener("click", () => this.dismissDrawer());
    drawerContent.appendChild(closeBtn);

    const controls = this.createControls();
    for (const ctrl of controls) {
      drawerContent.appendChild(ctrl);
    }

    drawer.appendChild(drawerContent);
    this.wrapper.appendChild(drawer);
    this.container!.appendChild(this.wrapper);

    // Default: hide metric in race mode
    const state = this.filterState.getState();
    this.setViewMode(state.view);
  }

  private createControls(): HTMLElement[] {
    // DOM order (left-to-right): view (segmented), generation, source, artist, metric, zoom, display-mode
    return [
      this.createViewControl(),
      this.createGenerationControl(),
      this.createSourceControl(),
      this.createArtistControl(),
      this.createMetricControl(),
      this.createZoomControl(),
      this.createDisplayModeControl(),
    ];
  }

  private createGenerationControl(): HTMLElement {
    const group = document.createElement("div");
    group.setAttribute("data-control", "generation");
    group.className = "toolbar__control";

    const select = document.createElement("select");
    select.addEventListener("change", () => {
      const val = select.value;
      this.filterState.update({
        generation: val === "all" ? "all" : Number(val),
      });
      // Reset artist filter if selected artist doesn't match new generation
      this.resetArtistIfNeeded();
      this.renderArtistList();
      this.dismissDrawer();
    });

    // Default option
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All Gens";
    select.appendChild(allOpt);

    group.appendChild(select);
    this.generationSelect = select;
    return group;
  }

  private createSourceControl(): HTMLElement {
    const group = document.createElement("div");
    group.setAttribute("data-control", "source");
    group.className = "toolbar__control";

    const select = document.createElement("select");
    for (const src of SOURCE_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = src.value;
      opt.textContent = src.label;
      select.appendChild(opt);
    }

    select.addEventListener("change", () => {
      this.filterState.update({ source: select.value });
      this.dismissDrawer();
    });

    group.appendChild(select);
    this.sourceSelect = select;
    return group;
  }

  private createArtistControl(): HTMLElement {
    const group = document.createElement("div");
    group.setAttribute("data-control", "artist");
    group.className = "toolbar__control toolbar__control--artist";

    // Trigger button
    const trigger = document.createElement("button");
    trigger.className = "toolbar__artist-trigger";
    trigger.textContent = "All Artists";
    trigger.type = "button";
    trigger.addEventListener("click", () => this.toggleArtistDropdown());
    group.appendChild(trigger);
    this.artistTriggerEl = trigger;

    // Dropdown panel
    const dropdown = document.createElement("div");
    dropdown.className = "toolbar__artist-dropdown";

    // Search input
    const searchInput = document.createElement("input");
    searchInput.className = "toolbar__artist-search";
    searchInput.type = "text";
    searchInput.placeholder = "Search artists...";
    searchInput.addEventListener("input", () => {
      this.artistSelectedIndex = -1;
      this.renderArtistList();
    });
    searchInput.addEventListener("keydown", (e) => this.handleArtistKeydown(e));
    dropdown.appendChild(searchInput);
    this.artistSearchEl = searchInput;

    // Fixed "All Artists" option above the scrollable list
    const allArtistsItem = document.createElement("div");
    allArtistsItem.className = "toolbar__artist-item toolbar__artist-item--pinned";
    allArtistsItem.textContent = "All Artists";
    allArtistsItem.addEventListener("click", () => {
      this.selectArtistEntry("all", "All Artists");
    });
    dropdown.appendChild(allArtistsItem);
    this.allArtistsItemEl = allArtistsItem;

    // Artist list (scrollable)
    const list = document.createElement("div");
    list.className = "toolbar__artist-list";
    dropdown.appendChild(list);
    this.artistListEl = list;

    group.appendChild(dropdown);
    this.artistDropdownEl = dropdown;

    return group;
  }

  private toggleArtistDropdown(): void {
    if (this.artistDropdownOpen) {
      this.closeArtistDropdown();
    } else {
      this.openArtistDropdown();
    }
  }

  private openArtistDropdown(): void {
    this.artistDropdownOpen = true;
    this.artistDropdownEl?.classList.add("toolbar__artist-dropdown--open");
    this.renderArtistList();
    // Focus the search input
    setTimeout(() => this.artistSearchEl?.focus(), 0);
    this.addArtistOutsideClickListener();
  }

  private closeArtistDropdown(): void {
    this.artistDropdownOpen = false;
    this.artistDropdownEl?.classList.remove("toolbar__artist-dropdown--open");
    if (this.artistSearchEl) this.artistSearchEl.value = "";
    this.removeArtistOutsideClickListener();
  }

  private addArtistOutsideClickListener(): void {
    this.artistOutsideClickHandler = (e: Event) => {
      const target = e.target as Node;
      const controlEl = this.artistDropdownEl?.parentElement;
      if (controlEl && !controlEl.contains(target)) {
        this.closeArtistDropdown();
      }
    };
    document.addEventListener("pointerdown", this.artistOutsideClickHandler);
  }

  private removeArtistOutsideClickListener(): void {
    if (this.artistOutsideClickHandler) {
      document.removeEventListener("pointerdown", this.artistOutsideClickHandler);
      this.artistOutsideClickHandler = null;
    }
  }

  private renderArtistList(): void {
    if (!this.artistListEl) return;
    this.artistListEl.innerHTML = "";

    const state = this.filterState.getState();
    const searchTerm = this.artistSearchEl?.value.toLowerCase() ?? "";

    // Update pinned "All Artists" active state
    if (this.allArtistsItemEl) {
      this.allArtistsItemEl.classList.toggle("toolbar__artist-item--active", state.artist === "all");
    }

    // Filter artists by current generation
    let filteredArtists = this.artists;
    if (state.generation !== "all") {
      filteredArtists = filteredArtists.filter(a => a.generation === state.generation);
    }

    // Filter by search term
    if (searchTerm) {
      filteredArtists = filteredArtists.filter(a => a.name.toLowerCase().includes(searchTerm));
    }

    // Build list of selectable entries (artists only, "All Artists" is pinned above)
    const entries: { id: string; label: string }[] = filteredArtists.map(a => ({ id: a.id, label: a.name }));

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const item = document.createElement("div");
      item.className = "toolbar__artist-item";
      if (state.artist === entry.id) {
        item.classList.add("toolbar__artist-item--active");
      }
      if (i === this.artistSelectedIndex) {
        item.classList.add("toolbar__artist-item--highlighted");
      }
      item.textContent = entry.label;
      item.addEventListener("click", () => {
        this.selectArtistEntry(entry.id, entry.label);
      });
      this.artistListEl!.appendChild(item);
    }
  }

  private selectArtistEntry(id: string, label: string): void {
    this.filterState.update({ artist: id });
    if (this.artistTriggerEl) this.artistTriggerEl.textContent = label;
    this.closeArtistDropdown();
    this.dismissDrawer();
  }

  private handleArtistKeydown(e: KeyboardEvent): void {
    if (!this.artistListEl) return;
    const items = this.artistListEl.querySelectorAll(".toolbar__artist-item");
    const count = items.length;
    if (count === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.artistSelectedIndex = Math.min(this.artistSelectedIndex + 1, count - 1);
        this.renderArtistList();
        this.scrollArtistItemIntoView();
        break;

      case "ArrowUp":
        e.preventDefault();
        this.artistSelectedIndex = Math.max(this.artistSelectedIndex - 1, 0);
        this.renderArtistList();
        this.scrollArtistItemIntoView();
        break;

      case "Enter":
        e.preventDefault();
        if (this.artistSelectedIndex >= 0 && this.artistSelectedIndex < count) {
          (items[this.artistSelectedIndex] as HTMLElement).click();
        }
        break;

      case "Escape":
        e.preventDefault();
        this.closeArtistDropdown();
        break;
    }
  }

  private scrollArtistItemIntoView(): void {
    if (!this.artistListEl || this.artistSelectedIndex < 0) return;
    const items = this.artistListEl.querySelectorAll(".toolbar__artist-item");
    const target = items[this.artistSelectedIndex] as HTMLElement | undefined;
    target?.scrollIntoView({ block: "nearest" });
  }

  private resetArtistIfNeeded(): void {
    const state = this.filterState.getState();
    if (state.artist === "all") return;

    const genFilter = state.generation;
    if (genFilter === "all") return;

    // Check if the currently selected artist belongs to the new generation
    const selectedArtist = this.artists.find(a => a.id === state.artist);
    if (!selectedArtist || selectedArtist.generation !== genFilter) {
      this.filterState.update({ artist: "all" });
      if (this.artistTriggerEl) this.artistTriggerEl.textContent = "All Artists";
    }
  }

  private createMetricControl(): HTMLElement {
    // Segmented control (three options don't fit a two-position toggle)
    const group = document.createElement("div");
    group.setAttribute("data-control", "metric");
    group.className = "toolbar__control toolbar__view-group toolbar__metric-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Metric");

    const metrics: { value: "points" | "wins" | "appearances"; label: string }[] = [
      { value: "points", label: "Points" },
      { value: "wins", label: "Wins" },
      { value: "appearances", label: "Appearances" },
    ];

    const current = this.filterState.getState().metric;

    for (const m of metrics) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar__view-btn toolbar__metric-btn" + (m.value === current ? " toolbar__view-btn--active" : "");
      btn.textContent = m.label;
      btn.dataset.metric = m.value;
      btn.addEventListener("click", () => {
        const buttons = group.querySelectorAll(".toolbar__metric-btn");
        buttons.forEach((b) => b.classList.remove("toolbar__view-btn--active"));
        btn.classList.add("toolbar__view-btn--active");
        this.filterState.update({ metric: m.value });
      });
      group.appendChild(btn);
    }

    return group;
  }

  private createViewControl(): HTMLElement {
    const group = document.createElement("div");
    group.setAttribute("data-control", "view");
    group.className = "toolbar__control toolbar__view-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "View mode");

    const views: { value: string; label: string; filterValue: string }[] = [
      { value: "race", label: "Race", filterValue: "line" },
      { value: "episodes", label: "Episodes", filterValue: "episodes" },
      { value: "artist-timeline", label: "Artist", filterValue: "artist-timeline" },
      { value: "yearly", label: "Yearly", filterValue: "yearly" },
    ];

    const state = this.filterState.getState();
    const currentActive = state.view === "line" || state.view === "race" ? "race" : state.view;

    for (const v of views) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar__view-btn" + (v.value === currentActive ? " toolbar__view-btn--active" : "");
      btn.textContent = v.label;
      btn.dataset.view = v.value;
      btn.addEventListener("click", () => {
        // Remove active from all buttons
        const buttons = group.querySelectorAll(".toolbar__view-btn");
        buttons.forEach((b) => b.classList.remove("toolbar__view-btn--active"));
        btn.classList.add("toolbar__view-btn--active");

        const newView = v.filterValue as "line" | "episodes" | "yearly" | "artist-timeline";
        this.filterState.update({ view: newView });
        this.setViewMode(newView);
        this.dismissDrawer();

        // If switching to artist-timeline and no artist selected, open the dropdown
        if (newView === "artist-timeline") {
          const currentState = this.filterState.getState();
          if (currentState.artist === "all") {
            setTimeout(() => this.openArtistDropdown(), 100);
          }
        }
      });
      group.appendChild(btn);
    }

    return group;
  }

  private createZoomControl(): HTMLElement {
    const group = document.createElement("div");
    group.setAttribute("data-control", "zoom");
    group.className = "toolbar__control view-switcher";
    group.setAttribute("role", "switch");
    group.setAttribute("aria-label", "Zoom level");
    group.tabIndex = 0;

    const allLabel = document.createElement("span");
    allLabel.className = "view-switcher__label";
    allLabel.textContent = "All";

    const track = document.createElement("div");
    track.className = "view-switcher__track view-switcher__track--on";
    const thumb = document.createElement("div");
    thumb.className = "view-switcher__thumb";
    track.appendChild(thumb);

    const tenLabel = document.createElement("span");
    tenLabel.className = "view-switcher__label view-switcher__label--active";
    tenLabel.textContent = "10";

    group.appendChild(allLabel);
    group.appendChild(track);
    group.appendChild(tenLabel);

    const toggle = () => {
      const isTen = track.classList.contains("view-switcher__track--on");
      const newZoom = isTen ? "all" : 10;
      track.classList.toggle("view-switcher__track--on", !isTen);
      tenLabel.classList.toggle("view-switcher__label--active", !isTen);
      allLabel.classList.toggle("view-switcher__label--active", isTen);
      this.filterState.update({ zoom: newZoom });
    };

    group.addEventListener("click", toggle);
    group.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

    return group;
  }

  private createDisplayModeControl(): HTMLElement {
    const group = document.createElement("div");
    group.setAttribute("data-control", "display-mode");
    group.className = "toolbar__control view-switcher";
    group.setAttribute("role", "switch");
    group.setAttribute("aria-label", "Display mode");
    group.tabIndex = 0;

    const artistsLabel = document.createElement("span");
    artistsLabel.className = "view-switcher__label";
    artistsLabel.textContent = "Artists";

    const track = document.createElement("div");
    track.className = "view-switcher__track view-switcher__track--on";
    const thumb = document.createElement("div");
    thumb.className = "view-switcher__thumb";
    track.appendChild(thumb);

    const songsLabel = document.createElement("span");
    songsLabel.className = "view-switcher__label view-switcher__label--active";
    songsLabel.textContent = "Songs";

    group.appendChild(artistsLabel);
    group.appendChild(track);
    group.appendChild(songsLabel);

    const toggle = () => {
      const isSongs = track.classList.contains("view-switcher__track--on");
      const newMode = isSongs ? "artists" : "songs";
      track.classList.toggle("view-switcher__track--on", !isSongs);
      songsLabel.classList.toggle("view-switcher__label--active", !isSongs);
      artistsLabel.classList.toggle("view-switcher__label--active", isSongs);
      this.filterState.update({ displayMode: newMode });
    };

    group.addEventListener("click", toggle);
    group.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

    return group;
  }

  // ─── Mobile drawer helpers ───────────────────────────────────────────

  private toggleDrawer(): void {
    if (this.drawerOpen) {
      this.dismissDrawer();
    } else {
      this.openDrawer();
    }
  }

  private openDrawer(): void {
    this.drawerOpen = true;
    const content = this.wrapper?.querySelector(".toolbar__drawer-content");
    if (content) {
      content.classList.add("toolbar__drawer-content--open");
    }
    this.addOutsideClickListener();
  }

  private dismissDrawer(): void {
    if (!this.isMobile || !this.drawerOpen) return;
    this.drawerOpen = false;
    const content = this.wrapper?.querySelector(".toolbar__drawer-content");
    if (content) {
      content.classList.remove("toolbar__drawer-content--open");
    }
    this.removeOutsideClickListener();
  }

  private addOutsideClickListener(): void {
    this.outsideClickHandler = (e: Event) => {
      const target = e.target as Node;
      const drawerContent = this.wrapper?.querySelector(
        ".toolbar__drawer-content",
      );
      const trigger = this.wrapper?.querySelector(".toolbar__drawer-trigger");
      if (
        drawerContent &&
        !drawerContent.contains(target) &&
        trigger &&
        !trigger.contains(target)
      ) {
        this.dismissDrawer();
      }
    };
    document.addEventListener("pointerdown", this.outsideClickHandler);
  }

  private removeOutsideClickListener(): void {
    if (this.outsideClickHandler) {
      document.removeEventListener("pointerdown", this.outsideClickHandler);
      this.outsideClickHandler = null;
    }
  }


}

/** Returns ordinal suffix for a number (1st, 2nd, 3rd, 4th, etc.) */
function getOrdinalSuffix(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "st";
  if (mod10 === 2 && mod100 !== 12) return "nd";
  if (mod10 === 3 && mod100 !== 13) return "rd";
  return "th";
}
