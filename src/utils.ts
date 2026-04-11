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
 * Convert a positive integer to a "Gen N" Roman numeral string.
 * Uses the standard subtractive Roman numeral algorithm.
 */
export function toRomanNumeral(n: number): string {
  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const numerals = [
    "M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I",
  ];

  let remaining = n;
  let result = "";
  for (let i = 0; i < values.length; i++) {
    while (remaining >= values[i]) {
      result += numerals[i];
      remaining -= values[i];
    }
  }
  return `Gen ${result}`;
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

/** Backward-compatible alias */
export function dateMinus365(date: string): string {
  return dateMinusDays(date, 30);
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
 * Filter entries by zoom level with a 30-day activity check for zoom 10.
 *
 * At zoom 10:
 * - Rank 1 is always included.
 * - For ranks 2-10: inactive artists (no activity in last 30 days) are only
 *   removed if there are active artists outside the top 10 to replace them.
 *   Removal happens from the bottom of the top 10 upward.
 * At zoom "all", returns all entries unchanged.
 */
export function filterByActivity(
  entries: RankedEntry[],
  snapshotDate: string,
  dataStore: DataStore,
  zoomLevel: ZoomLevel,
): RankedEntry[] {
  if (zoomLevel !== 10) return filterByZoom(entries, zoomLevel);

  const cutoff = dateMinusDays(snapshotDate, 30);

  // Get top 10 and the rest
  const top10 = entries.slice(0, 10);
  const outside = entries.slice(10);

  // Find active artists outside top 10
  const activeOutside = outside.filter(e =>
    hasRecentActivity(e.artistId, cutoff, snapshotDate, dataStore)
  );

  // Find inactive artists in top 10 (excluding rank 1)
  const inactiveInTop10: number[] = [];
  for (let i = top10.length - 1; i >= 1; i--) {
    if (!hasRecentActivity(top10[i].artistId, cutoff, snapshotDate, dataStore)) {
      inactiveInTop10.push(i);
    }
  }

  // Replace inactive from bottom, one at a time, only if there's an active replacement
  const result = [...top10];
  let replacementIdx = 0;
  for (const inactiveIdx of inactiveInTop10) {
    if (replacementIdx < activeOutside.length) {
      result[inactiveIdx] = activeOutside[replacementIdx];
      replacementIdx++;
    }
  }

  // Remove any remaining nulls and return up to 10
  return result.filter(Boolean).slice(0, 10);
}
