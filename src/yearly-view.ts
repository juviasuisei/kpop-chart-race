/**
 * Yearly View — shows a grid of per-year top-10 bar charts.
 * Each cell displays the top 10 artists by total points earned that year,
 * along with their win count. No animation, no playback — just static bars.
 * All years share the same scale (global max) for at-a-glance comparison.
 */

import type { DataStore, ResolvedArtist } from "./models.ts";
import type { ArtistType } from "./types.ts";
import { ARTIST_TYPE_COLORS } from "./colors.ts";
import { resolveArtists } from "./co-artist-resolver.ts";
import { generateFallbackLogoDataUri } from "./utils.ts";

/** Secondary indicator icons per ArtistType */
const ARTIST_TYPE_INDICATORS: Record<ArtistType, string> = {
  boy_group: "▲",
  girl_group: "●",
  solo_male: "◆",
  solo_female: "★",
  mixed_group: "■",
};

interface YearlyArtistEntry {
  artistId: string;
  name: string;
  logoUrl: string;
  artistType: string;
  points: number;
  wins: number;
  appearances: number;
}

/** Entry for Songs mode: one per release */
interface YearlySongEntry {
  releaseKey: string;
  title: string;
  logoUrl: string;
  logoUrls: string[];
  artistNames: string[];
  artistType: string;
  points: number;
  wins: number;
  appearances: number;
  coArtists: ResolvedArtist[];
}

export type YearlyMetric = "points" | "wins" | "appearances";

/** Sentinel year value representing the all-time aggregate across all years */
const ALL_TIME = "all-time" as const;
type YearOrAllTime = number | typeof ALL_TIME;

export class YearlyView {
  private wrapper: HTMLDivElement | null = null;
  private dataStore: DataStore | null = null;
  private metric: YearlyMetric = "points";
  private sourceFilter: string = "all";
  private zoom: "all" | 10 = 10;
  private displayMode: "songs" | "artists" = "artists";
  private generationFilter: number | "all" = "all";
  private artistFilter: string = "all";

  mount(container: HTMLElement, dataStore: DataStore): void {
    this.dataStore = dataStore;
    this.wrapper = document.createElement("div");
    this.wrapper.className = "yearly-view";
    this.render();
    container.appendChild(this.wrapper);
  }

  unmount(): void {
    if (this.wrapper && this.wrapper.parentElement) {
      this.wrapper.parentElement.removeChild(this.wrapper);
    }
    this.wrapper = null;
  }

  setMetric(metric: YearlyMetric): void {
    if (metric === this.metric) return;
    this.metric = metric;
    this.render();
  }

  getMetric(): YearlyMetric {
    return this.metric;
  }

  setSourceFilter(source: string): void {
    if (source === this.sourceFilter) return;
    this.sourceFilter = source;
    this.render();
  }

  getSourceFilter(): string {
    return this.sourceFilter;
  }

  setZoom(zoom: "all" | 10): void {
    const newZoom = zoom === "all" ? "all" : 10;
    if (newZoom === this.zoom) return;
    this.zoom = newZoom;
    this.render();
  }

  getZoom(): "all" | 10 {
    return this.zoom;
  }

  setDisplayMode(mode: "songs" | "artists"): void {
    if (mode === this.displayMode) return;
    this.displayMode = mode;
    this.render();
  }

  getDisplayMode(): "songs" | "artists" {
    return this.displayMode;
  }

  setGenerationFilter(generation: number | "all"): void {
    if (generation === this.generationFilter) return;
    this.generationFilter = generation;
    this.render();
  }

  getGenerationFilter(): number | "all" {
    return this.generationFilter;
  }

  setArtistFilter(artist: string): void {
    if (artist === this.artistFilter) return;
    this.artistFilter = artist;
    this.render();
  }

  getArtistFilter(): string {
    return this.artistFilter;
  }

  private render(): void {
    if (!this.wrapper || !this.dataStore) return;
    this.wrapper.innerHTML = "";

    const years = this.getYears();
    // Prepend an all-time aggregate across all years, but only when there is
    // more than one year of data (otherwise all-time == the single year).
    const columns: YearOrAllTime[] = years.length > 1 ? [ALL_TIME, ...years] : years;

    if (this.zoom === "all") {
      this.wrapper.className = "yearly-view yearly-view--treemap";
      if (this.displayMode === "songs") {
        this.renderStackedSongs(columns);
      } else {
        this.renderStacked(columns);
      }
    } else {
      this.wrapper.className = "yearly-view";
      if (this.displayMode === "songs") {
        this.renderGridSongs(columns);
      } else {
        this.renderGrid(columns);
      }
    }
  }

  /** Human-readable heading for a year column (all-time gets a special label) */
  private columnLabel(year: YearOrAllTime): string {
    return year === ALL_TIME ? "All-Time" : String(year);
  }

