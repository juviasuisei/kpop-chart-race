/**
 * Artist Timeline — full chronological view of a single artist's activity.
 * Shows chart appearances, wins, live performances, and releases grouped by date.
 */

import type { DataStore, ParsedArtist } from "../models.ts";

/** Source key → logo path mapping */
const SOURCE_LOGOS: Record<string, string> = {
  inkigayo: "assets/sources/inkigayo.png",
  the_show: "assets/sources/the_show.png",
  show_champion: "assets/sources/show_champion.png",
  music_bank: "assets/sources/music_bank.png",
  m_countdown: "assets/sources/m_countdown.png",
  show_music_core: "assets/sources/show_music_core.png",
};

/** Source key → human-readable label */
const SOURCE_LABELS: Record<string, string> = {
  inkigayo: "SBS Inkigayo",
  the_show: "SBS The Show",
  show_champion: "MBC M Show Champion",
  music_bank: "KBS Music Bank",
  m_countdown: "Mnet M Countdown",
  show_music_core: "MBC Show! Music Core",
};

/** Human-readable artist type labels */
const ARTIST_TYPE_LABELS: Record<string, string> = {
  boy_group: "Boy Group",
  girl_group: "Girl Group",
  solo_male: "Solo Male",
  solo_female: "Solo Female",
  mixed_group: "Mixed Group",
};

/** A single timeline entry for a date */
interface TimelineEntry {
  type: "chart" | "embed";
  releaseTitle: string;
  // Chart fields
  source?: string;
  episode?: number;
  value?: number;
  isWin?: boolean;
  crownLevel?: number;
  // Embed fields
  embedType?: string;
  embedUrl?: string;
}

export class ArtistTimeline {
  private container: HTMLElement | null = null;
  private dataStore: DataStore | null = null;
  private artistId: string | null = null;

  mount(container: HTMLElement, dataStore: DataStore, artistId: string): void {
    this.container = container;
    this.dataStore = dataStore;
    this.artistId = artistId;
    this.render();
  }

  setArtist(artistId: string): void {
    if (this.artistId === artistId) return;
    this.artistId = artistId;
    this.render();
  }

