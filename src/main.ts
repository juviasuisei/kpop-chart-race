/**
 * K-Pop Chart Race — Application Entry Point
 *
 * Wires all components together: data loading, chart engine, renderer,
 * playback controls, zoom selector, detail panel, and accessibility features.
 */

import "./style.css";

import { EventBus } from "./event-bus.ts";
import { loadAll } from "./data-loader.ts";
import { computeSnapshot, computeChartWins } from "./chart-engine.ts";
import { LoadingScreen } from "./loading-screen.ts";
import { ChartRaceRenderer } from "./chart-race-renderer.ts";
import { PlaybackController } from "./playback-controller.ts";
import { ZoomSelector } from "./zoom-selector.ts";
import { DetailPanel } from "./detail-panel.ts";
import { LiveRegionAnnouncer } from "./live-region.ts";
import { ScreenReaderPacedMode } from "./screen-reader-paced-mode.ts";
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
    dataStore = await loadAll("data");

    if (dataStore.artists.size === 0) {
      loadingScreen.onError("No chart data available.");
      return;
    }

    // Compute chart wins and attach to dataStore
    dataStore.chartWins = computeChartWins(dataStore);

    loadingScreen.onFileProgress(
      dataStore.artists.size,
      dataStore.artists.size,
      Array.from(dataStore.artists.values()).map((a) => a.name),
    );
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
  renderer.setDataNote(dataStore.startDate);

  const playbackController = new PlaybackController(eventBus, dataStore.dates);
  playbackController.mount(app);

  const zoomSelector = new ZoomSelector(eventBus);
  zoomSelector.mount(app);

  const detailPanel = new DetailPanel(eventBus);

  const liveRegion = new LiveRegionAnnouncer();
  liveRegion.mount(app);

  const pacedMode = new ScreenReaderPacedMode();
  pacedMode.mountControl(app);

  // --- EventBus wiring ---

  // date:change → compute snapshot → emit state:updated
  eventBus.on("date:change", (date: string) => {
    previousSnapshot = currentSnapshot;
    currentSnapshot = computeSnapshot(date, dataStore, previousSnapshot);
    eventBus.emit("state:updated", currentSnapshot);
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

  // zoom:change → re-render with new zoom level
  eventBus.on("zoom:change", (level: ZoomLevel) => {
    currentZoom = level;
    if (currentSnapshot) {
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
  });

  // pause → auto-open detail panel for top-ranked artist
  eventBus.on("pause", () => {
    if (currentSnapshot && currentSnapshot.entries.length > 0) {
      const topArtistId = currentSnapshot.entries[0].artistId;
      detailPanel.open(topArtistId, dataStore, currentSnapshot.date, 1);
    }
  });

  // play → auto-close detail panel
  eventBus.on("play", () => {
    if (detailPanel.isOpen()) {
      detailPanel.close();
    }
  });

  // click-outside → close detail panel when clicking empty chart space
  const chartRaceEl = app.querySelector(".chart-race");
  if (chartRaceEl) {
    chartRaceEl.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      // Only skip if clicking the colored bar, value text, or release text
      if (target.closest(".chart-race__bar") || target.classList.contains("bar__value") || target.classList.contains("bar__release") || target.classList.contains("bar__name")) return;
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
    });
  }
}

main();