  private renderGrid(years: YearOrAllTime[]): void {
    if (!this.wrapper || !this.dataStore) return;
    const yearData = new Map<YearOrAllTime, YearlyArtistEntry[]>();

    // Compute data for all columns (all-time is aggregated across every year)
    for (const year of years) {
      const entries = this.computeYearData(year, year === ALL_TIME ? Infinity : 10);
      yearData.set(year, entries.slice(0, 10));
    }

    // Find global max based on current metric
    let globalMax = 0;
    for (const entries of yearData.values()) {
      if (entries.length > 0) {
        const topValue = this.metricValueOf(entries[0]);
        if (topValue > globalMax) globalMax = topValue;
      }
    }

    for (const year of years) {
      const entries = yearData.get(year) ?? [];
      const cell = this.createYearCell(year, entries, globalMax);
      if (year === ALL_TIME) cell.classList.add("yearly-view__cell--all-time");
      this.wrapper.appendChild(cell);
    }
  }

  private renderStacked(years: YearOrAllTime[]): void {
    if (!this.wrapper || !this.dataStore) return;

    for (const year of years) {
      const entries = this.computeYearData(year, Infinity);
      if (entries.length === 0) continue;

      const yearBlock = document.createElement("div");
      yearBlock.className = "yearly-treemap__block";
      if (year === ALL_TIME) yearBlock.classList.add("yearly-treemap__block--all-time");

      const heading = document.createElement("h3");
      heading.className = "yearly-treemap__year";
      heading.textContent = this.columnLabel(year);
      yearBlock.appendChild(heading);

      const mapContainer = document.createElement("div");
      mapContainer.className = "yearly-treemap__map";
      yearBlock.appendChild(mapContainer);

      // Compute treemap layout after DOM insertion so we can measure
      this.wrapper.appendChild(yearBlock);

      // Use requestAnimationFrame to measure after layout
      requestAnimationFrame(() => {
        const width = mapContainer.clientWidth;
        const height = mapContainer.clientHeight;
        if (width === 0 || height === 0) return;

        const values = entries.map(e => this.metricValueOf(e));
        const rects = squarify(values, width, height);

        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const rect = rects[i];
          const value = this.metricValueOf(entry);
          if (value === 0) continue;

          const cell = document.createElement("div");
          cell.className = "yearly-treemap__cell";
          cell.style.left = `${rect.x}px`;
          cell.style.top = `${rect.y}px`;
          cell.style.width = `${rect.w}px`;
          cell.style.height = `${rect.h}px`;
          cell.style.backgroundColor = ARTIST_TYPE_COLORS[entry.artistType as keyof typeof ARTIST_TYPE_COLORS] ?? "#555";

          // Logo
          const logo = document.createElement("img");
          logo.className = "yearly-treemap__logo";
          logo.src = entry.logoUrl;
          logo.alt = entry.name;
          logo.onerror = () => {
            const artist = this.dataStore?.artists.get(entry.artistId);
            logo.src = generateFallbackLogoDataUri(artist?.koreanName ?? entry.name);
          };
          cell.appendChild(logo);

          // Tooltip on hover
          const rank = i + 1;
          const indicator = ARTIST_TYPE_INDICATORS[entry.artistType as ArtistType] ?? "";
          const tooltipText = this.metric === "wins"
            ? `#${rank} · ${entry.name} ${indicator} · ${entry.wins} ${entry.wins === 1 ? "win" : "wins"}`
            : this.metric === "appearances"
            ? `#${rank} · ${entry.name} ${indicator} · ${entry.appearances} ${entry.appearances === 1 ? "appearance" : "appearances"}`
            : `#${rank} · ${entry.name} ${indicator} · ${entry.points.toLocaleString()} pts`;

          cell.addEventListener("mouseenter", () => {
            let tooltip = document.querySelector(".yearly-treemap__tooltip") as HTMLElement | null;
            if (!tooltip) {
              tooltip = document.createElement("div");
              tooltip.className = "yearly-treemap__tooltip";
              document.body.appendChild(tooltip);
            }
            tooltip.textContent = tooltipText;
            tooltip.style.display = "block";
            const cellRect = cell.getBoundingClientRect();
            let left = cellRect.left + cellRect.width / 2;
            const top = cellRect.top - 6;
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            // Clamp to viewport
            const tipRect = tooltip.getBoundingClientRect();
            if (tipRect.right > window.innerWidth - 8) {
              tooltip.style.left = `${window.innerWidth - 8 - tipRect.width / 2}px`;
            }
            if (tipRect.left < 8) {
              tooltip.style.left = `${8 + tipRect.width / 2}px`;
            }
          });
          cell.addEventListener("mouseleave", () => {
            const tooltip = document.querySelector(".yearly-treemap__tooltip") as HTMLElement | null;
            if (tooltip) tooltip.style.display = "none";
          });

          mapContainer.appendChild(cell);
        }
      });
    }
  }

  /** Songs mode: grid with release-level entries ("Top 10" zoom) */
  private renderGridSongs(years: YearOrAllTime[]): void {
    if (!this.wrapper || !this.dataStore) return;
    const yearData = new Map<YearOrAllTime, YearlySongEntry[]>();

    for (const year of years) {
      const entries = this.computeYearDataSongs(year, year === ALL_TIME ? Infinity : 10);
      yearData.set(year, entries.slice(0, 10));
    }

    let globalMax = 0;
    for (const entries of yearData.values()) {
      if (entries.length > 0) {
        const topValue = this.metricValueOf(entries[0]);
        if (topValue > globalMax) globalMax = topValue;
      }
    }

    for (const year of years) {
      const entries = yearData.get(year) ?? [];
      const cell = this.createYearCellSongs(year, entries, globalMax);
      if (year === ALL_TIME) cell.classList.add("yearly-view__cell--all-time");
      this.wrapper.appendChild(cell);
    }
  }

  /** Songs mode: treemap with per-release cells ("All" zoom) */
  private renderStackedSongs(years: YearOrAllTime[]): void {
    if (!this.wrapper || !this.dataStore) return;

    for (const year of years) {
      const entries = this.computeYearDataSongs(year, Infinity);
      if (entries.length === 0) continue;

      const yearBlock = document.createElement("div");
      yearBlock.className = "yearly-treemap__block";
      if (year === ALL_TIME) yearBlock.classList.add("yearly-treemap__block--all-time");

      const heading = document.createElement("h3");
      heading.className = "yearly-treemap__year";
      heading.textContent = this.columnLabel(year);
      yearBlock.appendChild(heading);

      const mapContainer = document.createElement("div");
      mapContainer.className = "yearly-treemap__map";
      yearBlock.appendChild(mapContainer);

      this.wrapper.appendChild(yearBlock);

      const capturedEntries = entries;
      requestAnimationFrame(() => {
        const width = mapContainer.clientWidth;
        const height = mapContainer.clientHeight;
        if (width === 0 || height === 0) return;

        const values = capturedEntries.map(e => this.metricValueOf(e));
        const rects = squarify(values, width, height);

        for (let i = 0; i < capturedEntries.length; i++) {
          const entry = capturedEntries[i];
          const rect = rects[i];
          const value = this.metricValueOf(entry);
          if (value === 0) continue;

          const cell = document.createElement("div");
          cell.className = "yearly-treemap__cell";
          cell.style.left = `${rect.x}px`;
          cell.style.top = `${rect.y}px`;
          cell.style.width = `${rect.w}px`;
          cell.style.height = `${rect.h}px`;
          const primaryType = entry.coArtists.length > 0
            ? entry.coArtists[0].artistType
            : entry.artistType;
          cell.style.backgroundColor = ARTIST_TYPE_COLORS[primaryType as keyof typeof ARTIST_TYPE_COLORS] ?? "#555";

          // Render all artist logos (multi-artist: side by side)
          for (let logoIdx = 0; logoIdx < entry.logoUrls.length; logoIdx++) {
            const logoUrl = entry.logoUrls[logoIdx];
            const coArtist = entry.coArtists[logoIdx];
            const logo = document.createElement("img");
            logo.className = "yearly-treemap__logo";
            logo.src = logoUrl;
            logo.alt = entry.title;
            logo.onerror = () => {
              const artistData = coArtist ? this.dataStore?.artists.get(coArtist.id) : undefined;
              const fallbackName = artistData?.koreanName ?? coArtist?.name ?? entry.title;
              logo.src = generateFallbackLogoDataUri(fallbackName);
            };
            cell.appendChild(logo);
          }

          // Tooltip on hover: shows release info
          const rank = i + 1;
          const artistLabel = entry.coArtists.map(a => `${a.name} ${ARTIST_TYPE_INDICATORS[a.artistType as ArtistType] ?? ""}`).join(" • ");
          const tooltipText = this.metric === "wins"
            ? `#${rank} · ${entry.title} · ${artistLabel} · ${entry.wins} ${entry.wins === 1 ? "win" : "wins"}`
            : this.metric === "appearances"
            ? `#${rank} · ${entry.title} · ${artistLabel} · ${entry.appearances} ${entry.appearances === 1 ? "appearance" : "appearances"}`
            : `#${rank} · ${entry.title} · ${artistLabel} · ${entry.points.toLocaleString()} pts`;

          cell.addEventListener("mouseenter", () => {
            let tooltip = document.querySelector(".yearly-treemap__tooltip") as HTMLElement | null;
            if (!tooltip) {
              tooltip = document.createElement("div");
              tooltip.className = "yearly-treemap__tooltip";
              document.body.appendChild(tooltip);
            }
            tooltip.textContent = tooltipText;
            tooltip.style.display = "block";
            const cellRect = cell.getBoundingClientRect();
            let left = cellRect.left + cellRect.width / 2;
            const top = cellRect.top - 6;
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            const tipRect = tooltip.getBoundingClientRect();
            if (tipRect.right > window.innerWidth - 8) {
              tooltip.style.left = `${window.innerWidth - 8 - tipRect.width / 2}px`;
            }
            if (tipRect.left < 8) {
              tooltip.style.left = `${8 + tipRect.width / 2}px`;
            }
          });
          cell.addEventListener("mouseleave", () => {
            const tooltip = document.querySelector(".yearly-treemap__tooltip") as HTMLElement | null;
            if (tooltip) tooltip.style.display = "none";
          });

          mapContainer.appendChild(cell);
        }
      });
    }
  }

  /** Creates a year cell for Songs mode grid */
  private createYearCellSongs(year: YearOrAllTime, entries: YearlySongEntry[], globalMax: number): HTMLDivElement {
    const cell = document.createElement("div");
    cell.className = "yearly-view__cell";

    const heading = document.createElement("h2");
    heading.className = "yearly-view__year";
    heading.textContent = this.columnLabel(year);
    cell.appendChild(heading);

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "yearly-view__empty";
      empty.textContent = "No data";
      cell.appendChild(empty);
      return cell;
    }

    const barsContainer = document.createElement("div");
    barsContainer.className = "yearly-view__bars";

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const row = document.createElement("div");
      row.className = "yearly-view__row";

      const rank = document.createElement("span");
      rank.className = "yearly-view__rank";
      const primaryType = entry.coArtists.length > 0
        ? entry.coArtists[0].artistType
        : entry.artistType;
      rank.textContent = `#${i + 1}`;
      rank.style.backgroundColor = ARTIST_TYPE_COLORS[primaryType as keyof typeof ARTIST_TYPE_COLORS] ?? "#555";

      const barTrack = document.createElement("div");
      barTrack.className = "yearly-view__bar-track";

      const bar = document.createElement("div");
      bar.className = "yearly-view__bar";
      bar.style.backgroundColor = ARTIST_TYPE_COLORS[primaryType as keyof typeof ARTIST_TYPE_COLORS] ?? "#555";
      const metricValue = this.metricValueOf(entry);
      const widthPct = globalMax > 0 ? (metricValue / globalMax) * 100 : 0;
      bar.style.width = `${widthPct}%`;

      // Logo
      const logo = document.createElement("img");
      logo.className = "yearly-view__logo";
      logo.src = entry.logoUrl;
      logo.alt = "";
      logo.onerror = () => {
        const primaryArtist = entry.coArtists[0];
        const artistData = primaryArtist ? this.dataStore?.artists.get(primaryArtist.id) : undefined;
        const fallbackName = artistData?.koreanName ?? primaryArtist?.name ?? entry.title;
        logo.src = generateFallbackLogoDataUri(fallbackName);
      };
      bar.appendChild(logo);

      // Label format: "Release Title • Artist Name(s)"
      const artistLabel = entry.artistNames.join(" • ");
      const labelText = `${entry.title} • ${artistLabel}`;

      const name = document.createElement("span");
      name.className = "yearly-view__name";
      name.textContent = labelText;
      bar.appendChild(name);

      // Type indicator
      const indicator = document.createElement("span");
      indicator.className = "yearly-view__indicator";
      indicator.textContent = ARTIST_TYPE_INDICATORS[primaryType as ArtistType] ?? "";
      indicator.dataset.color = ARTIST_TYPE_COLORS[primaryType as keyof typeof ARTIST_TYPE_COLORS] ?? "#555";
      bar.appendChild(indicator);

      const statsText = this.formatStatsText(entry);

      const stats = document.createElement("span");
      stats.className = "yearly-view__stats";
      stats.textContent = statsText;
      bar.appendChild(stats);

      barTrack.appendChild(bar);

      row.appendChild(rank);
      row.appendChild(barTrack);
      barsContainer.appendChild(row);
    }

    cell.appendChild(barsContainer);

    // After layout, check each bar for overflow and move text outside if needed
    requestAnimationFrame(() => {
      const rows = barsContainer.querySelectorAll(".yearly-view__row");
      rows.forEach((row) => {
        const bar = row.querySelector(".yearly-view__bar") as HTMLElement | null;
        const barTrack = row.querySelector(".yearly-view__bar-track") as HTMLElement | null;
        const name = bar?.querySelector(".yearly-view__name") as HTMLElement | null;
        const indicator = bar?.querySelector(".yearly-view__indicator") as HTMLElement | null;
        const stats = bar?.querySelector(".yearly-view__stats") as HTMLElement | null;
        if (!bar || !barTrack || !name || !stats) return;

        bar.style.overflow = "visible";
        name.style.flexShrink = "0";
        stats.style.flexShrink = "0";
        bar.offsetHeight;

        const barOverflows = bar.scrollWidth > bar.clientWidth;

        bar.style.overflow = "";
        name.style.flexShrink = "";
        stats.style.flexShrink = "";

        if (barOverflows) {
          bar.removeChild(stats);

          const overflow = document.createElement("span");
          overflow.className = "yearly-view__overflow-text";
          overflow.style.left = bar.style.width;

          bar.style.overflow = "visible";
          name.style.flexShrink = "0";
          bar.offsetHeight;
          const stillOverflows = bar.scrollWidth > bar.clientWidth;
          bar.style.overflow = "";
          name.style.flexShrink = "";

          if (stillOverflows) {
            bar.removeChild(name);
            if (indicator) bar.removeChild(indicator);
            const nameSpan = document.createElement("span");
            nameSpan.className = "yearly-view__name yearly-view__name--outside";
            nameSpan.textContent = name.textContent ?? "";
            const indSpan = document.createElement("span");
            indSpan.className = "yearly-view__indicator yearly-view__indicator--outside";
            indSpan.textContent = indicator?.textContent ?? "";
            const statsSpan = document.createElement("span");
            statsSpan.className = "yearly-view__overflow-stats";
            statsSpan.textContent = stats.textContent ?? "";
            overflow.appendChild(nameSpan);
            overflow.appendChild(indSpan);
            overflow.appendChild(statsSpan);
          } else {
            const statsSpan = document.createElement("span");
            statsSpan.className = "yearly-view__overflow-stats";
            statsSpan.textContent = stats.textContent ?? "";
            overflow.appendChild(statsSpan);
          }

          barTrack.appendChild(overflow);
        }
      });

      // Cascade: once one bar has name outside, force all below it outside too
      let forceOutside = false;
      rows.forEach((row) => {
        const bar = row.querySelector(".yearly-view__bar") as HTMLElement | null;
        const barTrack = row.querySelector(".yearly-view__bar-track") as HTMLElement | null;
        const nameEl = bar?.querySelector(".yearly-view__name") as HTMLElement | null;
        const indicatorEl = bar?.querySelector(".yearly-view__indicator") as HTMLElement | null;
        const statsEl = bar?.querySelector(".yearly-view__stats") as HTMLElement | null;
        if (!bar || !barTrack) return;

        // Check if this row already has its name outside
        const nameIsOutside = barTrack.querySelector(".yearly-view__name--outside") !== null;
        if (nameIsOutside && !forceOutside) {
          forceOutside = true;
          return;
        }

        if (forceOutside && nameEl && bar.contains(nameEl)) {
          // Remove any existing stats-only overflow span first
          const existingOverflow = barTrack.querySelector(".yearly-view__overflow-text");
          if (existingOverflow) existingOverflow.remove();

          if (statsEl && bar.contains(statsEl)) bar.removeChild(statsEl);
          bar.removeChild(nameEl);
          if (indicatorEl && bar.contains(indicatorEl)) bar.removeChild(indicatorEl);

          const overflow = document.createElement("span");
          overflow.className = "yearly-view__overflow-text";
          overflow.style.left = bar.style.width;

          const nameSpan = document.createElement("span");
          nameSpan.className = "yearly-view__name yearly-view__name--outside";
          nameSpan.textContent = nameEl.textContent ?? "";
          const indSpan = document.createElement("span");
          indSpan.className = "yearly-view__indicator yearly-view__indicator--outside";
          indSpan.textContent = indicatorEl?.textContent ?? "";
          const statsSpan = document.createElement("span");
          statsSpan.className = "yearly-view__overflow-stats";
          statsSpan.textContent = statsEl?.textContent ?? (existingOverflow?.querySelector(".yearly-view__overflow-stats")?.textContent ?? "");
          overflow.appendChild(nameSpan);
          overflow.appendChild(indSpan);
          overflow.appendChild(statsSpan);

          barTrack.appendChild(overflow);
        }
      });
    });

    return cell;
  }

  /** Compute release-level year data for Songs mode */
  private computeYearDataSongs(year: YearOrAllTime, limit: number = 10): YearlySongEntry[] {
    if (!this.dataStore) return [];
    const entries: YearlySongEntry[] = [];
    const processedReleases = new Set<string>();

    for (const [artistId, artist] of this.dataStore.artists) {
      for (const release of artist.releases) {
        // Deduplicate multi-artist releases: only process from the first artist in artistIds
        if (release.artistIds.length > 1 && release.artistIds[0] !== artistId) continue;

        // Skip if already processed this release
        const dedupeKey = `${release.artistIds[0]}::${release.id}`;
        if (processedReleases.has(dedupeKey)) continue;
        processedReleases.add(dedupeKey);

        let points = 0;
        let wins = 0;
        let appearances = 0;
        for (const [date, entry] of release.dailyValues) {
          if (this.dateInYear(date, year)) {
            if (this.sourceFilter === "all" || entry.source === this.sourceFilter) {
              points += entry.value;
              // Appearances: one credit per (date, source) chart entry for this release
              appearances += 1;
            }

            // Count wins: check if this artist won on this (date, source)
            // and this release was the top-value release for that artist on this date
            const dateWins = this.dataStore.chartWins.get(date);
            if (dateWins) {
              const sourceWins = dateWins.get(entry.source);
              if (sourceWins && sourceWins.artistIds.includes(artistId)) {
                if (this.sourceFilter === "all" || entry.source === this.sourceFilter) {
                  // Check if this release is the highest-value one for this artist on this date
                  let isTopRelease = true;
                  for (const otherRelease of artist.releases) {
                    if (otherRelease.id === release.id) continue;
                    const otherEntry = otherRelease.dailyValues.get(date);
                    if (otherEntry && otherEntry.source === entry.source && otherEntry.value > entry.value) {
                      isTopRelease = false;
                      break;
                    }
                  }
                  if (isTopRelease) {
                    wins++;
                  }
                }
              }
            }
          }
        }
        if (points <= 0) continue;

        // Resolve co-artists
        const resolved = resolveArtists(release.artistIds, this.dataStore, artist);

        // Apply generation filter
        if (this.generationFilter !== "all") {
          const matchesGeneration = resolved.some(a => a.generation === this.generationFilter);
          if (!matchesGeneration) continue;
        }

        // Apply artist filter
        if (this.artistFilter !== "all") {
          const matchesArtist = release.artistIds.includes(this.artistFilter);
          if (!matchesArtist) continue;
        }

        const logoUrls = resolved.map(a => a.logoUrl);
        const artistNames = resolved.map(a => a.name);

        entries.push({
          releaseKey: `${artistId}::${release.id}`,
          title: release.title,
          logoUrl: resolved[0]?.logoUrl ?? artist.logoUrl,
          logoUrls,
          artistNames,
          artistType: resolved[0]?.artistType ?? artist.artistType,
          points,
          wins,
          appearances,
          coArtists: resolved,
        });
      }
    }

    entries.sort((a, b) => {
      if (this.metric === "wins") {
        return b.wins - a.wins || b.points - a.points;
      }
      if (this.metric === "appearances") {
        return b.appearances - a.appearances || b.points - a.points;
      }
      return b.points - a.points;
    });

    if (this.metric === "wins") {
      return entries.filter(e => e.wins > 0).slice(0, limit);
    }
    return entries.slice(0, limit);
  }

  private getYears(): number[] {
    if (!this.dataStore) return [];
    const yearSet = new Set<number>();
    for (const date of this.dataStore.dates) {
      yearSet.add(parseInt(date.substring(0, 4), 10));
    }
    return Array.from(yearSet).sort((a, b) => b - a); // newest first
  }

  /** Whether a date string belongs to the given year (or any year for all-time) */
  private dateInYear(date: string, year: YearOrAllTime): boolean {
    return year === ALL_TIME || date.startsWith(String(year));
  }

  /** Returns the metric value for an entry under the current metric */
  private metricValueOf(entry: { points: number; wins: number; appearances: number }): number {
    if (this.metric === "wins") return entry.wins;
    if (this.metric === "appearances") return entry.appearances;
    return entry.points;
  }

  /** Formats the trailing stats label for a bar under the current metric */
  private formatStatsText(entry: { points: number; wins: number; appearances: number }): string {
    if (this.metric === "wins") {
      return entry.wins > 0 ? `${entry.wins} ${entry.wins === 1 ? "win" : "wins"}` : "";
    }
    if (this.metric === "appearances") {
      return `${entry.appearances} ${entry.appearances === 1 ? "appearance" : "appearances"}`;
    }
    return entry.points.toLocaleString();
  }

  private computeYearData(year: YearOrAllTime, limit: number = 10): YearlyArtistEntry[] {
    if (!this.dataStore) return [];
    const artistPoints = new Map<string, number>();
    const artistWins = new Map<string, number>();
    const artistAppearances = new Map<string, number>();

    // Sum points and count appearances per artist (filtered by source and artist if set).
    // Appearances: one credit per (release, date, source) chart entry — so if two songs
    // charted on the same show/day the artist gets two credits.
    for (const [artistId, artist] of this.dataStore.artists) {
      if (this.artistFilter !== "all" && artistId !== this.artistFilter) continue;
      let points = 0;
      let appearances = 0;
      for (const release of artist.releases) {
        for (const [date, entry] of release.dailyValues) {
          if (this.dateInYear(date, year)) {
            if (this.sourceFilter === "all" || entry.source === this.sourceFilter) {
              points += entry.value;
              appearances += 1;
            }
          }
        }
      }
      if (points > 0) {
        artistPoints.set(artistId, points);
        artistAppearances.set(artistId, appearances);
      }
    }

    // Count wins per artist (filtered by source and artist if set)
    for (const [date, sourceMap] of this.dataStore.chartWins) {
      if (!this.dateInYear(date, year)) continue;
      for (const [source, winData] of sourceMap) {
        if (this.sourceFilter !== "all" && source !== this.sourceFilter) continue;
        for (const artistId of winData.artistIds) {
          if (this.artistFilter !== "all" && artistId !== this.artistFilter) continue;
          artistWins.set(artistId, (artistWins.get(artistId) ?? 0) + 1);
        }
      }
    }

    // Build entries and sort by points descending
    const entries: YearlyArtistEntry[] = [];
    for (const [artistId, points] of artistPoints) {
      const artist = this.dataStore.artists.get(artistId);
      if (!artist) continue;
      entries.push({
        artistId,
        name: artist.name,
        logoUrl: artist.logoUrl,
        artistType: artist.artistType,
        points,
        wins: artistWins.get(artistId) ?? 0,
        appearances: artistAppearances.get(artistId) ?? 0,
      });
    }

    entries.sort((a, b) => {
      if (this.metric === "wins") {
        // Sort by wins descending, break ties with points
        return b.wins - a.wins || b.points - a.points;
      }
      if (this.metric === "appearances") {
        return b.appearances - a.appearances || b.points - a.points;
      }
      return b.points - a.points;
    });
    // In wins mode, filter out artists with 0 wins
    if (this.metric === "wins") {
      return entries.filter(e => e.wins > 0).slice(0, limit);
    }
    return entries.slice(0, limit);
  }

  private createYearCell(year: YearOrAllTime, entries: YearlyArtistEntry[], globalMax: number): HTMLDivElement {
    const cell = document.createElement("div");
    cell.className = "yearly-view__cell";

    const heading = document.createElement("h2");
    heading.className = "yearly-view__year";
    heading.textContent = this.columnLabel(year);
    cell.appendChild(heading);

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "yearly-view__empty";
      empty.textContent = "No data";
      cell.appendChild(empty);
      return cell;
    }

    const barsContainer = document.createElement("div");
    barsContainer.className = "yearly-view__bars";

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const row = document.createElement("div");
      row.className = "yearly-view__row";

      const rank = document.createElement("span");
      rank.className = "yearly-view__rank";
      rank.textContent = `#${i + 1}`;
      rank.style.backgroundColor = ARTIST_TYPE_COLORS[entry.artistType as keyof typeof ARTIST_TYPE_COLORS] ?? "#555";

      const barTrack = document.createElement("div");
      barTrack.className = "yearly-view__bar-track";

      const bar = document.createElement("div");
      bar.className = "yearly-view__bar";
      bar.style.backgroundColor = ARTIST_TYPE_COLORS[entry.artistType as keyof typeof ARTIST_TYPE_COLORS] ?? "#555";
      const metricValue = this.metricValueOf(entry);
      const widthPct = globalMax > 0 ? (metricValue / globalMax) * 100 : 0;
      bar.style.width = `${widthPct}%`;

      const statsText = this.formatStatsText(entry);

      // Logo always goes inside the bar
      const logo = document.createElement("img");
      logo.className = "yearly-view__logo";
      logo.src = entry.logoUrl;
      logo.alt = "";
      logo.onerror = () => {
        const artist = this.dataStore?.artists.get(entry.artistId);
        logo.src = generateFallbackLogoDataUri(artist?.koreanName ?? entry.name);
      };
      bar.appendChild(logo);

      // Put name and stats inside initially — overflow check happens after layout
      const name = document.createElement("span");
      name.className = "yearly-view__name";
      name.textContent = entry.name;
      bar.appendChild(name);

      const indicator = document.createElement("span");
      indicator.className = "yearly-view__indicator";
      indicator.textContent = ARTIST_TYPE_INDICATORS[entry.artistType as ArtistType] ?? "";
      indicator.dataset.color = ARTIST_TYPE_COLORS[entry.artistType as keyof typeof ARTIST_TYPE_COLORS] ?? "#555";
      bar.appendChild(indicator);

      const stats = document.createElement("span");
      stats.className = "yearly-view__stats";
      stats.textContent = statsText;
      bar.appendChild(stats);

      barTrack.appendChild(bar);

      row.appendChild(rank);
      row.appendChild(barTrack);
      barsContainer.appendChild(row);
    }

    cell.appendChild(barsContainer);

    // After layout, check each bar for overflow and move text outside if needed
    // Uses the same approach as the race view: temporarily set overflow:visible,
    // measure, then move elements outside if they don't fit.
    requestAnimationFrame(() => {
      const rows = barsContainer.querySelectorAll(".yearly-view__row");
      rows.forEach((row) => {
        const bar = row.querySelector(".yearly-view__bar") as HTMLElement | null;
        const barTrack = row.querySelector(".yearly-view__bar-track") as HTMLElement | null;
        const name = bar?.querySelector(".yearly-view__name") as HTMLElement | null;
        const indicator = bar?.querySelector(".yearly-view__indicator") as HTMLElement | null;
        const stats = bar?.querySelector(".yearly-view__stats") as HTMLElement | null;
        if (!bar || !barTrack || !name || !stats) return;

        // Temporarily allow overflow and prevent flex-shrink to measure true size
        bar.style.overflow = "visible";
        name.style.flexShrink = "0";
        stats.style.flexShrink = "0";
        bar.offsetHeight; // force reflow

        const barOverflows = bar.scrollWidth > bar.clientWidth;

        // Restore
        bar.style.overflow = "";
        name.style.flexShrink = "";
        stats.style.flexShrink = "";

        if (barOverflows) {
          // Move stats outside first
          bar.removeChild(stats);

          const overflow = document.createElement("span");
          overflow.className = "yearly-view__overflow-text";
          overflow.style.left = bar.style.width;

          // Re-check if name alone fits
          bar.style.overflow = "visible";
          name.style.flexShrink = "0";
          bar.offsetHeight;
          const stillOverflows = bar.scrollWidth > bar.clientWidth;
          bar.style.overflow = "";
          name.style.flexShrink = "";

          if (stillOverflows) {
            // Name doesn't fit either — move it outside too
            bar.removeChild(name);
            if (indicator) bar.removeChild(indicator);
            const nameSpan = document.createElement("span");
            nameSpan.className = "yearly-view__name yearly-view__name--outside";
            nameSpan.textContent = name.textContent ?? "";
            const indSpan = document.createElement("span");
            indSpan.className = "yearly-view__indicator yearly-view__indicator--outside";
            indSpan.textContent = indicator?.textContent ?? "";
            const statsSpan = document.createElement("span");
            statsSpan.className = "yearly-view__overflow-stats";
            statsSpan.textContent = stats.textContent ?? "";
            overflow.appendChild(nameSpan);
            overflow.appendChild(indSpan);
            overflow.appendChild(statsSpan);
          } else {
            // Name fits, just stats outside
            const statsSpan = document.createElement("span");
            statsSpan.className = "yearly-view__overflow-stats";
            statsSpan.textContent = stats.textContent ?? "";
            overflow.appendChild(statsSpan);
          }

          barTrack.appendChild(overflow);
        }
      });

      // Cascade: once one bar has name outside, force all below it outside too
      let forceOutside = false;
      rows.forEach((row) => {
        const bar = row.querySelector(".yearly-view__bar") as HTMLElement | null;
        const barTrack = row.querySelector(".yearly-view__bar-track") as HTMLElement | null;
        const nameEl = bar?.querySelector(".yearly-view__name") as HTMLElement | null;
        const indicatorEl = bar?.querySelector(".yearly-view__indicator") as HTMLElement | null;
        const statsEl = bar?.querySelector(".yearly-view__stats") as HTMLElement | null;
        if (!bar || !barTrack) return;

        const nameIsOutside = barTrack.querySelector(".yearly-view__name--outside") !== null;
        if (nameIsOutside && !forceOutside) {
          forceOutside = true;
          return;
        }

        if (forceOutside && nameEl && bar.contains(nameEl)) {
          // Remove any existing stats-only overflow span first
          const existingOverflow = barTrack.querySelector(".yearly-view__overflow-text");
          if (existingOverflow) existingOverflow.remove();

          if (statsEl && bar.contains(statsEl)) bar.removeChild(statsEl);
          bar.removeChild(nameEl);
          if (indicatorEl && bar.contains(indicatorEl)) bar.removeChild(indicatorEl);

          const overflow = document.createElement("span");
          overflow.className = "yearly-view__overflow-text";
          overflow.style.left = bar.style.width;

          const nameSpan = document.createElement("span");
          nameSpan.className = "yearly-view__name yearly-view__name--outside";
          nameSpan.textContent = nameEl.textContent ?? "";
          const indSpan = document.createElement("span");
          indSpan.className = "yearly-view__indicator yearly-view__indicator--outside";
          indSpan.textContent = indicatorEl?.textContent ?? "";
          const statsSpan = document.createElement("span");
          statsSpan.className = "yearly-view__overflow-stats";
          statsSpan.textContent = statsEl?.textContent ?? (existingOverflow?.querySelector(".yearly-view__overflow-stats")?.textContent ?? "");
          overflow.appendChild(nameSpan);
          overflow.appendChild(indSpan);
          overflow.appendChild(statsSpan);

          barTrack.appendChild(overflow);
        }
      });
    });

    return cell;
  }
}

