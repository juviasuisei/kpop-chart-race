/**
 * SparseTimeSeries — Change-point based cumulative value storage.
 *
 * Instead of storing a value for every single date (which would be
 * 10K songs × 11K dates = 110M entries), we store only the dates where
 * the cumulative value changes. Between change-points, the value is
 * constant (flat line forward).
 *
 * A typical K-pop release appears on charts for 5–30 days during a
 * promotion cycle. Storing as change-points means ~20 entries per release
 * instead of thousands of repeated values.
 *
 * Storage format: sorted array of [dateIndex, cumulativeValue] tuples.
 * Binary search gives O(log n) lookup at any date.
 *
 * Memory estimate: 10K songs × 20 avg change-points × 16 bytes = ~3.2MB
 * (vs ~440MB for dense daily arrays)
 */

/** A single change-point: [dateIndex, cumulativeValue] */
export type ChangePoint = [dateIndex: number, cumulativeValue: number];

/**
 * Immutable sparse time series built from change-points.
 * Optimized for fast lookups and minimal memory usage.
 */
export class SparseTimeSeries {
  /** Sorted array of change-points */
  private readonly points: ChangePoint[];

  constructor(points: ChangePoint[]) {
    // Ensure sorted by dateIndex (ascending)
    this.points = points.slice().sort((a, b) => a[0] - b[0]);
  }

  /**
   * Get the cumulative value at a given date index.
   * Uses binary search for O(log n) lookup.
   * Returns 0 if the date is before the first change-point.
   */
  getValueAt(dateIndex: number): number {
    const pts = this.points;
    if (pts.length === 0) return 0;
    if (dateIndex < pts[0][0]) return 0;
    if (dateIndex >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];

    // Binary search for last change-point ≤ dateIndex
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pts[mid][0] <= dateIndex) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    return pts[lo][1];
  }

  /**
   * Get the date index of the first change-point (when the line appears).
   * Returns -1 if empty.
   */
  get firstDateIndex(): number {
    return this.points.length > 0 ? this.points[0][0] : -1;
  }

  /**
   * Get the date index of the last change-point (last activity).
   * Returns -1 if empty.
   */
  get lastDateIndex(): number {
    return this.points.length > 0 ? this.points[this.points.length - 1][0] : -1;
  }

  /**
   * Get the final cumulative value (lifetime total).
   */
  get finalValue(): number {
    return this.points.length > 0 ? this.points[this.points.length - 1][1] : 0;
  }

  /**
   * Get the number of change-points (for memory diagnostics).
   */
  get length(): number {
    return this.points.length;
  }

  /**
   * Get change-points within a date range (inclusive).
   * Returns a slice without copying the underlying data.
   */
  getRange(startDateIndex: number, endDateIndex: number): ChangePoint[] {
    if (this.points.length === 0) return [];

    // Find first point >= startDateIndex
    let lo = 0;
    let hi = this.points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.points[mid][0] < startDateIndex) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const startIdx = lo;

    // Find first point > endDateIndex
    hi = this.points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.points[mid][0] <= endDateIndex) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const endIdx = lo;

    return this.points.slice(startIdx, endIdx);
  }

  /**
   * Get the raw change-points array (for serialization/transfer to worker).
   */
  toArray(): ChangePoint[] {
    return this.points;
  }

  /**
   * Estimated memory usage in bytes.
   * Each change-point is 2 numbers (8 bytes each) + array overhead.
   */
  get memoryBytes(): number {
    // 16 bytes per entry (2 × float64) + array overhead (~64 bytes)
    return this.points.length * 16 + 64;
  }
}

/**
 * Builder for constructing SparseTimeSeries from raw daily values.
 * Handles deduplication, sorting, and cumulative accumulation.
 */
export class SparseTimeSeriesBuilder {
  private entries: ChangePoint[] = [];
  private lastValue = 0;

  /**
   * Add a daily value at a given date index.
   * The builder accumulates values into a running cumulative total.
   *
   * @param dateIndex The date index (position in the global dates array)
   * @param dailyValue The incremental value for this date (not cumulative)
   */
  addDailyValue(dateIndex: number, dailyValue: number): void {
    this.lastValue += dailyValue;
    this.entries.push([dateIndex, this.lastValue]);
  }

  /**
   * Add a pre-computed cumulative value at a given date index.
   * Use this when values are already cumulative.
   */
  addCumulativeValue(dateIndex: number, cumulativeValue: number): void {
    this.entries.push([dateIndex, cumulativeValue]);
    this.lastValue = cumulativeValue;
  }

  /**
   * Build the final SparseTimeSeries, de-duplicating consecutive
   * entries with the same value (compaction).
   */
  build(): SparseTimeSeries {
    // Sort by dateIndex
    this.entries.sort((a, b) => a[0] - b[0]);

    // Compact: remove consecutive entries with the same value
    // (only keep the first entry where the value changes)
    const compacted: ChangePoint[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      const [dateIdx, value] = this.entries[i];
      if (compacted.length === 0 || compacted[compacted.length - 1][1] !== value) {
        compacted.push([dateIdx, value]);
      }
    }

    return new SparseTimeSeries(compacted);
  }

  /**
   * Reset the builder for reuse.
   */
  reset(): void {
    this.entries = [];
    this.lastValue = 0;
  }
}

/**
 * Convert the application's DataStore format (per-release dailyValues)
 * into SparseTimeSeries for each line (release or artist).
 *
 * @param dailyValues Map of date string → { value } entries
 * @param dateToIndex Function mapping date string to date index
 * @returns A SparseTimeSeries for the given daily values
 */
export function buildSeriesFromDailyValues(
  dailyValues: Map<string, { value: number }>,
  dateToIndex: (date: string) => number,
): SparseTimeSeries {
  const builder = new SparseTimeSeriesBuilder();

  // Collect and sort by date index to ensure correct cumulative order
  const entries: [number, number][] = [];
  for (const [date, entry] of dailyValues) {
    const idx = dateToIndex(date);
    if (idx >= 0) {
      entries.push([idx, entry.value]);
    }
  }

  // Sort by date index
  entries.sort((a, b) => a[0] - b[0]);

  // Accumulate
  for (const [idx, value] of entries) {
    builder.addDailyValue(idx, value);
  }

  return builder.build();
}

/**
 * Merge multiple SparseTimeSeries into one (for artist aggregation).
 * Sums cumulative values across all series at each unique date.
 */
export function mergeSeries(seriesList: SparseTimeSeries[]): SparseTimeSeries {
  if (seriesList.length === 0) return new SparseTimeSeries([]);
  if (seriesList.length === 1) return seriesList[0];

  // Collect all unique date indices across all series
  const dateSet = new Set<number>();
  for (const series of seriesList) {
    for (const [dateIdx] of series.toArray()) {
      dateSet.add(dateIdx);
    }
  }

  // Sort date indices
  const sortedDates = Array.from(dateSet).sort((a, b) => a - b);

  // At each date, sum the values from all series
  const merged: ChangePoint[] = [];
  let prevSum = -1;

  for (const dateIdx of sortedDates) {
    let sum = 0;
    for (const series of seriesList) {
      sum += series.getValueAt(dateIdx);
    }
    // Only store if value changed (compaction)
    if (sum !== prevSum) {
      merged.push([dateIdx, sum]);
      prevSum = sum;
    }
  }

  return new SparseTimeSeries(merged);
}
