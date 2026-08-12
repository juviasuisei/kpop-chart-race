/**
 * K-Pop Chart Race — Application Entry Point
 *
 * Wires all components together: data loading, line chart controller,
 * playback controls, toolbar, filter state, and accessibility features.
 */

import "./style.css";

import pkg from "../package.json";
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
import { EpisodeBrowser } from "./views/episode-browser.ts";
import { ArtistTimeline } from "./views/artist-timeline.ts";
import { TimeNavigation } from "./canvas/time-navigation.ts";
import { SearchOverlay } from "./canvas/search-overlay.ts";
import type { DataStore } from "./models.ts";
import type { FilterState } from "./types.ts";

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
    artist: "all",
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

    // Fill in ALL calendar days from one day before the first date to the last date.
    // This ensures every day is represented (consistent x-spacing, hoverable).
    const firstRealDate = dataStore.dates[0];
    const lastRealDate = dataStore.dates[dataStore.dates.length - 1];
    if (firstRealDate && lastRealDate) {
      try {
        const start = new Date(firstRealDate + "T00:00:00");
        start.setDate(start.getDate() - 1); // zero-day
        const end = new Date(lastRealDate + "T00:00:00");
        const allDays: string[] = [];
        const current = new Date(start);
        while (current <= end) {
          allDays.push(current.toISOString().split("T")[0]);
          current.setDate(current.getDate() + 1);
        }
        dataStore.dates = allDays;
        dataStore.startDate = allDays[0];
      } catch { /* leave as-is */ }
    }

    await loadingScreen.onComplete();
  } catch (_err) {
    loadingScreen.onError(
      "Unable to load chart data. Please try refreshing the page.",
    );
    return;
  }

  // --- Title header ---
  const topBar = document.createElement("div");
  topBar.className = "chart-race__top-bar";
  const titleHeader = document.createElement("div");
  titleHeader.className = "chart-race__title-header";
  const titleText = document.createElement("span");
  titleText.className = "chart-race__title-text";
  titleText.textContent = "K-Pop Chart Race";
  const versionBadge = document.createElement("span");
  versionBadge.className = "chart-race__version-badge";
  versionBadge.textContent = `v${pkg.version}`;
  const dataNote = document.createElement("span");
  dataNote.className = "chart-race__data-note";
  let totalPoints = 0;
  for (const artist of dataStore.artists.values()) {
    for (const release of artist.releases) {
      for (const entry of release.dailyValues.values()) {
        totalPoints += entry.value;
      }
    }
  }
  dataNote.textContent = `— ${totalPoints.toLocaleString()} total points from ${dataStore.startDate} forward`;
  titleHeader.appendChild(titleText);
  titleHeader.appendChild(versionBadge);
  titleHeader.appendChild(dataNote);
  topBar.appendChild(titleHeader);

  // --- Mount Toolbar (filters — on the same line as title) ---
  const toolbar = new Toolbar(eventBus, filterStateManager);
  toolbar.mount(topBar);
  toolbar.setGenerations(extractGenerations(dataStore));

  app.appendChild(topBar);

  // Provide artist list to toolbar for artist filter dropdown
  const artistList = Array.from(dataStore.artists.values()).map(a => ({
    id: a.id,
    name: a.name,
    generation: a.generation,
  })).sort((a, b) => a.name.localeCompare(b.name));
  toolbar.setArtists(artistList);

  // --- Create line chart container ---
  const chartContainer = document.createElement("div");
  chartContainer.className = "line-chart-container";
  app.appendChild(chartContainer);

  // --- Mount Line Chart Controller ---
  const lineChart = new LineChartController(eventBus);
  await lineChart.mount(chartContainer);
  await lineChart.initData(dataStore);

  // --- Mount Playback Controller (scrubber — stays at bottom) ---
  const playbackController = new PlaybackController(eventBus, dataStore.dates);
  playbackController.mount(app);

  // --- Mount Time Navigation (below scrubber, centered) ---
  const timeNav = new TimeNavigation();
  timeNav.setTotalDays(dataStore.dates.length);
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

  // --- Accessibility ---
  const liveRegion = new LiveRegionAnnouncer();
  liveRegion.mount(app);

  const pacedMode = new ScreenReaderPacedMode();
  pacedMode.mountControl(app);

  // --- Yearly View ---
  const yearlyView = new YearlyView();

  // --- Episode Browser ---
  const episodeBrowser = new EpisodeBrowser();
  const episodeContainer = document.createElement("div");
  episodeContainer.className = "episode-browser-container";
  episodeContainer.style.display = "none";
  app.appendChild(episodeContainer);

  // --- Artist Timeline ---
  const artistTimeline = new ArtistTimeline();
  const artistTimelineContainer = document.createElement("div");
  artistTimelineContainer.className = "artist-timeline-container";
  artistTimelineContainer.style.display = "none";
  app.appendChild(artistTimelineContainer);

  // Wire episode link clicks from artist timeline → switch to episodes view
  artistTimeline.onEpisodeClick = (source, _episode, _date) => {
    filterStateManager.update({ view: "episodes", source });
  };

  // --- Helper: switch between line, yearly, episodes, and artist-timeline views ---
  function switchView(mode: "line" | "yearly" | "episodes" | "artist-timeline"): void {
    if (mode === "yearly") {
      if (playbackController.isPlaying()) {
        playbackController.pause();
      }
      chartContainer.style.display = "none";
      episodeContainer.style.display = "none";
      artistTimelineContainer.style.display = "none";
      episodeBrowser.unmount();
      artistTimeline.unmount();
      const playbackControls = app!.querySelector(".playback-controls") as HTMLElement | null;
      if (playbackControls) playbackControls.style.display = "none";

      const state = filterStateManager.getState();
      // Mount only if not already mounted
      if (!app!.querySelector(".yearly-view")) {
        yearlyView.mount(app!, dataStore);
      }
      yearlyView.setDisplayMode(state.displayMode);
      yearlyView.setGenerationFilter(state.generation);
      yearlyView.setSourceFilter(state.source);
      yearlyView.setMetric(state.metric);
      yearlyView.setZoom(state.zoom === 10 ? 10 : "all");
    } else if (mode === "episodes") {
      if (playbackController.isPlaying()) {
        playbackController.pause();
      }
      yearlyView.unmount();
      artistTimeline.unmount();
      chartContainer.style.display = "none";
      artistTimelineContainer.style.display = "none";
      const playbackControls = app!.querySelector(".playback-controls") as HTMLElement | null;
      if (playbackControls) playbackControls.style.display = "none";

      episodeContainer.style.display = "";
      const state = filterStateManager.getState();
      episodeBrowser.mount(episodeContainer, dataStore);
      episodeBrowser.setSourceFilter(state.source);
      episodeBrowser.onArtistClick = (artistId: string) => {
        filterStateManager.update({ artist: artistId, view: "artist-timeline" });
      };
    } else if (mode === "artist-timeline") {
      if (playbackController.isPlaying()) {
        playbackController.pause();
      }
      yearlyView.unmount();
      episodeBrowser.unmount();
      episodeContainer.style.display = "none";
      chartContainer.style.display = "none";
      const playbackControls = app!.querySelector(".playback-controls") as HTMLElement | null;
      if (playbackControls) playbackControls.style.display = "none";

      artistTimelineContainer.style.display = "";
      const state = filterStateManager.getState();
      if (state.artist !== "all") {
        artistTimeline.mount(artistTimelineContainer, dataStore, state.artist);
      } else {
        artistTimeline.unmount();
        artistTimelineContainer.innerHTML = `<div class="artist-timeline__prompt">Select an artist from the dropdown above to view their timeline.</div>`;
      }
    } else {
      yearlyView.unmount();
      episodeBrowser.unmount();
      artistTimeline.unmount();
      episodeContainer.style.display = "none";
      artistTimelineContainer.style.display = "none";
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
      // Only update filters (don't re-mount if already in yearly)
      return;
    }

    if (currentView === "episodes") {
      switchView("episodes");
      episodeBrowser.setSourceFilter(state.source);
      return;
    }

    if (currentView === "artist-timeline") {
      switchView("artist-timeline");
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
    if (lineChart.isPlaying()) {
      playbackController.syncTo(date);
      return;
    }
    const index = lineChart.getDateIndex(date);
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

  // reset → handled by animation (starts from -1)
  eventBus.on("reset", () => {
    if (!lineChart.isPlaying()) {
      lineChart.setDateIndex(0);
    }
  });

  // line:hover → controller handles tooltip internally now
  eventBus.on("line:hover", () => {
    // Tooltip managed by LineChartController
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

  // =========================================================
  // Phase 7: Polish — Keyboard Shortcuts
  // =========================================================

  const SPEED_PRESETS: Record<string, number> = {
    "1": 0.5,
    "2": 0.8,
    "3": 1.0,
    "4": 1.5,
    "5": 2.0,
  };

  document.addEventListener("keydown", (e) => {
    // Don't trigger shortcuts when typing in inputs/textareas
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
      return;
    }

    switch (e.key) {
      case " ": {
        e.preventDefault();
        if (playbackController.isPlaying()) {
          playbackController.pause();
        } else {
          playbackController.play();
        }
        break;
      }
      case "ArrowLeft": {
        if (!playbackController.isPlaying()) {
          e.preventDefault();
          const currentIdx = lineChart.getDateIndex(
            lineChart.getViewportState().currentDate
          );
          if (currentIdx > 0) {
            lineChart.setDateIndex(currentIdx - 1);
            const newDate = dataStore.dates[currentIdx - 1];
            if (newDate) {
              playbackController.syncTo(newDate);
            }
          }
        }
        break;
      }
      case "ArrowRight": {
        if (!playbackController.isPlaying()) {
          e.preventDefault();
          const currentIdx = lineChart.getDateIndex(
            lineChart.getViewportState().currentDate
          );
          if (currentIdx < dataStore.dates.length - 1) {
            lineChart.setDateIndex(currentIdx + 1);
            const newDate = dataStore.dates[currentIdx + 1];
            if (newDate) {
              playbackController.syncTo(newDate);
            }
          }
        }
        break;
      }
      case "Escape": {
        // Close popover / disambiguation at main level
        lineChart.clearSelection();
        break;
      }
      default: {
        // Speed control: 1-5 keys while playing
        if (SPEED_PRESETS[e.key] !== undefined && playbackController.isPlaying()) {
          lineChart.setSpeed(SPEED_PRESETS[e.key]);
        }
        break;
      }
    }
  });

  // =========================================================
  // Phase 7: Polish — URL State Encoding
  // =========================================================

  const DEFAULT_FILTER_VALUES: Partial<FilterState> = {
    view: "line",
    generation: "all",
    source: "all",
    artist: "all",
    displayMode: "songs",
  };

  /** Encode current filter state into URL hash */
  function encodeStateToHash(state: FilterState): string {
    const params: string[] = [];
    if (state.view !== DEFAULT_FILTER_VALUES.view) params.push(`view=${state.view}`);
    if (state.generation !== DEFAULT_FILTER_VALUES.generation) params.push(`gen=${state.generation}`);
    if (state.source !== DEFAULT_FILTER_VALUES.source) params.push(`source=${state.source}`);
    if (state.artist !== DEFAULT_FILTER_VALUES.artist) params.push(`artist=${state.artist}`);
    if (state.displayMode !== DEFAULT_FILTER_VALUES.displayMode) params.push(`mode=${state.displayMode}`);
    return params.length > 0 ? `#${params.join("&")}` : "";
  }

  /** Parse URL hash into partial filter state */
  function parseHashToState(hash: string): Partial<FilterState> {
    const partial: Partial<FilterState> = {};
    if (!hash || hash === "#") return partial;

    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    const pairs = raw.split("&");
    for (const pair of pairs) {
      const [key, value] = pair.split("=");
      if (!key || !value) continue;
      switch (key) {
        case "view":
          if (["line", "race", "yearly", "episodes", "artist-timeline"].includes(value)) {
            partial.view = value as FilterState["view"];
          }
          break;
        case "gen":
          partial.generation = value === "all" ? "all" : parseInt(value, 10);
          break;
        case "source":
          partial.source = value;
          break;
        case "artist":
          partial.artist = value;
          break;
        case "mode":
          if (value === "songs" || value === "artists") {
            partial.displayMode = value;
          }
          break;
      }
    }
    return partial;
  }

  // On load: apply hash state
  const initialHashState = parseHashToState(window.location.hash);
  if (Object.keys(initialHashState).length > 0) {
    filterStateManager.update(initialHashState);
  }

  // On filter:change: update URL hash
  eventBus.on("filter:change", (state: FilterState) => {
    const newHash = encodeStateToHash(state);
    const currentPath = window.location.pathname + window.location.search;
    history.replaceState(null, "", currentPath + newHash);
  });

  // =========================================================
  // Phase 7: Polish — Accessibility Announcements
  // =========================================================

  /** Human-readable labels for views */
  const VIEW_LABELS: Record<string, string> = {
    line: "Line Chart",
    race: "Race",
    yearly: "Yearly Summary",
    episodes: "Episode Browser",
    "artist-timeline": "Artist Timeline",
  };

  let previousView: string = filterStateManager.getState().view;
  let previousGeneration: number | "all" = filterStateManager.getState().generation;
  let previousSource: string = filterStateManager.getState().source;

  eventBus.on("filter:change", (state: FilterState) => {
    // Announce view changes
    if (state.view !== previousView) {
      const label = VIEW_LABELS[state.view] ?? state.view;
      liveRegion.announce(`Switched to ${label} view`);
      previousView = state.view;
    }
    // Announce generation filter changes
    if (state.generation !== previousGeneration) {
      if (state.generation === "all") {
        liveRegion.announce("Showing all generations");
      } else {
        liveRegion.announce(`Filtered to Gen ${state.generation}`);
      }
      previousGeneration = state.generation;
    }
    // Announce source filter changes
    if (state.source !== previousSource) {
      if (state.source === "all") {
        liveRegion.announce("Showing all sources");
      } else {
        const sourceLabel = state.source.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        liveRegion.announce(`Source: ${sourceLabel}`);
      }
      previousSource = state.source;
    }
  });
}

main();
