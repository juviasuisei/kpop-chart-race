/**
 * Episode Browser — scrollable card-based view of chart show episodes.
 * Extracts episodes from DataStore dailyValues, groups by (source, episode, date),
 * and renders cards with chart entries, winners, and expandable performances.
 */

import type { DataStore, ParsedArtist, ParsedRelease } from "../models.ts";

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

/** A single chart entry within an episode */
interface EpisodeChartEntry {
  artistId: string;
  artistName: string;
  releaseTitle: string;
  value: number;
}

/** A live performance embed for an episode */
interface EpisodePerformance {
  artistName: string;
  releaseTitle: string;
  url: string;
}

/** A fully resolved episode */
interface Episode {
  source: string;
  episode: number;
  date: string;
  entries: EpisodeChartEntry[];
  winner: { artistName: string; releaseTitle: string; crownLevel: number } | null;
  performances: EpisodePerformance[];
}

export class EpisodeBrowser {
  private container: HTMLElement | null = null;
  private dataStore: DataStore | null = null;
  private episodes: Episode[] = [];
  private filteredEpisodes: Episode[] = [];
  private sourceFilter = "all";
  private displayedCount = 0;
  private scrollContainer: HTMLElement | null = null;
  private readonly PAGE_SIZE = 20;

  /** Callback when an artist name is clicked */
  onArtistClick: ((artistId: string) => void) | null = null;

  mount(container: HTMLElement, dataStore: DataStore): void {
    this.container = container;
    this.dataStore = dataStore;
    this.extractEpisodes();
    this.applyFilter();
    this.render();
  }

  setSourceFilter(source: string): void {
    if (this.sourceFilter === source) return;
    this.sourceFilter = source;
    this.applyFilter();
    this.render();
  }

