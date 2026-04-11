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
  | "mixed_group";

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

/** A single embed link with a URL and optional description */
export interface EmbedLink {
  url: string;
  description?: string;
}

/** A collection of embeds for a specific event type on a given date */
export interface EmbedDateEntry {
  eventType: EventType;
  links: EmbedLink[];
}

/** A daily performance value entry with source and episode info */
export interface DailyValueEntry {
  value: number;
  source: ChartSource | string;
  episode: number;
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
  logo: string;
  releases: ReleaseEntry[];
}

/** A single JSON data file contains one ArtistEntry */
export type DataFile = ArtistEntry;
