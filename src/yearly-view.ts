/**
 * Yearly View — shows a grid of per-year top-10 bar charts.
 * Each cell displays the top 10 artists by total points earned that year,
 * along with their win count. No animation, no playback — just static bars.
 * All years share the same scale (global max) for at-a-glance comparison.
 */

import type { DataStore } from "./models.ts";
import type { ArtistType } from "./types.ts";
import { ARTIST_TYPE_COLORS } from "./colors.ts";

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
}

export type YearlyMetric = "points" | "wins";

export class YearlyView {
  private wrapper: HTMLDivElement | null = null;
  private dataStore: DataStore | null = null;
  private metric: YearlyMetric = "points";

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

  private render(): void {
    if (!this.wrapper || !this.dataStore) return;
    this.wrapper.innerHTML = "";

    const years = this.getYears();
    const yearData = new Map<number, YearlyArtistEntry[]>();

    // Compute data for all years
    for (const year of years) {
      const entries = this.computeYearData(year);
      yearData.set(year, entries);
    }

    // Find global max based on current metric
    let globalMax = 0;
    for (const entries of yearData.values()) {
      if (entries.length > 0) {
        const topValue = this.metric === "wins" ? entries[0].wins : entries[0].points;
        if (topValue > globalMax) globalMax = topValue;
      }
    }

    for (const year of years) {
      const entries = yearData.get(year) ?? [];
      const cell = this.createYearCell(year, entries, globalMax);
      this.wrapper.appendChild(cell);
    }
  }

  private getYears(): number[] {
    if (!this.dataStore) return [];
    const yearSet = new Set<number>();
    for (const date of this.dataStore.dates) {
      yearSet.add(parseInt(date.substring(0, 4), 10));
    }
    return Array.from(yearSet).sort((a, b) => b - a); // newest first
  }

  private computeYearData(year: number): YearlyArtistEntry[] {
    if (!this.dataStore) return [];
    const yearStr = String(year);
    const artistPoints = new Map<string, number>();
    const artistWins = new Map<string, number>();

    // Sum points per artist for this year
    for (const [artistId, artist] of this.dataStore.artists) {
      let points = 0;
      for (const release of artist.releases) {
        for (const [date, entry] of release.dailyValues) {
          if (date.startsWith(yearStr)) {
            points += entry.value;
          }
        }
      }
      if (points > 0) {
        artistPoints.set(artistId, points);
      }
    }

    // Count wins per artist for this year
    for (const [date, sourceMap] of this.dataStore.chartWins) {
      if (!date.startsWith(yearStr)) continue;
      for (const [, winData] of sourceMap) {
        for (const artistId of winData.artistIds) {
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
      });
    }

    entries.sort((a, b) => {
      if (this.metric === "wins") {
        // Sort by wins descending, break ties with points
        return b.wins - a.wins || b.points - a.points;
      }
      return b.points - a.points;
    });
    // In wins mode, filter out artists with 0 wins
    if (this.metric === "wins") {
      return entries.filter(e => e.wins > 0).slice(0, 10);
    }
    return entries.slice(0, 10);
  }

  private createYearCell(year: number, entries: YearlyArtistEntry[], globalMax: number): HTMLDivElement {
    const cell = document.createElement("div");
    cell.className = "yearly-view__cell";

    const heading = document.createElement("h2");
    heading.className = "yearly-view__year";
    heading.textContent = String(year);
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
      const metricValue = this.metric === "wins" ? entry.wins : entry.points;
      const widthPct = globalMax > 0 ? (metricValue / globalMax) * 100 : 0;
      bar.style.width = `${widthPct}%`;

      const winsText = entry.wins > 0 ? `${entry.wins} ${entry.wins === 1 ? "win" : "wins"}` : "";
      const statsText = this.metric === "wins" ? winsText : entry.points.toLocaleString();

      // Logo always goes inside the bar
      const logo = document.createElement("img");
      logo.className = "yearly-view__logo";
      logo.src = entry.logoUrl;
      logo.alt = "";
      logo.onerror = () => { logo.style.display = "none"; };
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
    });

    return cell;
  }
}
