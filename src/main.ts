/**
 * K-Pop Chart Race — Application Entry Point
 *
 * Wires all components together: data loading, chart engine, renderer,
 * playback controls, toolbar, filter state, detail panel, and accessibility features.
 */

import "./style.css";

import { EventBus } from "./event-bus.ts";
import { loadFromAirtable } from "./airtable/data-adapter.ts";
import { computeSnapshot, computeSnapshotSongs, computeChartWins, extractGenerations, applyGenerationFilter } from "./chart-engine.ts";
import { FilterStateManager } from "./filter-state-manager.ts";
import { Toolbar } from "./toolbar.ts";
import { LoadingScreen } from "./loading-screen.ts";
import { ChartRaceRenderer } from "./chart-race-renderer.ts";
import { PlaybackController } from "./playback-controller.ts";
import { DetailPanel } from "./detail-panel.ts";
import { LiveRegionAnnouncer } from "./live-region.ts";
import { ScreenReaderPacedMode } from "./screen-reader-paced-mode.ts";
import { YearlyView } from "./yearly-view.ts";
import type { ChartSnapshot, DataStore } from "./models.ts";
import type { FilterState } from "./types.ts";

async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) {
    console.error("Could not find #app container.");
    return;
  }

  // --- Shared state ---
  const eventBus = new EventBus();
  let currentSnapshot: ChartSnapshot | undefined;
  let previousSnapshot: ChartSnapshot | undefined;

  // --- Initialize FilterStateManager with defaults (Songs mode, all gen, all source, zoom 10) ---
  const filterStateManager = new FilterStateManager(eventBus, {
    displayMode: "songs",
    generation: "all",
    source: "all",
    zoom: 10,
    view: "race",
    metric: "points",
  });

  // --- Loading phase ---
  const loadingScreen = new LoadingScreen();
  loadingScreen.mount(app);

  let dataStore: DataStore;
  try {
    dataStore = await loadFromAirtable((loaded, total, name) => {
      loadingScreen.onFileProgress(loaded, total, [name]);
    });

    if (dataStore.artists.size === 0) {
      loadingScreen.onError("No chart data available.");
      return;
    }

    // Compute chart wins and attach to dataStore
    dataStore.chartWins = computeChartWins(dataStore);

    await loadingScreen.onComplete();
  } catch (_err) {
    loadingScreen.onError(
      "Unable to load chart data. Please try refreshing the page.",
    );
    return;
  }

  // --- Mount UI components ---
  const renderer = new ChartRaceRenderer(eventBus);
  renderer.mount(app);

  // Compute total points across all artists and all dates
  let totalPoints = 0;
  for (const artist of dataStore.artists.values()) {
    for (const release of artist.releases) {
      for (const entry of release.dailyValues.values()) {
        totalPoints += entry.value;
      }
    }
  }
  renderer.setDataNote(dataStore.startDate, totalPoints);

  const playbackController = new PlaybackController(eventBus, dataStore.dates);
  playbackController.mount(app);

  // --- Mount Toolbar ---
  const toolbar = new Toolbar(eventBus, filterStateManager);
  toolbar.mount(app);
  toolbar.setGenerations(extractGenerations(dataStore));

  const detailPanel = new DetailPanel(eventBus);

  const liveRegion = new LiveRegionAnnouncer();
  liveRegion.mount(app);

  const pacedMode = new ScreenReaderPacedMode();
  pacedMode.mountControl(app);

  // --- Yearly View ---
  const yearlyView = new YearlyView();

  // --- Helper: compute snapshot based on current filter state ---
  function computeCurrentSnapshot(date: string): ChartSnapshot {
    const filterState = filterStateManager.getState();
    let snapshot: ChartSnapshot;

    if (filterState.displayMode === "songs") {
      snapshot = computeSnapshotSongs(date, dataStore, filterState, previousSnapshot);
    } else {
      snapshot = computeSnapshot(date, dataStore, previousSnapshot, filterState.source);
    }

    // Apply generation filter
    const filteredEntries = applyGenerationFilter(snapshot.entries, filterState.generation);
    return { date: snapshot.date, entries: filteredEntries };
  }

  // --- Helper: switch between race and yearly views ---
  function switchView(mode: "race" | "yearly"): void {
    // Note: FilterStateManager already has the new view set by the time this fires
    // via the toolbar. We use DOM state (not filter state) to avoid double-switching.
    toolbar.setViewMode(mode);

    if (mode === "yearly") {
      // Pause playback if running
      if (playbackController.isPlaying()) {
        playbackController.pause();
      }
      if (detailPanel.isOpen()) {
        detailPanel.close();
      }
      // Update date display to show year range
      const dateDisplay = app!.querySelector(".chart-race__date") as HTMLElement | null;
      const startYear = dataStore.startDate.substring(0, 4);
      const endYear = dataStore.endDate.substring(0, 4);
      if (dateDisplay) {
        dateDisplay.textContent = `${startYear} – ${endYear}`;
      }
      // Hide race-specific elements
      const barsContainer = app!.querySelector(".chart-race__bars") as HTMLElement | null;
      const playbackControls = app!.querySelector(".playback-controls") as HTMLElement | null;
      if (barsContainer) barsContainer.style.display = "none";
      if (playbackControls) playbackControls.style.display = "none";
      // Mount yearly view with ALL current filter state applied immediately (no flash)
      const state = filterStateManager.getState();
      yearlyView.setDisplayMode(state.displayMode);
      yearlyView.setGenerationFilter(state.generation);
      yearlyView.setSourceFilter(state.source);
      yearlyView.setMetric(state.metric);
      yearlyView.setZoom(state.zoom === 10 ? 10 : "all");
      const chartRaceWrapper = app!.querySelector(".chart-race") as HTMLElement | null;
      if (chartRaceWrapper) {
        yearlyView.mount(chartRaceWrapper, dataStore);
      }
    } else {
      // Unmount yearly view
      yearlyView.unmount();
      // Restore date display to current snapshot date
      const dateDisplay = app!.querySelector(".chart-race__date") as HTMLElement | null;
      if (dateDisplay && currentSnapshot) {
        dateDisplay.textContent = currentSnapshot.date;
      }
      // Show race elements
      const barsContainer = app!.querySelector(".chart-race__bars") as HTMLElement | null;
      const playbackControls = app!.querySelector(".playback-controls") as HTMLElement | null;
      if (barsContainer) barsContainer.style.display = "";
      if (playbackControls) playbackControls.style.display = "";
      // Re-compute snapshot with current filters applied (no flash of stale data)
      if (currentSnapshot) {
        const date = currentSnapshot.date;
        previousSnapshot = currentSnapshot;
        currentSnapshot = computeCurrentSnapshot(date);
      }
      // Re-render race view with current filter state
      const currentZoom = filterStateManager.getState().zoom;
      if (currentSnapshot) {
        renderer.update(currentSnapshot, currentZoom, dataStore);
      }
      renderer.recheckOverflow();
    }
  }

  // --- EventBus wiring ---

  // filter:change → re-compute snapshot and handle view/zoom changes
  eventBus.on("filter:change", (state: FilterState) => {
    const currentView = state.view;

    // Handle view switching
    const barsContainer = app!.querySelector(".chart-race__bars") as HTMLElement | null;
    const isCurrentlyRace = barsContainer ? barsContainer.style.display !== "none" : true;
    const shouldBeRace = currentView === "race";

    if (shouldBeRace !== isCurrentlyRace) {
      switchView(currentView);
    }

    // Handle filter changes in yearly view — pass all relevant state
    if (currentView === "yearly") {
      yearlyView.setDisplayMode(state.displayMode);
      yearlyView.setGenerationFilter(state.generation);
      yearlyView.setSourceFilter(state.source);
      yearlyView.setMetric(state.metric);
      yearlyView.setZoom(state.zoom === 10 ? 10 : "all");
      return;
    }

    // For race view: re-compute snapshot with current date
    if (currentSnapshot) {
      const date = currentSnapshot.date;
      previousSnapshot = currentSnapshot;
      currentSnapshot = computeCurrentSnapshot(date);
      eventBus.emit("state:updated", currentSnapshot);
    }
  });

  // date:change → compute snapshot → emit state:updated
  eventBus.on("date:change", (date: string) => {
    if (detailPanel.isOpen()) {
      detailPanel.close();
    }
    previousSnapshot = currentSnapshot;
    currentSnapshot = computeCurrentSnapshot(date);
    eventBus.emit("state:updated", currentSnapshot);
  });

  // reset → clear snapshot history so next date starts fresh
  eventBus.on("reset", () => {
    console.log("[DEBUG] main.ts reset: clearing snapshots");
    previousSnapshot = undefined;
    currentSnapshot = undefined;
  });

  // state:updated → update renderer + announce for screen readers
  eventBus.on("state:updated", (snapshot: ChartSnapshot) => {
    const currentZoom = filterStateManager.getState().zoom;
    renderer.update(snapshot, currentZoom, dataStore);

    // Screen reader announcement
    if (pacedMode.isActive()) {
      const message = pacedMode.formatAnnouncement(snapshot);
      liveRegion.announce(message);
    } else {
      const top = snapshot.entries[0];
      if (top) {
        liveRegion.announce(
          `${snapshot.date}: #1 ${top.artistName} (${top.cumulativeValue.toLocaleString()})`,
        );
      }
    }
  });

  // zoom:change → update filter state (which triggers filter:change → re-render)
  eventBus.on("zoom:change", (level) => {
    if (detailPanel.isOpen()) {
      detailPanel.close();
    }
    // Update filter state — this will trigger filter:change and re-render
    filterStateManager.update({ zoom: level });
  });

  // bar:click → freeze-then-resolve: pause if playing, then open detail panel
  eventBus.on("bar:click", (artistId: string) => {
    if (playbackController.isPlaying()) {
      playbackController.pause();
    }
    // In Songs mode, the emitted ID is the actual artist ID (from coArtists),
    // but entries are keyed by composite releaseKey. Find the entry that contains
    // this artist in its coArtists array.
    let entry = currentSnapshot?.entries.find(e => e.artistId === artistId);
    if (!entry) {
      entry = currentSnapshot?.entries.find(e =>
        e.coArtists?.some(a => a.id === artistId)
      );
    }
    const rank = entry?.rank;
    const coArtists = entry?.coArtists;
    detailPanel.open(artistId, dataStore, currentSnapshot?.date, rank, coArtists);
    renderer.recheckOverflow();
  });

  // pause → auto-open detail panel for top-ranked artist
  eventBus.on("pause", () => {
    if (currentSnapshot && currentSnapshot.entries.length > 0) {
      const topEntry = currentSnapshot.entries[0];
      const topArtistId = topEntry.artistId;
      const coArtists = topEntry.coArtists;
      detailPanel.open(topArtistId, dataStore, currentSnapshot.date, 1, coArtists);
      renderer.recheckOverflow();
    }
  });

  // play → auto-close detail panel
  eventBus.on("play", () => {
    if (detailPanel.isOpen()) {
      detailPanel.close();
    }
  });

  // panel:close → recheck overflow since main area width changes
  eventBus.on("panel:close", () => {
    renderer.recheckOverflow();
  });

  // click-outside → close detail panel when clicking empty chart space
  const chartRaceEl = app.querySelector(".chart-race");
  if (chartRaceEl) {
    chartRaceEl.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const wrapper = target.closest(".chart-race__bar-wrapper");
      if (wrapper && target !== wrapper) return;
      if (target.closest(".detail-panel")) return;
      if (detailPanel.isOpen()) {
        detailPanel.close();
      }
    });
  }

  // --- Initial render ---
  // Defer the first date:change so the browser completes layout after mount().
  // Without this, clientHeight is 0 and bars render with zero height.
  if (dataStore.dates.length > 0) {
    requestAnimationFrame(() => {
      eventBus.emit("date:change", dataStore.dates[dataStore.dates.length - 1]);

      // On non-mobile, auto-open the detail panel for the #1 artist after animation completes
      if (window.innerWidth >= 768) {
        const onInitialComplete = () => {
          eventBus.off("update:complete", onInitialComplete);
          if (currentSnapshot && currentSnapshot.entries.length > 0) {
            const topEntry = currentSnapshot.entries[0];
            const topArtistId = topEntry.artistId;
            const coArtists = topEntry.coArtists;
            detailPanel.open(topArtistId, dataStore, currentSnapshot.date, 1, coArtists);
            renderer.recheckOverflow();
          }
        };
        eventBus.on("update:complete", onInitialComplete);
      }
    });
  }
}

main();