// --- Squarified Treemap Algorithm ---
// Based on Bruls, Huizing, van Wijk (2000)

interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function squarify(values: number[], width: number, height: number): TreemapRect[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (total === 0 || values.length === 0) return [];

  // Normalize values so they sum to total area
  const area = width * height;
  const normalized = values.map(v => (v / total) * area);

  const rects: TreemapRect[] = new Array(values.length);
  layoutStrip(normalized, 0, { x: 0, y: 0, w: width, h: height }, rects);
  return rects;
}

function layoutStrip(
  areas: number[],
  startIndex: number,
  container: TreemapRect,
  out: TreemapRect[]
): void {
  if (areas.length === 0) return;
  if (areas.length === 1) {
    out[startIndex] = { x: container.x, y: container.y, w: container.w, h: container.h };
    return;
  }

  // Determine the shorter side of the container
  const shortSide = Math.min(container.w, container.h);

  // Greedily add items to the current row until aspect ratio worsens
  let rowSum = 0;
  let rowItems: number[] = [];
  let bestWorst = Infinity;

  for (let i = 0; i < areas.length; i++) {
    const testRow = [...rowItems, areas[i]];
    const testSum = rowSum + areas[i];
    const worst = worstAspectRatio(testRow, testSum, shortSide);

    if (worst <= bestWorst) {
      rowItems = testRow;
      rowSum = testSum;
      bestWorst = worst;
    } else {
      // Layout current row and recurse on remainder
      const rowContainer = placeRow(rowItems, rowSum, startIndex, container, out);
      layoutStrip(areas.slice(i), startIndex + i, rowContainer, out);
      return;
    }
  }

  // All items fit in one row
  placeRow(rowItems, rowSum, startIndex, container, out);
}

