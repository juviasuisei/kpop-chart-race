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
    dataStore = await loadAll("data", (loaded, total, name) => {
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

  // zoom:change → re-render with new zoom level and close detail panel
  eventBus.on("zoom:change", (level: ZoomLevel) => {
    currentZoom = level;
    if (detailPanel.isOpen()) {
      detailPanel.close();
    }
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
    });
  }
}

main();
