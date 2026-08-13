/**
 * Artist Timeline — full chronological view of a single artist's activity.
 * Shows chart appearances, wins, live performances, and releases grouped by date.
 */

import type { DataStore, ParsedArtist } from "../models.ts";
import { ARTIST_TYPE_COLORS } from "../colors.ts";
import { generateFallbackLogoDataUri } from "../utils.ts";

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

/** A single song line within a merged show card */
interface SongLine {
  releaseTitle: string;
  value: number;
  isWin: boolean;
  crownLevel: number;
  /** Live performance URL for this song (if available) */
  performanceUrl?: string;
}

/** A merged show card (multiple songs on the same show episode) */
interface MergedShowEntry {
  type: "chart";
  source: string;
  episode: number;
  date: string;
  songs: SongLine[];
}

/** An embed timeline entry */
interface EmbedEntry {
  type: "embed";
  releaseTitle: string;
  embedType: string;
  embedUrl: string;
}

/** An album release timeline entry */
interface AlbumReleaseEntry {
  type: "album-release";
  isSingle: boolean;
  appleMusicUrl: string;
}

type TimelineEntry = MergedShowEntry | EmbedEntry | AlbumReleaseEntry;

export class ArtistTimeline {
  private container: HTMLElement | null = null;
  private dataStore: DataStore | null = null;
  private artistId: string | null = null;
  private sourceFilter: string = "all";

  /** Callback fired when a show episode link is clicked */
  onEpisodeClick: ((source: string, episode: number, date: string) => void) | null = null;

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

  setSourceFilter(source: string): void {
    if (this.sourceFilter === source) return;
    this.sourceFilter = source;
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

    const typeColor = ARTIST_TYPE_COLORS[artist.artistType] ?? "#213547";

    const wrapper = document.createElement("div");
    wrapper.className = "artist-timeline";

    // Header
    wrapper.appendChild(this.createHeader(artist, typeColor));

    // Build date-grouped entries
    const dateMap = this.buildDateMap(artist);

    // Sort dates descending (most recent first)
    const sortedDates = Array.from(dateMap.keys()).sort((a, b) => b.localeCompare(a));

    for (const date of sortedDates) {
      const entries = dateMap.get(date)!;
      const group = this.createDateGroup(date, entries, typeColor);
      wrapper.appendChild(group);
    }

    this.container.appendChild(wrapper);
  }

  private createHeader(artist: ParsedArtist, typeColor: string): HTMLElement {
    const header = document.createElement("div");
    header.className = "artist-timeline__header";

    // Logo with colored background
    const logoBg = document.createElement("div");
    logoBg.className = "artist-timeline__logo-bg";
    logoBg.style.backgroundColor = typeColor;

    const logo = document.createElement("img");
    logo.className = "artist-timeline__logo";
    logo.src = artist.logoUrl;
    logo.alt = artist.name;
    logo.width = 64;
    logo.height = 64;
    logo.onerror = () => {
      logo.src = generateFallbackLogoDataUri(artist.koreanName ?? artist.name);
    };
    logoBg.appendChild(logo);
    header.appendChild(logoBg);

    // Name
    const name = document.createElement("div");
    name.className = "artist-timeline__name";
    if (artist.koreanName) {
      const eng = document.createElement("span");
      eng.textContent = artist.name;
      name.appendChild(eng);
      const kr = document.createElement("span");
      kr.className = "artist-timeline__name-kr";
      kr.textContent = ` (${artist.koreanName})`;
      name.appendChild(kr);
    } else {
      name.textContent = artist.name;
    }
    header.appendChild(name);

    // Type + Generation + Debut
    const meta = document.createElement("div");
    meta.className = "artist-timeline__meta";
    const typeLabel = ARTIST_TYPE_LABELS[artist.artistType] ?? artist.artistType;
    let metaText = `${typeLabel} · Gen ${artist.generation}`;
    if (artist.debut) {
      const debutPrefix = artist.artistType === "solo_male" || artist.artistType === "solo_female"
        ? "Solo Debut"
        : "Debut";
      metaText += ` · ${debutPrefix}: ${artist.debut}`;
    }
    meta.textContent = metaText;
    header.appendChild(meta);

    // Stats (without Active)
    const stats = this.computeStats(artist);
    const statsEl = document.createElement("div");
    statsEl.className = "artist-timeline__stats";
    statsEl.innerHTML = `
      <div class="artist-timeline__stat"><span class="artist-timeline__stat-value">${stats.totalPoints.toLocaleString()}</span><span class="artist-timeline__stat-label">Points</span></div>
      <div class="artist-timeline__stat"><span class="artist-timeline__stat-value">${stats.totalWins}</span><span class="artist-timeline__stat-label">Wins</span></div>
      <div class="artist-timeline__stat"><span class="artist-timeline__stat-value">${stats.releaseCount}</span><span class="artist-timeline__stat-label">Releases</span></div>
    `;
    header.appendChild(statsEl);

    return header;
  }

