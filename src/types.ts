/**
 * Core data model types for the K-Pop Chart Race application.
 * These types represent the JSON data schema loaded from data files.
 */

/** Classification of a K-pop artist */
export type ArtistType =
  | "boy_group"
  | "girl_group"
  | "solo_male"
  | "solo_female"
  | "mixed_group"
  | "solo_non_binary";

/** Known music show chart sources */
export type ChartSource =
  | "inkigayo"
  | "the_show"
  | "show_champion"
  | "music_bank"
  | "m_countdown"
  | "show_music_core";

/** Content type labels for embed date entries */
export type EventType =
  | "trailer"
  | "mv"
  | "live_performance"
  | "release_date"
  | "chart_performance"
  | "promotion"
  | "behind_the_scenes"
  | "dance_practice"
  | "variety_show"
  | "fan_event";

/** Zoom level for the chart race display */
export type ZoomLevel = 10 | "all";

/** A single embed entry for a specific event type on a given date */
export interface EmbedDateEntry {
  type: EventType;
  url: string;
}

/** A daily performance value entry with source and episode info */
export interface DailyValueEntry {
  value: number;
  source: ChartSource | string;
  episode: number;
  /**
   * True when `value` was estimated by the score-fill curve rather than
   * published by the chart (Music Bank ranks 21–50, M Countdown ranks 2–20).
   * Cosmetic only — used to visually flag estimates in the episode view.
   */
  estimated?: boolean;
}

/** A single release (song/album) by an artist */
export interface ReleaseEntry {
  title: string;
  dailyValues: Record<string, DailyValueEntry>;
  embeds: Record<string, EmbedDateEntry[]>;
}

/** Top-level artist entry as stored in each JSON data file */
export interface ArtistEntry {
  name: string;
  artistType: ArtistType;
  generation: number;
  korean_name?: string;
  debut?: string;
  releases: ReleaseEntry[];
}

/** A single JSON data file contains one ArtistEntry */
export type DataFile = ArtistEntry;

/** Centralized filter state for the toolbar and views */
export interface FilterState {
  displayMode: "songs" | "artists";
  generation: number | "all";
  source: string; // ChartSource | "all"
  artist: string; // artist ID | "all"
  zoom: ZoomLevel; // 10 | "all"
  view: "race" | "episodes" | "yearly" | "line" | "artist-timeline";
  metric: "points" | "wins" | "appearances"; // yearly-view only
  /**
   * Playback position as a date string (YYYY-MM-DD), for a shareable link to a
   * specific frame of the race. Not a filter — it's the current day of the line
   * chart. Only encoded in the race/line view. On load we snap to the nearest
   * available date ≤ this value. Optional/omitted when not applicable.
   */
  date?: string;
  /**
   * Value-axis detail zoom as an integer percentage (5..100) of the auto max.
   * A race/line view setting (not a filter). 100 = full range (omitted).
   */
  detail?: number;
}
