/**
 * K-Pop Chart Race — Application Entry Point
 *
 * Wires all components together: data loading, chart engine, renderer,
 * playback controls, zoom selector, detail panel, and accessibility features.
 */

import "./style.css";

import { EventBus } from "./event-bus.ts";
import { loadFromAirtable } from "./airtable/data-adapter.ts";
import { computeSnapshot, computeChartWins } from "./chart-engine.ts";
import { LoadingScreen } from "./loading-screen.ts";
import { ChartRaceRenderer } from "./chart-race-renderer.ts";
import { PlaybackController } from "./playback-controller.ts";
import { ZoomSelector } from "./zoom-selector.ts";
import { DetailPanel } from "./detail-panel.ts";
import { LiveRegionAnnouncer } from "./live-region.ts";
import { ScreenReaderPacedMode } from "./screen-reader-paced-mode.ts";
import { YearlyView } from "./yearly-view.ts";
import type { YearlyMetric } from "./yearly-view.ts";
import type { ChartSnapshot, DataStore } from "./models.ts";
import type { ZoomLevel } from "./types.ts";

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
  let currentZoom: ZoomLevel = 10;

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

  const zoomSelector = new ZoomSelector(eventBus);
  zoomSelector.mount(app);

  const detailPanel = new DetailPanel(eventBus);

  const liveRegion = new LiveRegionAnnouncer();
  liveRegion.mount(app);

  const pacedMode = new ScreenReaderPacedMode();
  pacedMode.mountControl(app);

  // --- View Switcher ---
  type ViewMode = "race" | "yearly";
  let currentView: ViewMode = "race";
  const yearlyView = new YearlyView();

  const viewSwitcher = document.createElement("div");
  viewSwitcher.className = "view-switcher";
  viewSwitcher.setAttribute("role", "switch");
  viewSwitcher.setAttribute("aria-label", "View mode");
  viewSwitcher.tabIndex = 0;

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

  viewSwitcher.appendChild(yearlyLabel);
  viewSwitcher.appendChild(track);
  viewSwitcher.appendChild(raceLabel);

  viewSwitcher.addEventListener("click", () => {
    switchView(currentView === "race" ? "yearly" : "race");
  });
  viewSwitcher.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      switchView(currentView === "race" ? "yearly" : "race");
    }
  });

  // Insert view switcher into the top bar, before the date (grouped on the right)
  const topBar = app.querySelector(".chart-race__top-bar");
  const dateDisplay2 = app.querySelector(".chart-race__date");

  // --- Metric Toggle (Points/Wins) — only visible in yearly mode ---
  const metricSwitcher = document.createElement("div");
  metricSwitcher.className = "view-switcher";
  metricSwitcher.setAttribute("role", "switch");
  metricSwitcher.setAttribute("aria-label", "Yearly metric");
  metricSwitcher.tabIndex = 0;
  metricSwitcher.style.display = "none"; // hidden by default (race mode)

  const winsLabel = document.createElement("span");
  winsLabel.className = "view-switcher__label";
  winsLabel.textContent = "Wins";

  const metricTrack = document.createElement("div");
  metricTrack.className = "view-switcher__track view-switcher__track--on";
  const metricThumb = document.createElement("div");
  metricThumb.className = "view-switcher__thumb";
  metricTrack.appendChild(metricThumb);

  const pointsLabel = document.createElement("span");
  pointsLabel.className = "view-switcher__label view-switcher__label--active";
  pointsLabel.textContent = "Points";

  metricSwitcher.appendChild(winsLabel);
  metricSwitcher.appendChild(metricTrack);
  metricSwitcher.appendChild(pointsLabel);

  metricSwitcher.addEventListener("click", () => {
    const newMetric: YearlyMetric = yearlyView.getMetric() === "points" ? "wins" : "points";
    yearlyView.setMetric(newMetric);
    const isPoints = newMetric === "points";
    metricTrack.classList.toggle("view-switcher__track--on", isPoints);
    pointsLabel.classList.toggle("view-switcher__label--active", isPoints);
    winsLabel.classList.toggle("view-switcher__label--active", !isPoints);
  });
  metricSwitcher.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      metricSwitcher.click();
    }
  });

  // --- Source Filter Dropdown — only visible in yearly mode ---
  const sourceSelect = document.createElement("select");
  sourceSelect.className = "yearly-source-filter";
  sourceSelect.style.display = "none";
  sourceSelect.setAttribute("aria-label", "Filter by chart source");

  const sourceOptions: Array<{ value: string; label: string }> = [
    { value: "all", label: "All Shows" },
    { value: "inkigayo", label: "SBS Inkigayo" },
    { value: "the_show", label: "SBS The Show" },
    { value: "show_champion", label: "MBC M Show Champion" },
    { value: "music_bank", label: "KBS Music Bank" },
    { value: "m_countdown", label: "Mnet M Countdown" },
    { value: "show_music_core", label: "MBC Show! Music Core" },
  ];

  for (const opt of sourceOptions) {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    sourceSelect.appendChild(option);
  }

  sourceSelect.addEventListener("change", () => {
    yearlyView.setSourceFilter(sourceSelect.value);
  });

  // --- Yearly Zoom Toggle (synced copy of the playback controls zoom toggle) ---
  const yearlyZoomToggle = document.createElement("div");
  yearlyZoomToggle.className = "view-switcher";
  yearlyZoomToggle.setAttribute("role", "switch");
  yearlyZoomToggle.setAttribute("aria-label", "Toggle between 10 and All artists");
  yearlyZoomToggle.tabIndex = 0;
  yearlyZoomToggle.style.display = "none"; // hidden by default (race mode)

  const yzAllLabel = document.createElement("span");
  yzAllLabel.className = "view-switcher__label";
  yzAllLabel.textContent = "All";

  const yzTrack = document.createElement("div");
  yzTrack.className = "view-switcher__track view-switcher__track--on";
  const yzThumb = document.createElement("div");
  yzThumb.className = "view-switcher__thumb";
  yzTrack.appendChild(yzThumb);

  const yz10Label = document.createElement("span");
  yz10Label.className = "view-switcher__label view-switcher__label--active";
  yz10Label.textContent = "10";

  yearlyZoomToggle.appendChild(yzAllLabel);
  yearlyZoomToggle.appendChild(yzTrack);
  yearlyZoomToggle.appendChild(yz10Label);

  function syncYearlyZoomVisual(): void {
    const isTen = currentZoom === 10;
    yzTrack.classList.toggle("view-switcher__track--on", isTen);
    yz10Label.classList.toggle("view-switcher__label--active", isTen);
    yzAllLabel.classList.toggle("view-switcher__label--active", !isTen);
  }

  yearlyZoomToggle.addEventListener("click", () => {
    // Toggle zoom via the event bus (syncs both toggles)
    const newLevel: ZoomLevel = currentZoom === 10 ? "all" : 10;
    eventBus.emit("zoom:change", newLevel);
  });
  yearlyZoomToggle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      yearlyZoomToggle.click();
    }
  });

  if (topBar && dateDisplay2) {
    // Wrap toggles + date in a right-side group
    const rightGroup = document.createElement("div");
    rightGroup.className = "chart-race__right-group";
    rightGroup.appendChild(sourceSelect);
    rightGroup.appendChild(yearlyZoomToggle);
    rightGroup.appendChild(metricSwitcher);
    rightGroup.appendChild(viewSwitcher);
    rightGroup.appendChild(dateDisplay2);
    topBar.appendChild(rightGroup);
  } else if (topBar) {
    topBar.appendChild(sourceSelect);
    topBar.appendChild(yearlyZoomToggle);
    topBar.appendChild(metricSwitcher);
    topBar.appendChild(viewSwitcher);
  }

  function switchView(mode: ViewMode): void {
    if (mode === currentView) return;
    currentView = mode;

    // Update toggle appearance
    const isRace = mode === "race";
    track.classList.toggle("view-switcher__track--on", isRace);
    raceLabel.classList.toggle("view-switcher__label--active", isRace);
    yearlyLabel.classList.toggle("view-switcher__label--active", !isRace);
    viewSwitcher.setAttribute("aria-checked", String(isRace));

    // Show/hide metric toggle and source filter
    metricSwitcher.style.display = isRace ? "none" : "";
    sourceSelect.style.display = isRace ? "none" : "";

    if (mode === "yearly") {
      // Pause playback if running
      if (playbackController.isPlaying()) {
        playbackController.pause();
      }
      if (detailPanel.isOpen()) {
        detailPanel.close();
      }
      // Update date display to show year range
      const startYear = dataStore.startDate.substring(0, 4);
      const endYear = dataStore.endDate.substring(0, 4);
      if (dateDisplay2) {
        (dateDisplay2 as HTMLElement).textContent = `${startYear} – ${endYear}`;
      }
      // Hide race-specific elements (keep top bar and legend visible)
      const barsContainer = app!.querySelector(".chart-race__bars") as HTMLElement | null;
      const playbackControls = app!.querySelector(".playback-controls") as HTMLElement | null;
      if (barsContainer) barsContainer.style.display = "none";
      if (playbackControls) playbackControls.style.display = "none";
      // Show the yearly zoom copy
      yearlyZoomToggle.style.display = "";
      // Mount yearly view inside the chart-race container with current zoom
      yearlyView.setZoom(currentZoom === 10 ? 10 : "all");
      const chartRaceWrapper = app!.querySelector(".chart-race") as HTMLElement | null;
      if (chartRaceWrapper) {
        yearlyView.mount(chartRaceWrapper, dataStore);
      }
    } else {
      // Unmount yearly view
      yearlyView.unmount();
      // Restore date display to current snapshot date
      if (dateDisplay2 && currentSnapshot) {
        (dateDisplay2 as HTMLElement).textContent = currentSnapshot.date;
      }
      // Show race elements
      const barsContainer = app!.querySelector(".chart-race__bars") as HTMLElement | null;
      const playbackControls = app!.querySelector(".playback-controls") as HTMLElement | null;
      if (barsContainer) barsContainer.style.display = "";
      if (playbackControls) playbackControls.style.display = "";
      // Hide the yearly zoom copy
      yearlyZoomToggle.style.display = "none";
      // Re-render race view with current zoom
      if (currentSnapshot) {
        renderer.update(currentSnapshot, currentZoom, dataStore);
      }
      // Hide the yearly zoom copy
      yearlyZoomToggle.style.display = "none";
      renderer.recheckOverflow();
    }
  }

  // --- EventBus wiring ---

  // date:change → compute snapshot → emit state:updated
  // Close detail panel if open (user is scrubbing or playback advanced)
  eventBus.on("date:change", (date: string) => {
    if (detailPanel.isOpen()) {
      detailPanel.close();
    }
    previousSnapshot = currentSnapshot;
    currentSnapshot = computeSnapshot(date, dataStore, previousSnapshot);
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

  // zoom:change → re-render with new zoom level, sync yearly toggle, close detail panel
  eventBus.on("zoom:change", (level: ZoomLevel) => {
    currentZoom = level;
    syncYearlyZoomVisual();
    if (currentView === "yearly") {
      yearlyView.setZoom(currentZoom === 10 ? 10 : "all");
    }
    if (detailPanel.isOpen()) {
      detailPanel.close();
    }
    if (currentSnapshot && currentView === "race") {
      renderer.update(currentSnapshot, currentZoom, dataStore);
    }
  });

  // bar:click → freeze-then-resolve: pause if playing, then open detail panel
  eventBus.on("bar:click", (artistId: string) => {
    if (playbackController.isPlaying()) {
      playbackController.pause();
    }
    const rank = currentSnapshot?.entries.find(e => e.artistId === artistId)?.rank;
    detailPanel.open(artistId, dataStore, currentSnapshot?.date, rank);
    renderer.recheckOverflow();
  });

  // pause → auto-open detail panel for top-ranked artist
  eventBus.on("pause", () => {
    if (currentSnapshot && currentSnapshot.entries.length > 0) {
      const topArtistId = currentSnapshot.entries[0].artistId;
      detailPanel.open(topArtistId, dataStore, currentSnapshot.date, 1);
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
      // Skip if clicking actual bar content (not the wrapper itself — the
      // wrapper spans the full row, so direct clicks on it are whitespace).
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
            const topArtistId = currentSnapshot.entries[0].artistId;
            detailPanel.open(topArtistId, dataStore, currentSnapshot.date, 1);
            renderer.recheckOverflow();
          }
        };
        eventBus.on("update:complete", onInitialComplete);
      }
    });
  }
}

main();
