/**
 * MV Browser — scrollable, date-grouped timeline of music-video releases.
 *
 * An "MV" is a release that carries an `mv` embed; the MV's date is the date
 * key of that embed (the day the video dropped). MVs are grouped by that date
 * into cards. Date cards are ordered by the shared date-sort direction
 * ("desc" = most recent first, the default; "asc" = oldest first). WITHIN a
 * date, MVs are ALWAYS ordered by the release's total chart score (sum of all
 * its daily values) descending — the asc/desc toggle only affects the order of
 * the date groups, never the within-date order.
 *
 * Mirrors EpisodeBrowser's filtering, drill-in, and new-tab link conventions.
 */

import type { DataStore, ParsedArtist, ParsedRelease } from "../models.ts";
import { isNewTabIntent } from "../url-state.ts";

/** A single music video, resolved for display. */
interface MvItem {
  /** Date the MV was released (YYYY-MM-DD) — the `mv` embed's date key. */
  date: string;
  /** Primary artist ID (first in artistIds) — used for lookups. */
  artistId: string;
  releaseTitle: string;
  /** The MV embed URL (typically YouTube). */
  url: string;
  /** Sum of all the release's daily chart values — the within-date sort key. */
  totalScore: number;
  /** All artist IDs credited on this release. */
  artistIds: string[];
}

/** A date group: all MVs released on the same day. */
interface MvDateGroup {
  date: string;
  items: MvItem[];
}

export class MvBrowser {
  private container: HTMLElement | null = null;
  private dataStore: DataStore | null = null;
  private items: MvItem[] = [];
  private filteredGroups: MvDateGroup[] = [];
  private generationFilter: number | "all" = "all";
  private artistFilter = "all";
  /** Date-group sort direction (shared with the episode browser). */
  private dateSort: "desc" | "asc" = "desc";
  private displayedCount = 0;
  private scrollContainer: HTMLElement | null = null;
  private scrollHandler: (() => void) | null = null;
  /** Number of date groups rendered per page (infinite scroll). */
  private readonly PAGE_SIZE = 15;

  /** Callback when an artist name is clicked (plain left-click, in-place nav). */
  onArtistClick: ((artistId: string) => void) | null = null;

  /**
   * Resolver for the shareable URL an artist link points to. When provided,
   * the link becomes a real navigable href so modifier/middle clicks open it
   * in a new tab natively. Falls back to "#" when not set.
   */
  artistUrl: ((artistId: string) => string) | null = null;

  mount(container: HTMLElement, dataStore: DataStore): void {
    this.container = container;
    this.dataStore = dataStore;
    this.extractMvs();
    this.applyFilter();
    this.render();
  }

  setGenerationFilter(generation: number | "all"): void {
    if (this.generationFilter === generation) return;
    this.generationFilter = generation;
    this.applyFilter();
    this.render();
  }

  setArtistFilter(artist: string): void {
    if (this.artistFilter === artist) return;
    this.artistFilter = artist;
    this.applyFilter();
    this.render();
  }

  /**
   * Set the date-group sort direction ("desc" = most recent first, the
   * default; "asc" = oldest first). Only reorders the date groups; the
   * within-date order (total score desc) is unaffected. No-op if unchanged.
   */
  setDateSort(order: "desc" | "asc"): void {
    if (this.dateSort === order) return;
    this.dateSort = order;
    this.applyFilter();
    this.render();
  }

