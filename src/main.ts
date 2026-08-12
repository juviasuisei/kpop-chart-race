/**
 * K-Pop Chart Race — Application Entry Point
 *
 * Wires all components together: data loading, line chart controller,
 * playback controls, toolbar, filter state, and accessibility features.
 */

import "./style.css";

import { EventBus } from "./event-bus.ts";
import { loadFromAirtable } from "./airtable/data-adapter.ts";
import { computeChartWins, extractGenerations } from "./chart-engine.ts";
import { FilterStateManager } from "./filter-state-manager.ts";
import { Toolbar } from "./toolbar.ts";
import { LoadingScreen } from "./loading-screen.ts";
import { PlaybackController } from "./playback-controller.ts";
import { LiveRegionAnnouncer } from "./live-region.ts";
import { ScreenReaderPacedMode } from "./screen-reader-paced-mode.ts";
import { YearlyView } from "./yearly-view.ts";
import { LineChartController } from "./views/line-chart-controller.ts";
import { TimeNavigation } from "./canvas/time-navigation.ts";
import { SearchOverlay } from "./canvas/search-overlay.ts";
import { Tooltip } from "./canvas/tooltip.ts";
import type { DataStore } from "./models.ts";
import type { FilterState } from "./types.ts";
import type { LineHoverEvent } from "./event-bus.ts";

async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) {
    console.error("Could not find #app container.");
    return;
  }

  // --- Shared state ---
  const eventBus = new EventBus();

  // --- Initialize FilterStateManager with defaults ---
  const filterStateManager = new FilterStateManager(eventBus, {
    displayMode: "songs",
    generation: "all",
    source: "all",
    zoom: 10,
    view: "line",
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
    const chartWinsResult = computeChartWins(dataStore);
    dataStore.chartWins = chartWinsResult.chartWins;
    dataStore.releaseWinDates = chartWinsResult.releaseWinDates;

    await loadingScreen.onComplete();
  } catch (_err) {
    loadingScreen.onError(
      "Unable to load chart data. Please try refreshing the page.",
    );
    return;
  }

  // --- Create line chart container ---
  const chartContainer = document.createElement("div");
  chartContainer.className = "line-chart-container";
  app.appendChild(chartContainer);

  // --- Mount Line Chart Controller ---
  const lineChart = new LineChartController(eventBus);
  await lineChart.mount(chartContainer);
  await lineChart.initData(dataStore);

  // --- Mount Playback Controller ---
  const playbackController = new PlaybackController(eventBus, dataStore.dates);
  playbackController.mount(app);

  // --- Mount Toolbar ---
  const toolbar = new Toolbar(eventBus, filterStateManager);
  toolbar.mount(app);
  toolbar.setGenerations(extractGenerations(dataStore));

  // --- Mount Time Navigation ---
  const timeNav = new TimeNavigation();
  timeNav.mount(app);
  timeNav.onPresetSelect = (preset) => {
    lineChart.applyTimeZoom(preset);
    eventBus.emit("time:zoom", preset);
  };

  // --- Mount Search Overlay ---
  const search = new SearchOverlay(chartContainer);
  search.setItems(lineChart.getAllLines());
  search.onSelect = (lineId, multiSelect) => {
    lineChart.selectLine(lineId, multiSelect);
  };

  // --- Mount Tooltip ---
  const tooltip = new Tooltip(chartContainer);

  // --- Accessibility ---
  const liveRegion = new LiveRegionAnnouncer();
  liveRegion.mount(app);

  const pacedMode = new ScreenReaderPacedMode();
  pacedMode.mountControl(app);

  // --- Yearly View ---
  const yearlyView = new YearlyView();

  // --- Helper: switch between line and yearly views ---
  function switchView(mode: "line" | "yearly"): void {
    if (mode === "yearly") {
      if (playbackController.isPlaying()) {
        playbackController.pause();
      }
      chartContainer.style.display = "none";
      const playbackControls = app!.querySelector(".playback-controls") as HTMLElement | null;
      if (playbackControls) playbackControls.style.display = "none";

      const state = filterStateManager.getState();
      yearlyView.setDisplayMode(state.displayMode);
      yearlyView.setGenerationFilter(state.generation);
      yearlyView.setSourceFilter(state.source);
      yearlyView.setMetric(state.metric);
      yearlyView.setZoom(state.zoom === 10 ? 10 : "all");
      yearlyView.mount(app!, dataStore);
    } else {
      yearlyView.unmount();
      chartContainer.style.display = "";
      const playbackControls = app!.querySelector(".playback-controls") as HTMLElement | null;
      if (playbackControls) playbackControls.style.display = "";
    }
  }

  // --- EventBus wiring ---

  // filter:change → update line chart filters, handle view switching
  eventBus.on("filter:change", (state: FilterState) => {
    const currentView = state.view;

    // Handle view switching
    if (currentView === "yearly") {
      switchView("yearly");
      yearlyView.setDisplayMode(state.displayMode);
      yearlyView.setGenerationFilter(state.generation);
      yearlyView.setSourceFilter(state.source);
      yearlyView.setMetric(state.metric);
      yearlyView.setZoom(state.zoom === 10 ? 10 : "all");
      return;
    }

    // Line view active — pass filter state to controller
    if (currentView === "line" || currentView === "race") {
      switchView("line");
      lineChart.setFilters(state);
    }
  });

  // date:change → update line chart date index
  eventBus.on("date:change", (date: string) => {
    const index = dataStore.dates.indexOf(date);
    if (index >= 0) {
      lineChart.setDateIndex(index);
    }
  });

  // play/pause → inform line chart controller
  eventBus.on("play", () => {
    lineChart.setPlaying(true);
  });

  eventBus.on("pause", () => {
    lineChart.setPlaying(false);
  });

  // reset → line chart handles internally via date index
  eventBus.on("reset", () => {
    lineChart.setDateIndex(0);
  });

  // line:hover → show/hide tooltip
  eventBus.on("line:hover", (event: LineHoverEvent | null) => {
    if (event) {
      tooltip.show(event.label, event.x, event.y);
    } else {
      tooltip.hide();
    }
  });

  // line:select → announce for screen readers
  eventBus.on("line:select", (lineIds: string[]) => {
    if (lineIds.length > 0) {
      const labels = lineIds.map(id => lineChart.getLineMetadata(id)?.label ?? id);
      liveRegion.announce(`Selected: ${labels.join(", ")}`);
    } else {
      liveRegion.announce("Selection cleared");
    }
  });

  // zoom:change → update filter state (legacy event from toolbar)
  eventBus.on("zoom:change", () => {
    // Handled via filter:change
  });

  // Keyboard: Ctrl+F or / to open search
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      search.show();
    }
    if (e.key === "/" && !search.isVisible() && document.activeElement === document.body) {
      e.preventDefault();
      search.show();
    }
  });

  // --- Initial render ---
  // Start at the last date (current state, no animation)
  if (dataStore.dates.length > 0) {
    requestAnimationFrame(() => {
      const lastDate = dataStore.dates[dataStore.dates.length - 1];
      eventBus.emit("date:change", lastDate);
    });
  }
}

main();
