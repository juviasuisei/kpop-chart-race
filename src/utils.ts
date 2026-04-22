/**
 * Utility functions for the K-Pop Chart Race application.
 * Pure functions for interpolation, formatting, layout, filtering, and date mapping.
 */

import type { DataStore, RankedEntry } from "./models.ts";
import type { ZoomLevel } from "./types.ts";

/**
 * Linear interpolation between two values.
 * Returns start + (end - start) * t.
 */
export function tween(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/**
 * Convert a positive integer to an ordinal generation string.
 * E.g., 1 → "1st Gen", 2 → "2nd Gen", 3 → "3rd Gen", 4 → "4th Gen".
 */
export function toRomanNumeral(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] || s[v] || s[0];
  return `${n}${suffix} Gen`;
}

/**
 * Compute proportional bar width as a percentage (0–100).
 * Caps at 85% so the value label beside the bar always remains visible.
 * Returns 0 when maxCumulativeValue is 0.
 */
export function computeBarWidth(
  cumulativeValue: number,
  maxCumulativeValue: number,
): number {
  if (maxCumulativeValue === 0) return 0;
  return (cumulativeValue / maxCumulativeValue) * 85;
}

/**
 * Filter ranked entries by zoom level.
 * Returns top-10 entries when zoomLevel is 10, or all entries when "all".
 */
export function filterByZoom(
  entries: RankedEntry[],
  zoomLevel: ZoomLevel,
): RankedEntry[] {
  if (zoomLevel === "all") return entries;
  return entries.slice(0, zoomLevel);
}

/**
 * Map a scrubber position (integer index) to the date at that index
 * in the sorted dates array. Clamps to valid range [0, dates.length - 1].
 */
export function positionToDate(position: number, dates: string[]): string {
  const clamped = Math.max(0, Math.min(position, dates.length - 1));
  return dates[clamped];
}


/**
 * Return the YYYY-MM-DD date string N days before the given date.
 * Uses Date arithmetic which handles leap years correctly.
 */
export function dateMinusDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Check if an artist has any DailyValueEntry within [cutoffDate, snapshotDate].
 * Scans all releases for any dailyValues key in the date range.
 */
export function hasRecentActivity(
  artistId: string,
  cutoffDate: string,
  snapshotDate: string,
  dataStore: DataStore,
): boolean {
  const artist = dataStore.artists.get(artistId);
  if (!artist) return false;

  for (const release of artist.releases) {
    for (const dateKey of release.dailyValues.keys()) {
      if (dateKey >= cutoffDate && dateKey <= snapshotDate) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Filter entries by zoom level with a 14-day activity check for zoom 10.
 *
 * Rules:
 * - Always show #1.
 * - Include all active artists (activity in last 14 days).
 * - For each included artist, also include the entry immediately above it
 *   (its "goalpost" — the next target to chase). This chains: if rank 10
 *   is a goalpost for rank 11, then rank 9 becomes a goalpost for rank 10.
 * - Slots are contiguous — no visual gaps.
 * - Backfill with entries by rank if fewer than 10 qualify.
 * At zoom "all", returns all entries unchanged.
 */
export function filterByActivity(
  entries: RankedEntry[],
  snapshotDate: string,
  dataStore: DataStore,
  zoomLevel: ZoomLevel,
): RankedEntry[] {
  if (zoomLevel !== 10) return filterByZoom(entries, zoomLevel);
  if (entries.length === 0) return [];

  const cutoff = dateMinusDays(snapshotDate, 14);

  const isActive = (e: RankedEntry) =>
    hasRecentActivity(e.artistId, cutoff, snapshotDate, dataStore);

  // Always include rank 1
  // Include all active artists
  // Backfill remaining slots with inactive by rank
  const result: RankedEntry[] = [];

  // Rank 1 always included
  if (entries.length > 0) {
    result.push(entries[0]);
  }

  // Add all active entries (skip rank 1 if already added)
  for (let i = 1; i < entries.length; i++) {
    if (result.length >= 10) break;
    if (isActive(entries[i])) {
      result.push(entries[i]);
    }
  }

  // Backfill with inactive by rank
  if (result.length < 10) {
    for (let i = 1; i < entries.length; i++) {
      if (result.length >= 10) break;
      if (!result.some(r => r.artistId === entries[i].artistId)) {
        result.push(entries[i]);
      }
    }
  }

  // Sort by rank to maintain visual order
  result.sort((a, b) => a.rank - b.rank);

  return result.slice(0, 10);
}
