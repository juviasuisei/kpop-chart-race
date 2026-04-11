/**
 * Runtime models computed after parsing JSON data files.
 * These types are used internally by the application engine and UI.
 */

import type {
  ArtistType,
  DailyValueEntry,
  EventType,
} from "./types.ts";

/** A parsed embed link (mirrors EmbedLink but used in runtime context) */
export interface ParsedEmbedLink {
  url: string;
  description?: string;
}

/** A parsed embed date entry with event type and links */
export interface ParsedEmbedDateEntry {
  eventType: EventType;
  links: ParsedEmbedLink[];
}

/** A parsed release with Maps instead of Records for efficient lookup */
export interface ParsedRelease {
  id: string;
  title: string;
  dailyValues: Map<string, DailyValueEntry>;
  embeds: Map<string, ParsedEmbedDateEntry[]>;
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
}
