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
    loadingScreen.onComplete();
  } catch (_err) {
    loadingScreen.onError(
      "Unable to load chart data. Please try refreshing the page.",
    );
    return;
  }

  // --- Mount UI components ---
  const renderer = new ChartRaceRenderer(eventBus);
  renderer.mount(app);

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
    renderer.update(snapshot, currentZoom);

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
      renderer.update(currentSnapshot, currentZoom);
    }
  });

  // bar:click → freeze-then-resolve: pause if playing, then open detail panel
  eventBus.on("bar:click", (artistId: string) => {
    if (playbackController.isPlaying()) {
      playbackController.pause();
    }
    detailPanel.open(artistId, dataStore);
  });

  // pause → auto-open detail panel for top-ranked artist
  eventBus.on("pause", () => {
    if (currentSnapshot && currentSnapshot.entries.length > 0) {
      const topArtistId = currentSnapshot.entries[0].artistId;
      detailPanel.open(topArtistId, dataStore);
    }
  });

  // play → auto-close detail panel
  eventBus.on("play", () => {
    if (detailPanel.isOpen()) {
      detailPanel.close();
    }
  });

  // --- Initial render ---
  // Emit the first date:change to render the initial state (app starts paused)
  if (dataStore.dates.length > 0) {
    eventBus.emit("date:change", dataStore.dates[0]);
  }
}

main();
