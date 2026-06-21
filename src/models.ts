/**
 * Runtime models computed after parsing JSON data files.
 * These types are used internally by the application engine and UI.
 */

import type {
  ArtistType,
  DailyValueEntry,
  EventType,
} from "./types.ts";

/** A parsed embed date entry with event type and url */
export interface ParsedEmbedDateEntry {
  type: EventType;
  url: string;
}

/** A parsed release with Maps instead of Records for efficient lookup */
export interface ParsedRelease {
  id: string;
  title: string;
  dailyValues: Map<string, DailyValueEntry>;
  embeds: Map<string, ParsedEmbedDateEntry[]>;
  /** Ordered array of artist IDs credited on this release (1–20 entries) */
  artistIds: string[];
}

/** A resolved artist with all display-relevant fields */
export interface ResolvedArtist {
  id: string;
  name: string;
  logoUrl: string;
  artistType: ArtistType;
  generation: number;
}

/** An album/EP release linked to an Apple Music URL, shown on the timeline */
export interface AlbumRelease {
  date: string;
  appleMusicUrl: string;
  isSingle: boolean;
  /** Ordered array of artist IDs credited on this release */
  artistIds: string[];
}

/** A fully parsed artist with a derived id and parsed releases */
export interface ParsedArtist {
  id: string;
  name: string;
  artistType: ArtistType;
  generation: number;
  logoUrl: string;
  koreanName?: string;
  debut?: string;
  releases: ParsedRelease[];
  albumReleases: AlbumRelease[];
}

/** Information about the featured release for a ranked entry */
export interface FeaturedReleaseInfo {
  title: string;
  releaseId: string;
}

/** A single ranked entry in a chart snapshot */
export interface RankedEntry {
  artistId: string;
  artistName: string;
  artistType: ArtistType;
  generation: number;
  logoUrl: string;
  cumulativeValue: number;
  previousCumulativeValue: number;
  dailyValue: number;
  rank: number;
  previousRank: number;
  featuredRelease: FeaturedReleaseInfo;
  /** True if this entry is included only as a goalpost (inactive target above an active artist) */
  isGoalpost: boolean;
  /** In Songs mode, the unique release identifier (format: `${artistId}::${releaseId}`) */
  releaseKey?: string;
  /** In Songs mode, array of resolved artist data for co-artists */
  coArtists?: ResolvedArtist[];
  /** Display mode that produced this entry */
  mode?: "songs" | "artists";
}

/** A snapshot of the chart state for a given date */
export interface ChartSnapshot {
  date: string;
  entries: RankedEntry[];
}

/** The central data store built from all loaded JSON files */
export interface DataStore {
  artists: Map<string, ParsedArtist>;
  dates: string[];
  startDate: string;
  endDate: string;
  /** Maps artistId → earliest date the artist has any dailyValue data */
  firstAppearance: Map<string, string>;
  chartWins: Map<
    string,
    Map<
      string,
      {
        artistIds: string[];
        crownLevels: Map<string, number>;
      }
    >
  >;
  /**
   * Maps releaseKey (format: `${artistId}::${releaseId}`) to a sorted array
   * of dates on which that release won a chart show.
   * Multiple entries for the same date are possible (wins on different sources).
   * Array is sorted chronologically for efficient binary-search lookups.
   */
  releaseWinDates: Map<string, string[]>;
}