  private computeStats(artist: ParsedArtist): {
    totalPoints: number;
    totalWins: number;
    releaseCount: number;
  } {
    let totalPoints = 0;
    let totalWins = 0;

    for (const release of artist.releases) {
      for (const [, dv] of release.dailyValues) {
        if (this.sourceFilter !== "all" && dv.source !== this.sourceFilter) continue;
        totalPoints += dv.value;
      }
    }

    // Count wins from chartWins
    if (this.dataStore) {
      for (const [, sourceMap] of this.dataStore.chartWins) {
        for (const [source, winData] of sourceMap) {
          if (this.sourceFilter !== "all" && source !== this.sourceFilter) continue;
          if (winData.artistIds.includes(artist.id)) {
            totalWins++;
          }
        }
      }
    }

    // Count releases that have data for this source
    let releaseCount: number;
    if (this.sourceFilter === "all") {
      releaseCount = artist.releases.length;
    } else {
      releaseCount = artist.releases.filter(r =>
        Array.from(r.dailyValues.values()).some(dv => dv.source === this.sourceFilter)
      ).length;
    }

    return { totalPoints, totalWins, releaseCount };
  }

  private buildDateMap(artist: ParsedArtist): Map<string, TimelineEntry[]> {
    const dateMap = new Map<string, TimelineEntry[]>();

    // Intermediate structure: group chart entries by show key within each date
    // Key: date → showKey → SongLine[]
    const chartGrouped = new Map<string, Map<string, { source: string; episode: number; songs: SongLine[] }>>();

    // Collect live performance URLs by date+release to merge into show cards
    const performancesByDateRelease = new Map<string, string>();

    for (const release of artist.releases) {
      // Chart appearances (dailyValues)
      for (const [date, dv] of release.dailyValues) {
        // Apply source filter
        if (this.sourceFilter !== "all" && dv.source !== this.sourceFilter) continue;

        if (!chartGrouped.has(date)) chartGrouped.set(date, new Map());
        const dateShows = chartGrouped.get(date)!;

        const showKey = `${dv.source}::${dv.episode}::${date}`;

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

        if (!dateShows.has(showKey)) {
          dateShows.set(showKey, { source: dv.source, episode: dv.episode, songs: [] });
        }
        dateShows.get(showKey)!.songs.push({
          releaseTitle: release.title,
          value: dv.value,
          isWin,
          crownLevel,
        });
      }

      // Embeds
      for (const [date, embeds] of release.embeds) {
        for (const embed of embeds) {
          // Live performances will be merged into show cards later
          if (embed.type === "live_performance") {
            if (embed.url) {
              const key = `${date}::${release.title}`;
              performancesByDateRelease.set(key, embed.url);
            }
            continue;
          }

          if (!dateMap.has(date)) dateMap.set(date, []);
          dateMap.get(date)!.push({
            type: "embed",
            releaseTitle: release.title,
            embedType: embed.type,
            embedUrl: embed.url,
          });
        }
      }
    }

    // Convert chartGrouped into merged show entries
    for (const [date, showMap] of chartGrouped) {
      if (!dateMap.has(date)) dateMap.set(date, []);
      const entries = dateMap.get(date)!;

      for (const [, show] of showMap) {
        // Attach performance URLs to matching songs
        for (const song of show.songs) {
          const key = `${date}::${song.releaseTitle}`;
          const perfUrl = performancesByDateRelease.get(key);
          if (perfUrl) song.performanceUrl = perfUrl;
        }

        // Sort songs within show: wins first, then by value desc
        show.songs.sort((a, b) => {
          if (a.isWin && !b.isWin) return -1;
          if (!a.isWin && b.isWin) return 1;
          return b.value - a.value;
        });

        entries.push({
          type: "chart",
          source: show.source,
          episode: show.episode,
          date,
          songs: show.songs,
        });
      }
    }

    // Add album releases to the dateMap
    for (const albumRelease of artist.albumReleases) {
      const date = albumRelease.date;
      if (!dateMap.has(date)) dateMap.set(date, []);
      dateMap.get(date)!.push({
        type: "album-release",
        isSingle: albumRelease.isSingle,
        appleMusicUrl: albumRelease.appleMusicUrl,
      });
    }

    // Sort entries within each date: chart (with wins first) → album releases → embeds
    for (const [, entries] of dateMap) {
      entries.sort((a, b) => {
        const order = { chart: 0, "album-release": 1, embed: 2 };
        const aOrder = order[a.type] ?? 99;
        const bOrder = order[b.type] ?? 99;
        if (aOrder !== bOrder) return aOrder - bOrder;
        // Within chart: entries with a win come first
        if (a.type === "chart" && b.type === "chart") {
          const aHasWin = a.songs.some((s) => s.isWin);
          const bHasWin = b.songs.some((s) => s.isWin);
          if (aHasWin && !bHasWin) return -1;
          if (!aHasWin && bHasWin) return 1;
          // Then by total value desc
          const aTotal = a.songs.reduce((sum, s) => sum + s.value, 0);
          const bTotal = b.songs.reduce((sum, s) => sum + s.value, 0);
          return bTotal - aTotal;
        }
        return 0;
      });
    }

    return dateMap;
  }

