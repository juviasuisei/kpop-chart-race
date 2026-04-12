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
 * - Rank 1 is always shown (the ultimate goalpost).
 * - Active artists (activity in last 30 days) fill slots.
 * - One "goalpost" inactive artist is shown: the one ranked just above the
 *   highest-ranked active artist, giving them a visible target to chase.
 * - Inactive artists from the bottom of the top 10 are replaced by active
 *   artists from outside the top 10 when available.
 * - If fewer than 10 qualify, show what we have.
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

  const cutoff = dateMinusDays(snapshotDate, 30);

  // Classify all entries by activity
  const isActive = (e: RankedEntry) =>
    hasRecentActivity(e.artistId, cutoff, snapshotDate, dataStore);

  // Always include rank 1
  const result: RankedEntry[] = [entries[0]];

  // Find all active entries (excluding rank 1 which is already included)
  const activeEntries = entries.filter((e, i) => i > 0 && isActive(e));

  // Find the "goalpost" — the inactive artist ranked just above the highest active one.
  // This gives the top active artist a visible target to chase toward #1.
  if (activeEntries.length > 0) {
    const highestActiveRank = activeEntries[0].rank;

    // Look for the inactive entry between rank 1 and the highest active rank
    // Walk down from rank 2 to find the last inactive before the highest active
    let goalpost: RankedEntry | null = null;
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].rank >= highestActiveRank) break;
      if (!isActive(entries[i])) {
        goalpost = entries[i]; // keep updating — we want the one closest to the active
      }
    }

    if (goalpost && goalpost.artistId !== entries[0].artistId) {
      result.push(goalpost);
    }
  }

  // Add active entries (up to 10 total)
  for (const entry of activeEntries) {
    if (result.length >= 10) break;
    if (!result.some(r => r.artistId === entry.artistId)) {
      result.push(entry);
    }
  }

  // Backfill remaining slots with inactive artists by rank (2, 3, 4, etc.)
  // if there aren't enough active artists to fill 10 slots
  if (result.length < 10) {
    for (const entry of entries) {
      if (result.length >= 10) break;
      if (!result.some(r => r.artistId === entry.artistId)) {
        result.push(entry);
      }
    }
  }

  return result.slice(0, 10);
}
