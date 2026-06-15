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
  private filterState: FilterStateManager;
  private container: HTMLElement | null = null;
  private wrapper: HTMLElement | null = null;
  private isMobile = false;
  private drawerOpen = false;
  private outsideClickHandler: ((e: Event) => void) | null = null;

  // Control elements
  private generationSelect: HTMLSelectElement | null = null;

  constructor(eventBus: EventBus, filterState: FilterStateManager) {
    // eventBus retained for future direct event subscriptions
    void eventBus;
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
  }

  unmount(): void {
    if (this.wrapper && this.container) {
      this.container.removeChild(this.wrapper);
    }
    this.removeOutsideClickListener();
    this.wrapper = null;
    this.container = null;
    this.generationSelect = null;
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

  /** Show/hide yearly-only controls (Points/Wins metric toggle) */
  setViewMode(view: "race" | "yearly"): void {
    if (!this.wrapper) return;
    const metricControl = this.wrapper.querySelector(
      '[data-control="metric"]',
    ) as HTMLElement | null;
    if (!metricControl) return;

    if (view === "race") {
      metricControl.classList.add("toolbar__control--hidden");
    } else {
      metricControl.classList.remove("toolbar__control--hidden");
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

    // Chip summary
    const chips = document.createElement("div");
    chips.className = "toolbar__chips";
    chips.textContent = this.buildChipSummary();
    drawer.appendChild(chips);

    // Trigger button
    const trigger = document.createElement("button");
    trigger.className = "toolbar__drawer-trigger";
    trigger.textContent = "Filters";
    trigger.addEventListener("click", () => this.toggleDrawer());
    drawer.appendChild(trigger);

    // Drawer content (controls)
    const drawerContent = document.createElement("div");
    drawerContent.className = "toolbar__drawer-content";

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
    // DOM order (left-to-right): generation, source, metric, view, zoom, display-mode
    return [
      this.createGenerationControl(),
      this.createSourceControl(),
      this.createMetricControl(),
      this.createViewControl(),
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
    return group;
  }

  private createMetricControl(): HTMLElement {
    const group = document.createElement("div");
    group.setAttribute("data-control", "metric");
    group.className = "toolbar__control view-switcher";
    group.setAttribute("role", "switch");
    group.setAttribute("aria-label", "Metric");
    group.tabIndex = 0;

    const winsLabel = document.createElement("span");
    winsLabel.className = "view-switcher__label";
    winsLabel.textContent = "Wins";

    const track = document.createElement("div");
    track.className = "view-switcher__track view-switcher__track--on";
    const thumb = document.createElement("div");
    thumb.className = "view-switcher__thumb";
    track.appendChild(thumb);

    const pointsLabel = document.createElement("span");
    pointsLabel.className = "view-switcher__label view-switcher__label--active";
    pointsLabel.textContent = "Points";

    group.appendChild(winsLabel);
    group.appendChild(track);
    group.appendChild(pointsLabel);

    const toggle = () => {
      const isPoints = track.classList.contains("view-switcher__track--on");
      const newMetric = isPoints ? "wins" : "points";
      track.classList.toggle("view-switcher__track--on", !isPoints);
      pointsLabel.classList.toggle("view-switcher__label--active", !isPoints);
      winsLabel.classList.toggle("view-switcher__label--active", isPoints);
      this.filterState.update({ metric: newMetric });
    };

    group.addEventListener("click", toggle);
    group.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

    return group;
  }

  private createViewControl(): HTMLElement {
    const group = document.createElement("div");
    group.setAttribute("data-control", "view");
    group.className = "toolbar__control view-switcher";
    group.setAttribute("role", "switch");
    group.setAttribute("aria-label", "View mode");
    group.tabIndex = 0;

    const yearlyLabel = document.createElement("span");
    yearlyLabel.className = "view-switcher__label";
    yearlyLabel.textContent = "Yearly";

    const track = document.createElement("div");
    track.className = "view-switcher__track view-switcher__track--on";
    const thumb = document.createElement("div");
    thumb.className = "view-switcher__thumb";
    track.appendChild(thumb);

    const raceLabel = document.createElement("span");
    raceLabel.className = "view-switcher__label view-switcher__label--active";
    raceLabel.textContent = "Race";

    group.appendChild(yearlyLabel);
    group.appendChild(track);
    group.appendChild(raceLabel);

    const toggle = () => {
      const isRace = track.classList.contains("view-switcher__track--on");
      const newView = isRace ? "yearly" : "race";
      track.classList.toggle("view-switcher__track--on", !isRace);
      raceLabel.classList.toggle("view-switcher__label--active", !isRace);
      yearlyLabel.classList.toggle("view-switcher__label--active", isRace);
      this.filterState.update({ view: newView });
      this.setViewMode(newView);
    };

    group.addEventListener("click", toggle);
    group.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

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

  private buildChipSummary(): string {
    const state = this.filterState.getState();
    const chips: string[] = [];

    if (state.generation !== "all") {
      chips.push(`Gen ${state.generation}`);
    }
    if (state.source !== "all") {
      chips.push(state.source);
    }
    if (state.displayMode !== "songs") {
      chips.push("Artists");
    }
    if (state.zoom !== 10) {
      chips.push("All zoom");
    }

    return chips.length > 0 ? chips.join(", ") : "Default filters";
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