  unmount(): void {
    if (this.container) {
      this.container.innerHTML = "";
    }
    this.scrollContainer = null;
    this.container = null;
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private extractEpisodes(): void {
    if (!this.dataStore) return;

    // Group entries by (source, episode, date) key
    const episodeMap = new Map<
      string,
      { source: string; episode: number; date: string; entries: EpisodeChartEntry[]; performances: EpisodePerformance[] }
    >();

    for (const [artistId, artist] of this.dataStore.artists) {
      for (const release of artist.releases) {
        this.extractFromRelease(artistId, artist, release, episodeMap);
      }
    }

    // Convert map to array, resolve winners, sort by date desc
    this.episodes = [];
    for (const ep of episodeMap.values()) {
      // Sort entries by value desc, take top 10
      ep.entries.sort((a, b) => b.value - a.value);

      // Resolve winner from chartWins
      let winner: Episode["winner"] = null;
      if (this.dataStore.chartWins.has(ep.date)) {
        const dateWins = this.dataStore.chartWins.get(ep.date)!;
        if (dateWins.has(ep.source)) {
          const winData = dateWins.get(ep.source)!;
          if (winData.artistIds.length > 0) {
            const winnerArtistId = winData.artistIds[0];
            const winnerArtist = this.dataStore.artists.get(winnerArtistId);
            const crownLevel = winData.crownLevels.get(winnerArtistId) ?? 1;
            // Find the release title from the top entry
            const winnerEntry = ep.entries.find(e => e.artistId === winnerArtistId);
            winner = {
              artistName: winnerArtist?.name ?? winnerArtistId,
              releaseTitle: winnerEntry?.releaseTitle ?? "",
              crownLevel,
            };
          }
        }
      }

      this.episodes.push({
        source: ep.source,
        episode: ep.episode,
        date: ep.date,
        entries: ep.entries.slice(0, 10),
        winner,
        performances: ep.performances,
      });
    }

    // Sort by date desc (most recent first)
    this.episodes.sort((a, b) => b.date.localeCompare(a.date));
  }

  private extractFromRelease(
    artistId: string,
    artist: ParsedArtist,
    release: ParsedRelease,
    episodeMap: Map<string, { source: string; episode: number; date: string; entries: EpisodeChartEntry[]; performances: EpisodePerformance[] }>,
  ): void {
    for (const [date, dv] of release.dailyValues) {
      const key = `${dv.source}::${dv.episode}::${date}`;
      if (!episodeMap.has(key)) {
        episodeMap.set(key, {
          source: dv.source,
          episode: dv.episode,
          date,
          entries: [],
          performances: [],
        });
      }
      const ep = episodeMap.get(key)!;
      ep.entries.push({
        artistId,
        artistName: artist.name,
        releaseTitle: release.title,
        value: dv.value,
      });
    }

    // Extract live performances for this release
    for (const [date, embeds] of release.embeds) {
      const livePerformances = embeds.filter(e => e.type === "live_performance");
      if (livePerformances.length === 0) continue;

      // Check if this date has a dailyValue (i.e., belongs to an episode)
      const dv = release.dailyValues.get(date);
      if (!dv) continue;

      const key = `${dv.source}::${dv.episode}::${date}`;
      const ep = episodeMap.get(key);
      if (!ep) continue;

      for (const perf of livePerformances) {
        ep.performances.push({
          artistName: artist.name,
          releaseTitle: release.title,
          url: perf.url,
        });
      }
    }
  }

  private applyFilter(): void {
    if (this.sourceFilter === "all") {
      this.filteredEpisodes = this.episodes;
    } else {
      this.filteredEpisodes = this.episodes.filter(ep => ep.source === this.sourceFilter);
    }
    this.displayedCount = 0;
  }

  private render(): void {
    if (!this.container) return;
    this.container.innerHTML = "";

    this.scrollContainer = document.createElement("div");
    this.scrollContainer.className = "episode-browser";

    this.displayedCount = 0;
    this.loadMore();

    // Scroll listener for virtual scrolling
    this.scrollContainer.addEventListener("scroll", () => {
      this.handleScroll();
    });

    this.container.appendChild(this.scrollContainer);
  }

  private loadMore(): void {
    if (!this.scrollContainer) return;
    const start = this.displayedCount;
    const end = Math.min(start + this.PAGE_SIZE, this.filteredEpisodes.length);

    for (let i = start; i < end; i++) {
      const card = this.createCard(this.filteredEpisodes[i]);
      this.scrollContainer.appendChild(card);
    }

    this.displayedCount = end;
  }

  private handleScroll(): void {
    if (!this.scrollContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = this.scrollContainer;
    // Load more when within 200px of bottom
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      if (this.displayedCount < this.filteredEpisodes.length) {
        this.loadMore();
      }
    }
  }

  private createCard(episode: Episode): HTMLElement {
    const card = document.createElement("div");
    card.className = "episode-card";

    // Header
    const header = document.createElement("div");
    header.className = "episode-card__header";

    const logo = document.createElement("img");
    logo.className = "episode-card__show-logo";
    logo.src = SOURCE_LOGOS[episode.source] ?? "";
    logo.alt = SOURCE_LABELS[episode.source] ?? episode.source;
    logo.width = 28;
    logo.height = 28;
    header.appendChild(logo);

    const showName = document.createElement("span");
    showName.className = "episode-card__show-name";
    showName.textContent = SOURCE_LABELS[episode.source] ?? episode.source;
    header.appendChild(showName);

    const episodeNum = document.createElement("span");
    episodeNum.className = "episode-card__episode-num";
    episodeNum.textContent = `Episode #${episode.episode}`;
    header.appendChild(episodeNum);

    const dateEl = document.createElement("span");
    dateEl.className = "episode-card__date";
    dateEl.textContent = episode.date;
    header.appendChild(dateEl);

    card.appendChild(header);

    // Chart entries — show top 3 by default, expandable to full list
    const chart = document.createElement("div");
    chart.className = "episode-card__chart";

    // Build a map of performances by artistId+releaseTitle for inline embeds
    const perfMap = new Map<string, string>(); // key → url
    for (const perf of episode.performances) {
      perfMap.set(`${perf.artistName}::${perf.releaseTitle}`, perf.url);
    }

    for (let i = 0; i < episode.entries.length; i++) {
      const entry = episode.entries[i];
      const row = document.createElement("div");
      row.className = "episode-card__chart-entry";
      if (i >= 3) row.classList.add("episode-card__chart-entry--hidden");

      // Rank: #1 gets crown SVG, others get rank number
      if (i === 0 && episode.winner) {
        const crownLevel = Math.min(episode.winner.crownLevel, 12);
        // Crown height scales with level: levels 1-6 → 24px, 7-9 → 36px, 10+ → 48px
        const crownHeight = crownLevel >= 10 ? 48 : crownLevel >= 7 ? 36 : 24;
        const crownContainer = document.createElement("span");
        crownContainer.className = "episode-card__rank episode-card__rank--crown";
        crownContainer.style.height = `${crownHeight}px`;
        const crownImg = document.createElement("img");
        crownImg.className = "episode-card__crown";
        crownImg.src = `assets/crowns/crown-${crownLevel}.svg`;
        crownImg.alt = `${episode.winner.crownLevel} win(s)`;
        crownImg.style.height = `${crownHeight}px`;
        crownImg.style.width = "auto";
        crownContainer.appendChild(crownImg);
        row.appendChild(crownContainer);
      } else {
        const rank = document.createElement("span");
        rank.className = "episode-card__rank";
        rank.textContent = `#${i + 1}`;
        row.appendChild(rank);
      }

      const info = document.createElement("span");
      info.className = "episode-card__entry-info";

      const artistLink = document.createElement("a");
      artistLink.className = "episode-card__artist-link";
      artistLink.textContent = entry.artistName;
      artistLink.href = "#";
      artistLink.addEventListener("click", (e) => {
        e.preventDefault();
        if (this.onArtistClick) {
          this.onArtistClick(entry.artistId);
        }
      });
      info.appendChild(artistLink);

      const separator = document.createTextNode(" \u2014 " + entry.releaseTitle);
      info.appendChild(separator);

      row.appendChild(info);

      const points = document.createElement("span");
      points.className = "episode-card__entry-points";
      points.textContent = entry.value.toLocaleString();
      row.appendChild(points);

      chart.appendChild(row);

      // Inline live performance embed below this entry (if exists)
      const perfKey = `${entry.artistName}::${entry.releaseTitle}`;
      const perfUrl = perfMap.get(perfKey);
      if (perfUrl) {
        const embedContainer = document.createElement("div");
        embedContainer.className = "episode-card__embed";
        if (i >= 3) embedContainer.classList.add("episode-card__chart-entry--hidden");

        const iframe = document.createElement("iframe");
        const videoId = this.extractYoutubeId(perfUrl);
        iframe.src = videoId ? `https://www.youtube.com/embed/${videoId}` : perfUrl.replace("watch?v=", "embed/");
        iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        iframe.allowFullscreen = true;
        iframe.loading = "lazy";
        iframe.title = `${entry.artistName} - ${entry.releaseTitle}`;
        embedContainer.appendChild(iframe);

        chart.appendChild(embedContainer);
      }
    }

    // "Show all" toggle if more than 3 entries
    if (episode.entries.length > 3) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "episode-card__expand-toggle";
      toggle.textContent = `Show all (${episode.entries.length})`;
      toggle.addEventListener("click", () => {
        const hidden = chart.querySelectorAll(".episode-card__chart-entry--hidden");
        hidden.forEach(el => el.classList.remove("episode-card__chart-entry--hidden"));
        toggle.style.display = "none";
      });
      chart.appendChild(toggle);
    }

    card.appendChild(chart);

    return card;
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