function worstAspectRatio(row: number[], rowSum: number, shortSide: number): number {
  const rowWidth = rowSum / shortSide;
  let worst = 0;
  for (const area of row) {
    const h = area / rowWidth;
    const ratio = Math.max(rowWidth / h, h / rowWidth);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

function placeRow(
  row: number[],
  rowSum: number,
  startIndex: number,
  container: TreemapRect,
  out: TreemapRect[]
): TreemapRect {
  const { x, y, w, h } = container;
  const horizontal = w >= h; // lay row along the shorter side

  if (horizontal) {
    // Row fills from left, items stack vertically
    const rowWidth = rowSum / h;
    let cy = y;
    for (let i = 0; i < row.length; i++) {
      const itemHeight = row[i] / rowWidth;
      out[startIndex + i] = { x, y: cy, w: rowWidth, h: itemHeight };
      cy += itemHeight;
    }
    // Remaining container is to the right
    return { x: x + rowWidth, y, w: w - rowWidth, h };
  } else {
    // Row fills from top, items stack horizontally
    const rowHeight = rowSum / w;
    let cx = x;
    for (let i = 0; i < row.length; i++) {
      const itemWidth = row[i] / rowHeight;
      out[startIndex + i] = { x: cx, y, w: itemWidth, h: rowHeight };
      cx += itemWidth;
    }
    // Remaining container is below
    return { x, y: y + rowHeight, w, h: h - rowHeight };
  }
}

// Export for testing
export { squarify, type TreemapRect };
