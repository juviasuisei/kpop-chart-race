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
 * - Always show #1 (the ultimate goalpost).
 * - For each active artist, also keep the inactive artist immediately above
 *   them as a "goalpost" — the next target to chase.
 * - An inactive artist is only hidden if:
 *   (a) there are enough active artists + goalposts to fill 10 slots, AND
 *   (b) the inactive artist is not a goalpost for any active artist below it.
 * - Slots are always filled contiguously (no gaps) — if rank 7 is hidden,
 *   rank 8 takes the 7th visual slot.
 * - Backfill with inactive artists by rank if fewer than 10 qualify.
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

  const isActive = (e: RankedEntry) =>
    hasRecentActivity(e.artistId, cutoff, snapshotDate, dataStore);

  // Build a set of entries to include:
  // 1. Always include rank 1
  // 2. Include all active entries
  // 3. For each active entry, include the inactive entry immediately above it
  //    (the goalpost — the next target to chase)
  const includeSet = new Set<string>();
  includeSet.add(entries[0].artistId); // rank 1 always

  for (let i = 0; i < entries.length; i++) {
    if (isActive(entries[i])) {
      includeSet.add(entries[i].artistId);

      // Find the goalpost: the closest inactive entry above this active one
      for (let j = i - 1; j >= 0; j--) {
        if (!isActive(entries[j]) && !includeSet.has(entries[j].artistId)) {
          includeSet.add(entries[j].artistId);
          break; // only one goalpost per active artist
        }
        // If we hit another active or already-included entry, that's the goalpost boundary
        if (isActive(entries[j]) || includeSet.has(entries[j].artistId)) {
          break;
        }
      }
    }
  }

  // Build result from included entries, maintaining rank order
  const result: RankedEntry[] = [];
  for (const entry of entries) {
    if (result.length >= 10) break;
    if (includeSet.has(entry.artistId)) {
      result.push(entry);
    }
  }

  // Backfill remaining slots with next entries by rank if fewer than 10
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