  unmount(): void {
    if (this.container) {
      this.container.innerHTML = "";
    }
    this.container = null;
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private render(): void {
    if (!this.container || !this.dataStore || !this.artistId) return;
    this.container.innerHTML = "";

    const artist = this.dataStore.artists.get(this.artistId);
    if (!artist) {
      this.container.innerHTML = `<div class="artist-timeline__prompt">Artist not found.</div>`;
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "artist-timeline";

    // Header
    wrapper.appendChild(this.createHeader(artist));

    // Build date-grouped entries
    const dateMap = this.buildDateMap(artist);

    // Sort dates descending (most recent first)
    const sortedDates = Array.from(dateMap.keys()).sort((a, b) => b.localeCompare(a));

    for (const date of sortedDates) {
      const entries = dateMap.get(date)!;
      const group = this.createDateGroup(date, entries);
      wrapper.appendChild(group);
    }

    this.container.appendChild(wrapper);
  }

  private createHeader(artist: ParsedArtist): HTMLElement {
    const header = document.createElement("div");
    header.className = "artist-timeline__header";

    // Logo
    const logo = document.createElement("img");
    logo.className = "artist-timeline__logo";
    logo.src = artist.logoUrl;
    logo.alt = artist.name;
    logo.width = 64;
    logo.height = 64;
    header.appendChild(logo);

    // Name
    const name = document.createElement("div");
    name.className = "artist-timeline__name";
    name.textContent = artist.name;
    header.appendChild(name);

    // Type + Generation
    const meta = document.createElement("div");
    meta.className = "artist-timeline__meta";
    const typeLabel = ARTIST_TYPE_LABELS[artist.artistType] ?? artist.artistType;
    meta.textContent = `${typeLabel} · Gen ${artist.generation}`;
    header.appendChild(meta);

    // Stats
    const stats = this.computeStats(artist);
    const statsEl = document.createElement("div");
    statsEl.className = "artist-timeline__stats";
    statsEl.innerHTML = `
      <div class="artist-timeline__stat"><span class="artist-timeline__stat-value">${stats.totalPoints.toLocaleString()}</span><span class="artist-timeline__stat-label">Points</span></div>
      <div class="artist-timeline__stat"><span class="artist-timeline__stat-value">${stats.totalWins}</span><span class="artist-timeline__stat-label">Wins</span></div>
      <div class="artist-timeline__stat"><span class="artist-timeline__stat-value">${stats.releaseCount}</span><span class="artist-timeline__stat-label">Releases</span></div>
      <div class="artist-timeline__stat"><span class="artist-timeline__stat-value">${stats.activePeriod}</span><span class="artist-timeline__stat-label">Active</span></div>
    `;
    header.appendChild(statsEl);

    return header;
  }

  private computeStats(artist: ParsedArtist): {
    totalPoints: number;
    totalWins: number;
    releaseCount: number;
    activePeriod: string;
  } {
    let totalPoints = 0;
    let totalWins = 0;
    let firstDate = "";
    let lastDate = "";

    for (const release of artist.releases) {
      for (const [date, dv] of release.dailyValues) {
        totalPoints += dv.value;
        if (!firstDate || date < firstDate) firstDate = date;
        if (!lastDate || date > lastDate) lastDate = date;
      }
    }

    // Count wins from chartWins
    if (this.dataStore) {
      for (const [, sourceMap] of this.dataStore.chartWins) {
        for (const [, winData] of sourceMap) {
          if (winData.artistIds.includes(artist.id)) {
            totalWins++;
          }
        }
      }
    }

    const releaseCount = artist.releases.length;
    const activePeriod = firstDate && lastDate
      ? `${firstDate.slice(0, 7)} → ${lastDate.slice(0, 7)}`
      : "—";

    return { totalPoints, totalWins, releaseCount, activePeriod };
  }

  private buildDateMap(artist: ParsedArtist): Map<string, TimelineEntry[]> {
    const dateMap = new Map<string, TimelineEntry[]>();

    for (const release of artist.releases) {
      // Chart appearances (dailyValues)
      for (const [date, dv] of release.dailyValues) {
        if (!dateMap.has(date)) dateMap.set(date, []);
        const entries = dateMap.get(date)!;

        // Check if this is a win
        let isWin = false;
        let crownLevel = 0;
        if (this.dataStore?.chartWins.has(date)) {
          const dateWins = this.dataStore.chartWins.get(date)!;
          if (dateWins.has(dv.source)) {
            const winData = dateWins.get(dv.source)!;
            if (winData.artistIds.includes(artist.id)) {
              isWin = true;
              crownLevel = winData.crownLevels.get(artist.id) ?? 1;
            }
          }
        }

        entries.push({
          type: "chart",
          releaseTitle: release.title,
          source: dv.source,
          episode: dv.episode,
          value: dv.value,
          isWin,
          crownLevel,
        });
      }

      // Embeds
      for (const [date, embeds] of release.embeds) {
        if (!dateMap.has(date)) dateMap.set(date, []);
        const entries = dateMap.get(date)!;

        for (const embed of embeds) {
          entries.push({
            type: "embed",
            releaseTitle: release.title,
            embedType: embed.type,
            embedUrl: embed.url,
          });
        }
      }
    }

    // Sort entries within each date: wins first, chart by value desc, then embeds
    for (const [, entries] of dateMap) {
      entries.sort((a, b) => {
        // Wins first
        if (a.isWin && !b.isWin) return -1;
        if (!a.isWin && b.isWin) return 1;
        // Chart entries before embeds
        if (a.type === "chart" && b.type === "embed") return -1;
        if (a.type === "embed" && b.type === "chart") return 1;
        // Within chart: sort by value desc
        if (a.type === "chart" && b.type === "chart") {
          return (b.value ?? 0) - (a.value ?? 0);
        }
        return 0;
      });
    }

    return dateMap;
  }

  private createDateGroup(date: string, entries: TimelineEntry[]): HTMLElement {
    const group = document.createElement("div");
    group.className = "artist-timeline__date-group";

    const dateHeader = document.createElement("div");
    dateHeader.className = "artist-timeline__date-header";
    dateHeader.textContent = this.formatDate(date);
    group.appendChild(dateHeader);

    for (const entry of entries) {
      group.appendChild(this.createEntry(entry));
    }

    return group;
  }

  private createEntry(entry: TimelineEntry): HTMLElement {
    const el = document.createElement("div");
    el.className = "artist-timeline__entry";
    if (entry.isWin) el.classList.add("artist-timeline__entry--win");

    if (entry.type === "chart") {
      // Source logo + show name
      const sourceRow = document.createElement("div");
      sourceRow.className = "artist-timeline__entry-source";

      if (entry.source && SOURCE_LOGOS[entry.source]) {
        const logo = document.createElement("img");
        logo.src = SOURCE_LOGOS[entry.source];
        logo.alt = SOURCE_LABELS[entry.source] ?? entry.source;
        logo.width = 20;
        logo.height = 20;
        logo.className = "artist-timeline__source-logo";
        sourceRow.appendChild(logo);
      }

      const showText = document.createElement("span");
      showText.className = "artist-timeline__show-text";
      showText.textContent = `${SOURCE_LABELS[entry.source ?? ""] ?? entry.source} Ep.${entry.episode}`;
      sourceRow.appendChild(showText);

      el.appendChild(sourceRow);

      // Song title + points
      const infoRow = document.createElement("div");
      infoRow.className = "artist-timeline__entry-info";

      const songTitle = document.createElement("span");
      songTitle.className = "artist-timeline__song-title";
      songTitle.textContent = entry.releaseTitle;
      infoRow.appendChild(songTitle);

      const points = document.createElement("span");
      points.className = "artist-timeline__entry-points";
      points.textContent = (entry.value ?? 0).toLocaleString() + " pts";
      infoRow.appendChild(points);

      el.appendChild(infoRow);

      // Crown if win
      if (entry.isWin && entry.crownLevel) {
        const crownRow = document.createElement("div");
        crownRow.className = "artist-timeline__crown";
        const crownLevel = Math.min(entry.crownLevel, 12);
        const crownImg = document.createElement("img");
        crownImg.src = `assets/crowns/crown-${crownLevel}.svg`;
        crownImg.alt = `${entry.crownLevel} win(s)`;
        crownImg.width = 24;
        crownImg.height = 24;
        crownRow.appendChild(crownImg);

        const crownLabel = document.createElement("span");
        crownLabel.className = "artist-timeline__crown-label";
        crownLabel.textContent = this.getCrownLabel(entry.crownLevel);
        crownRow.appendChild(crownLabel);

        el.appendChild(crownRow);
      }
    } else {
      // Embed entry
      const typeLabel = document.createElement("div");
      typeLabel.className = "artist-timeline__embed-type";
      typeLabel.textContent = this.formatEmbedType(entry.embedType ?? "");
      el.appendChild(typeLabel);

      const songLabel = document.createElement("div");
      songLabel.className = "artist-timeline__embed-song";
      songLabel.textContent = entry.releaseTitle;
      el.appendChild(songLabel);

      // YouTube embed for video types
      if (entry.embedUrl && entry.embedType !== "release_date") {
        const embedContainer = document.createElement("div");
        embedContainer.className = "artist-timeline__embed";
        const iframe = document.createElement("iframe");
        const videoId = this.extractYoutubeId(entry.embedUrl);
        iframe.src = videoId
          ? `https://www.youtube.com/embed/${videoId}`
          : entry.embedUrl.replace("watch?v=", "embed/");
        iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        iframe.allowFullscreen = true;
        iframe.loading = "lazy";
        iframe.title = `${entry.releaseTitle} - ${entry.embedType}`;
        embedContainer.appendChild(iframe);
        el.appendChild(embedContainer);
      }
    }

    return el;
  }

  private formatDate(dateStr: string): string {
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  }

  private formatEmbedType(type: string): string {
    const labels: Record<string, string> = {
      mv: "Music Video",
      trailer: "Trailer",
      live_performance: "Live Performance",
      release_date: "Release Date",
      chart_performance: "Chart Performance",
      promotion: "Promotion",
      behind_the_scenes: "Behind the Scenes",
      dance_practice: "Dance Practice",
      variety_show: "Variety Show",
      fan_event: "Fan Event",
    };
    return labels[type] ?? type.replace(/_/g, " ");
  }

  private getCrownLabel(level: number): string {
    if (level === 1) return "Win";
    if (level === 2) return "2nd Win";
    if (level === 3) return "Triple Crown";
    if (level % 3 === 0) {
      const tripleCount = level / 3;
      if (tripleCount === 1) return "Triple Crown";
      return `${this.getOrdinal(tripleCount)} Triple Crown`;
    }
    return `${this.getOrdinal(level)} Win`;
  }

  private getOrdinal(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n}st`;
    if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
    if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
    return `${n}th`;
  }

  private extractYoutubeId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }
}