  unmount(): void {
    if (this.container && this.scrollHandler) {
      this.container.removeEventListener("scroll", this.scrollHandler);
    }
    this.scrollHandler = null;
    if (this.container) {
      this.container.innerHTML = "";
    }
    this.scrollContainer = null;
    this.container = null;
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private extractMvs(): void {
    this.items = [];
    if (!this.dataStore) return;

    for (const [artistId, artist] of this.dataStore.artists) {
      for (const release of artist.releases) {
        this.extractFromRelease(artistId, artist, release);
      }
    }
  }

  private extractFromRelease(
    artistId: string,
    _artist: ParsedArtist,
    release: ParsedRelease,
  ): void {
    // Deduplicate multi-artist releases: only process from the first artist in
    // artistIds (matches EpisodeBrowser), so a collab MV appears once.
    if (release.artistIds.length > 1 && release.artistIds[0] !== artistId) return;

    // Total chart score for this release: sum of every daily value across all
    // sources/episodes. This is the within-date ordering key.
    let totalScore = 0;
    for (const dv of release.dailyValues.values()) {
      totalScore += dv.value;
    }

    // One MV item per `mv` embed (keyed by its date). A release usually has a
    // single MV, but nothing forbids more than one (e.g. a performance MV on a
    // later date), so emit each.
    for (const [date, embeds] of release.embeds) {
      for (const embed of embeds) {
        if (embed.type !== "mv") continue;
        this.items.push({
          date,
          artistId,
          releaseTitle: release.title,
          url: embed.url,
          totalScore,
          artistIds: [...release.artistIds],
        });
      }
    }
  }

  /**
   * True if the MV passes the current artist/generation filters. An MV matches
   * the artist filter when the selected artist is ANY credited artist, and the
   * generation filter when ANY credited artist is of that generation.
   */
  private itemPasses(item: MvItem): boolean {
    if (this.artistFilter !== "all" && !item.artistIds.includes(this.artistFilter)) {
      return false;
    }
    if (this.generationFilter !== "all") {
      const anyMatch = item.artistIds.some(id => {
        const a = this.dataStore?.artists.get(id);
        return a && a.generation === this.generationFilter;
      });
      if (!anyMatch) return false;
    }
    return true;
  }

  private applyFilter(): void {
    // Filter, then group by date.
    const byDate = new Map<string, MvItem[]>();
    for (const item of this.items) {
      if (!this.itemPasses(item)) continue;
      const bucket = byDate.get(item.date);
      if (bucket) {
        bucket.push(item);
      } else {
        byDate.set(item.date, [item]);
      }
    }

    // Within each date: total score DESC, then title as a stable tie-break.
    // (Always desc, regardless of the date-sort toggle.)
    const groups: MvDateGroup[] = [];
    for (const [date, items] of byDate) {
      items.sort(
        (a, b) => b.totalScore - a.totalScore || a.releaseTitle.localeCompare(b.releaseTitle),
      );
      groups.push({ date, items });
    }

    // Order the date groups per the current sort direction.
    groups.sort((a, b) =>
      this.dateSort === "asc"
        ? a.date.localeCompare(b.date)
        : b.date.localeCompare(a.date),
    );

    this.filteredGroups = groups;
    this.displayedCount = 0;
  }

  private render(): void {
    if (!this.container) return;

    if (this.scrollHandler) {
      this.container.removeEventListener("scroll", this.scrollHandler);
      this.scrollHandler = null;
    }

    this.container.innerHTML = "";

    this.scrollContainer = document.createElement("div");
    this.scrollContainer.className = "mv-browser";

    if (this.filteredGroups.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mv-browser__empty";
      empty.textContent = "No music videos match the current filters.";
      this.scrollContainer.appendChild(empty);
      this.container.appendChild(this.scrollContainer);
      return;
    }

    this.displayedCount = 0;
    this.loadMore();

    this.scrollHandler = () => this.handleScroll();
    this.container.addEventListener("scroll", this.scrollHandler);

    this.container.appendChild(this.scrollContainer);
  }

  private loadMore(): void {
    if (!this.scrollContainer) return;
    const start = this.displayedCount;
    const end = Math.min(start + this.PAGE_SIZE, this.filteredGroups.length);

    for (let i = start; i < end; i++) {
      this.scrollContainer.appendChild(this.createCard(this.filteredGroups[i]));
    }

    this.displayedCount = end;
  }

  private handleScroll(): void {
    if (!this.container) return;
    const { scrollTop, scrollHeight, clientHeight } = this.container;
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      if (this.displayedCount < this.filteredGroups.length) {
        this.loadMore();
      }
    }
  }

  private createCard(group: MvDateGroup): HTMLElement {
    const card = document.createElement("div");
    card.className = "mv-card";

    // Header: just the release date for this group.
    const header = document.createElement("div");
    header.className = "mv-card__header";
    const dateEl = document.createElement("span");
    dateEl.className = "mv-card__date";
    dateEl.textContent = group.date;
    header.appendChild(dateEl);
    const count = document.createElement("span");
    count.className = "mv-card__count";
    count.textContent = group.items.length === 1 ? "1 MV" : `${group.items.length} MVs`;
    header.appendChild(count);
    card.appendChild(header);

    // One row per MV, in total-score-desc order.
    const list = document.createElement("div");
    list.className = "mv-card__list";

    for (const item of group.items) {
      list.appendChild(this.createMvRow(item));
    }

    card.appendChild(list);
    return card;
  }

  private createMvRow(item: MvItem): HTMLElement {
    const row = document.createElement("div");
    row.className = "mv-card__item";

    // Text line: artist link(s) — title, with total score on the right.
    const info = document.createElement("div");
    info.className = "mv-card__item-info";

    for (let a = 0; a < item.artistIds.length; a++) {
      const aId = item.artistIds[a];
      const aName = this.dataStore?.artists.get(aId)?.name ?? aId;

      const artistLink = document.createElement("a");
      artistLink.className = "mv-card__artist-link";
      artistLink.textContent = aName;
      artistLink.href = this.artistUrl ? this.artistUrl(aId) : "#";
      artistLink.addEventListener("click", (e) => {
        // Let modifier/middle clicks open the real href in a new tab; only
        // intercept a plain click for in-place navigation.
        if (isNewTabIntent(e)) return;
        e.preventDefault();
        if (this.onArtistClick) this.onArtistClick(aId);
      });
      info.appendChild(artistLink);

      // Oxford-comma separators between credited artists.
      if (item.artistIds.length === 2 && a === 0) {
        info.appendChild(document.createTextNode(" and "));
      } else if (item.artistIds.length > 2 && a < item.artistIds.length - 2) {
        info.appendChild(document.createTextNode(", "));
      } else if (item.artistIds.length > 2 && a === item.artistIds.length - 2) {
        info.appendChild(document.createTextNode(", and "));
      }
    }

    info.appendChild(document.createTextNode(" \u2014 " + item.releaseTitle));

    const score = document.createElement("span");
    score.className = "mv-card__item-score";
    score.textContent = item.totalScore.toLocaleString();
    score.setAttribute("data-tooltip", "Total chart score across all appearances");
    info.appendChild(score);

    row.appendChild(info);

    // MV embed (YouTube iframe when resolvable, otherwise a plain link).
    const videoId = this.extractYoutubeId(item.url);
    if (videoId) {
      const embed = document.createElement("div");
      embed.className = "mv-card__embed";
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube.com/embed/${videoId}`;
      iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      iframe.allowFullscreen = true;
      iframe.loading = "lazy";
      iframe.title = `${item.releaseTitle} MV`;
      embed.appendChild(iframe);
      row.appendChild(embed);
    } else {
      const link = document.createElement("a");
      link.className = "mv-card__watch-link";
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Watch MV \u2197";
      row.appendChild(link);
    }

    return row;
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
