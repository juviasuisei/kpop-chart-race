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
 * Return the YYYY-MM-DD date string 365 days before the given date.
 * Uses Date arithmetic which handles leap years correctly.
 */
export function dateMinus365(date: string): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() - 365);
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
 * Filter entries by zoom level with a 365-day activity check for zoom 10.
 * At zoom 10, rank 1 is always included; ranks 2+ are included only if the
 * artist has recent activity. At zoom "all", returns all entries unchanged.
 */
export function filterByActivity(
  entries: RankedEntry[],
  snapshotDate: string,
  dataStore: DataStore,
  zoomLevel: ZoomLevel,
): RankedEntry[] {
  const base = filterByZoom(entries, zoomLevel);
  if (zoomLevel !== 10) return base;

  const cutoff = dateMinus365(snapshotDate);

  return base.filter((entry, index) => {
    if (index === 0) return true; // rank 1 always included
    return hasRecentActivity(entry.artistId, cutoff, snapshotDate, dataStore);
  });
}
