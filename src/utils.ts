/**
 * Utility functions for the K-Pop Chart Race application.
 * Pure functions for interpolation, formatting, layout, filtering, and date mapping.
 */

import type { RankedEntry } from "./models.ts";
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