  private createDateGroup(date: string, entries: TimelineEntry[], typeColor: string): HTMLElement {
    const group = document.createElement("div");
    group.className = "artist-timeline__date-group";

    const dateHeader = document.createElement("div");
    dateHeader.className = "artist-timeline__date-header";
    dateHeader.textContent = this.formatDate(date);
    dateHeader.style.color = typeColor;
    group.appendChild(dateHeader);

    for (const entry of entries) {
      group.appendChild(this.createEntry(entry));
    }

    return group;
  }

  private createEntry(entry: TimelineEntry): HTMLElement {
    const el = document.createElement("div");
    el.className = "artist-timeline__entry";

    if (entry.type === "chart") {
      // Source logo + show name + episode (clickable)
      const sourceRow = document.createElement("div");
      sourceRow.className = "artist-timeline__entry-source";

      if (SOURCE_LOGOS[entry.source]) {
        const logo = document.createElement("img");
        logo.src = SOURCE_LOGOS[entry.source];
        logo.alt = SOURCE_LABELS[entry.source] ?? entry.source;
        logo.width = 20;
        logo.height = 20;
        logo.className = "artist-timeline__source-logo";
        sourceRow.appendChild(logo);
      }

      const showText = document.createElement("a");
      showText.className = "artist-timeline__show-text artist-timeline__show-link";
      showText.textContent = `${SOURCE_LABELS[entry.source] ?? entry.source} Ep.${entry.episode}`;
      showText.href = "#";
      showText.addEventListener("click", (e) => {
        e.preventDefault();
        if (this.onEpisodeClick) {
          this.onEpisodeClick(entry.source, entry.episode, entry.date);
        }
      });
      sourceRow.appendChild(showText);

      el.appendChild(sourceRow);

      // Song lines
      for (const song of entry.songs) {
        const songRow = document.createElement("div");
        songRow.className = "artist-timeline__song-line";

        const songTitle = document.createElement("span");
        songTitle.className = "artist-timeline__song-title";
        songTitle.textContent = song.releaseTitle;
        songRow.appendChild(songTitle);

        const pointsWrap = document.createElement("span");
        pointsWrap.className = "artist-timeline__points-wrap";

        // Crown to the left of the point value if this song won
        if (song.isWin && song.crownLevel) {
          const crownLevel = Math.min(song.crownLevel, 12);
          const crownImg = document.createElement("img");
          crownImg.src = `assets/crowns/crown-${crownLevel}.svg`;
          crownImg.alt = `${song.crownLevel} win(s)`;
          crownImg.width = 16;
          crownImg.height = 16;
          crownImg.className = "artist-timeline__inline-crown";
          pointsWrap.appendChild(crownImg);
        }

        const points = document.createElement("span");
        points.className = "artist-timeline__entry-points";
        points.textContent = song.value.toLocaleString() + " pts";
        pointsWrap.appendChild(points);

        songRow.appendChild(pointsWrap);
        el.appendChild(songRow);

        // Live performance video under this song
        if (song.performanceUrl) {
          const embedContainer = document.createElement("div");
          embedContainer.className = "artist-timeline__embed";
          const iframe = document.createElement("iframe");
          const videoId = this.extractYoutubeId(song.performanceUrl);
          iframe.src = videoId
            ? `https://www.youtube.com/embed/${videoId}`
            : song.performanceUrl.replace("watch?v=", "embed/");
          iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
          iframe.allowFullscreen = true;
          iframe.loading = "lazy";
          iframe.title = `${song.releaseTitle} - Live Performance`;
          embedContainer.appendChild(iframe);
          el.appendChild(embedContainer);
        }
      }
    } else if (entry.type === "album-release") {
      // Album/single release entry with Apple Music embed
      const typeLabel = document.createElement("div");
      typeLabel.className = "artist-timeline__embed-type";
      typeLabel.textContent = entry.isSingle ? "Single" : "Release";
      el.appendChild(typeLabel);

      if (entry.appleMusicUrl) {
        // Convert Apple Music URL to embed URL
        const embedUrl = entry.appleMusicUrl.replace("music.apple.com", "embed.music.apple.com");
        const embedContainer = document.createElement("div");
        embedContainer.className = "artist-timeline__embed artist-timeline__embed--apple";
        const iframe = document.createElement("iframe");
        iframe.src = embedUrl;
        iframe.allow = "autoplay *; encrypted-media *; fullscreen *; clipboard-write";
        iframe.setAttribute("sandbox", "allow-forms allow-popups allow-same-origin allow-scripts allow-top-navigation-by-user-activation");
        iframe.loading = "lazy";
        iframe.title = entry.isSingle ? "Single on Apple Music" : "Album on Apple Music";
        embedContainer.appendChild(iframe);
        el.appendChild(embedContainer);
      }
    } else {
      // Embed entry
      const typeLabel = document.createElement("div");
      typeLabel.className = "artist-timeline__embed-type";
      typeLabel.textContent = this.formatEmbedType(entry.embedType);
      el.appendChild(typeLabel);

      // Show song name for non-MV embeds (live performances, etc.) when title exists
      if (entry.embedType !== "mv" && entry.releaseTitle) {
        const songLabel = document.createElement("div");
        songLabel.className = "artist-timeline__embed-song";
        songLabel.textContent = entry.releaseTitle;
        el.appendChild(songLabel);
      }

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
        iframe.title = entry.releaseTitle
          ? `${entry.releaseTitle} - ${this.formatEmbedType(entry.embedType)}`
          : this.formatEmbedType(entry.embedType);
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
