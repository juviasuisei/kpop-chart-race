/**
 * LazyRangeLoader — On-demand time-range data fetcher with LRU eviction.
 *
 * Data is partitioned into time ranges (e.g., by year or quarter). Only the
 * current viewport's range is loaded initially. As the user pans backward or
 * selects "All Time", older ranges are fetched on demand.
 *
 * Memory budget: ≤30MB working set on mobile. When the budget is exceeded,
 * the least-recently-used ranges are evicted from memory.
 *
 * Design:
 *   - Each range is a JSON file containing sparse change-point data for all
 *     lines active in that time window.
 *   - Ranges can overlap at boundaries (a line active across two ranges will
 *     have data in both). The loader deduplicates on merge.
 *   - Progressive detail: distant ranges may be pre-aggregated (weekly/monthly)
 *     while recent ranges have daily resolution.
 */

import type { SerializedLineData } from "./messages.ts";

/** Descriptor for a loadable time range */
export interface RangeDescriptor {
  /** Unique ID for this range (e.g., "2025-Q3") */
  id: string;
  /** Start date index (inclusive) in the global dates array */
  startDateIndex: number;
  /** End date index (inclusive) */
  endDateIndex: number;
  /** URL to fetch the range data from */
  url: string;
  /** Expected uncompressed size in bytes (for budget planning) */
  estimatedBytes: number;
  /** Resolution level: daily, weekly, or monthly */
  resolution: "daily" | "weekly" | "monthly";
}

/** A loaded range in memory */
interface LoadedRange {
  descriptor: RangeDescriptor;
  /** Parsed line data for this range */
  data: SerializedLineData[];
  /** Actual memory usage in bytes */
  memoryBytes: number;
  /** Last access timestamp (for LRU eviction) */
  lastAccessedAt: number;
}

/** Status of a range */
export type RangeStatus = "unloaded" | "loading" | "loaded" | "error";

/** Event emitted when ranges change */
export interface RangeLoadEvent {
  rangeId: string;
  status: RangeStatus;
}

/**
 * Manages lazy loading of time-range data with LRU memory management.
 */
export class LazyRangeLoader {
  private ranges = new Map<string, RangeDescriptor>();
  private loaded = new Map<string, LoadedRange>();
  private loading = new Set<string>();
  private errors = new Map<string, string>();

  /** Memory budget in bytes (default 30MB) */
  private budgetBytes: number;
  /** Current total memory usage across all loaded ranges */
  private currentBytes = 0;

  /** Optional callback when a range load completes or fails */
  onRangeLoad: ((event: RangeLoadEvent) => void) | null = null;

  constructor(budgetBytes = 30 * 1024 * 1024) {
    this.budgetBytes = budgetBytes;
  }

  /**
   * Register available ranges. Called once during initialization with
   * the manifest of all available time ranges.
   */
  registerRanges(descriptors: RangeDescriptor[]): void {
    for (const desc of descriptors) {
      this.ranges.set(desc.id, desc);
    }
  }

  /**
   * Get the status of a specific range.
   */
  getStatus(rangeId: string): RangeStatus {
    if (this.loaded.has(rangeId)) return "loaded";
    if (this.loading.has(rangeId)) return "loading";
    if (this.errors.has(rangeId)) return "error";
    return "unloaded";
  }

  /**
   * Request ranges that cover a given date window. Loads missing ranges
   * on demand. Returns immediately with currently available data; new data
   * triggers the onRangeLoad callback.
   *
   * @param startDateIndex Start of viewport (inclusive)
   * @param endDateIndex End of viewport (inclusive)
   * @returns Currently loaded line data covering the requested window
   */
  async requestRange(
    startDateIndex: number,
    endDateIndex: number,
  ): Promise<SerializedLineData[]> {
    const needed = this.findRangesForWindow(startDateIndex, endDateIndex);
    const toLoad: RangeDescriptor[] = [];

    for (const desc of needed) {
      const status = this.getStatus(desc.id);
      if (status === "loaded") {
        // Touch for LRU
        this.touch(desc.id);
      } else if (status === "unloaded") {
        toLoad.push(desc);
      }
      // "loading" and "error" ranges are skipped
    }

    // Load missing ranges (non-blocking, but we await them)
    if (toLoad.length > 0) {
      await Promise.all(toLoad.map((desc) => this.loadRange(desc)));
    }

    // Collect data from all loaded ranges in the window
    return this.collectData(startDateIndex, endDateIndex);
  }

  /**
   * Ensure specific ranges are loaded (preloading for animation).
   * Does not block — fires and forgets.
   */
  preload(rangeIds: string[]): void {
    for (const id of rangeIds) {
      const desc = this.ranges.get(id);
      if (desc && this.getStatus(id) === "unloaded") {
        this.loadRange(desc);
      }
    }
  }

  /**
   * Get all currently loaded line data (merged across all loaded ranges).
   * Useful for getting a complete snapshot without specifying a window.
   */
  getAllLoadedData(): SerializedLineData[] {
    const merged = new Map<string, SerializedLineData>();
    for (const range of this.loaded.values()) {
      for (const line of range.data) {
        const existing = merged.get(line.lineId);
        if (existing) {
          // Merge change-points (deduplicate by dateIndex)
          existing.changePoints = mergeChangePoints(
            existing.changePoints,
            line.changePoints,
          );
        } else {
          merged.set(line.lineId, { ...line, changePoints: [...line.changePoints] });
        }
      }
    }
    return Array.from(merged.values());
  }

  /**
   * Get current memory usage stats.
   */
  getMemoryStats(): { usedBytes: number; budgetBytes: number; loadedRanges: number; totalRanges: number } {
    return {
      usedBytes: this.currentBytes,
      budgetBytes: this.budgetBytes,
      loadedRanges: this.loaded.size,
      totalRanges: this.ranges.size,
    };
  }

  /**
   * Manually evict a specific range from memory.
   */
  evict(rangeId: string): void {
    const loaded = this.loaded.get(rangeId);
    if (loaded) {
      this.currentBytes -= loaded.memoryBytes;
      this.loaded.delete(rangeId);
    }
  }

  /**
   * Clear all loaded data and reset state.
   */
  clear(): void {
    this.loaded.clear();
    this.loading.clear();
    this.errors.clear();
    this.currentBytes = 0;
  }

  // --- Private ---

  /**
   * Find all registered ranges that overlap with the given date window.
   */
  private findRangesForWindow(
    startDateIndex: number,
    endDateIndex: number,
  ): RangeDescriptor[] {
    const overlapping: RangeDescriptor[] = [];
    for (const desc of this.ranges.values()) {
      // Check overlap: range intersects window if start <= window.end AND end >= window.start
      if (desc.startDateIndex <= endDateIndex && desc.endDateIndex >= startDateIndex) {
        overlapping.push(desc);
      }
    }
    // Sort by start date for predictable loading order
    overlapping.sort((a, b) => a.startDateIndex - b.startDateIndex);
    return overlapping;
  }

  /**
   * Load a single range from its URL.
   */
  private async loadRange(desc: RangeDescriptor): Promise<void> {
    if (this.loading.has(desc.id)) return;
    this.loading.add(desc.id);

    try {
      // Ensure we have budget before loading
      this.ensureBudget(desc.estimatedBytes);

      const response = await fetch(desc.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: SerializedLineData[] = await response.json();
      const memoryBytes = estimateMemory(data);

      // Evict if needed for actual (not estimated) size
      if (memoryBytes > desc.estimatedBytes) {
        this.ensureBudget(memoryBytes - desc.estimatedBytes);
      }

      const loaded: LoadedRange = {
        descriptor: desc,
        data,
        memoryBytes,
        lastAccessedAt: Date.now(),
      };

      this.loaded.set(desc.id, loaded);
      this.currentBytes += memoryBytes;
      this.loading.delete(desc.id);
      this.errors.delete(desc.id);

      this.onRangeLoad?.({ rangeId: desc.id, status: "loaded" });
    } catch (err) {
      this.loading.delete(desc.id);
      const message = err instanceof Error ? err.message : String(err);
      this.errors.set(desc.id, message);
      console.warn(`[LazyRangeLoader] Failed to load range "${desc.id}":`, message);

      this.onRangeLoad?.({ rangeId: desc.id, status: "error" });
    }
  }

  /**
   * Touch a range to update its last-accessed time (LRU freshness).
   */
  private touch(rangeId: string): void {
    const loaded = this.loaded.get(rangeId);
    if (loaded) {
      loaded.lastAccessedAt = Date.now();
    }
  }

  /**
   * Ensure there's enough budget for a new allocation. Evicts LRU ranges
   * until the budget is met.
   */
  private ensureBudget(neededBytes: number): void {
    while (this.currentBytes + neededBytes > this.budgetBytes && this.loaded.size > 0) {
      this.evictLRU();
    }
  }

  /**
   * Evict the least-recently-used range.
   */
  private evictLRU(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [id, range] of this.loaded) {
      if (range.lastAccessedAt < oldestTime) {
        oldestTime = range.lastAccessedAt;
        oldest = id;
      }
    }

    if (oldest) {
      this.evict(oldest);
    }
  }

  /**
   * Collect merged line data for all loaded ranges within a date window.
   */
  private collectData(
    startDateIndex: number,
    endDateIndex: number,
  ): SerializedLineData[] {
    const merged = new Map<string, SerializedLineData>();

    for (const range of this.loaded.values()) {
      // Skip ranges entirely outside the window
      if (
        range.descriptor.endDateIndex < startDateIndex ||
        range.descriptor.startDateIndex > endDateIndex
      ) {
        continue;
      }

      // Touch for LRU
      range.lastAccessedAt = Date.now();

      for (const line of range.data) {
        const existing = merged.get(line.lineId);
        if (existing) {
          existing.changePoints = mergeChangePoints(
            existing.changePoints,
            line.changePoints,
          );
        } else {
          merged.set(line.lineId, { ...line, changePoints: [...line.changePoints] });
        }
      }
    }

    return Array.from(merged.values());
  }
}

// --- Utilities ---

/**
 * Merge two sorted change-point arrays, deduplicating by dateIndex.
 * When both arrays have an entry at the same dateIndex, the higher value wins
 * (handles overlapping range boundaries).
 */
function mergeChangePoints(
  a: [number, number][],
  b: [number, number][],
): [number, number][] {
  const merged: [number, number][] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i][0] < b[j][0]) {
      merged.push(a[i]);
      i++;
    } else if (a[i][0] > b[j][0]) {
      merged.push(b[j]);
      j++;
    } else {
      // Same dateIndex — take the higher value
      merged.push(a[i][1] >= b[j][1] ? a[i] : b[j]);
      i++;
      j++;
    }
  }

  while (i < a.length) merged.push(a[i++]);
  while (j < b.length) merged.push(b[j++]);

  return merged;
}

/**
 * Estimate memory usage for a set of serialized line data.
 */
function estimateMemory(data: SerializedLineData[]): number {
  let bytes = 64; // Base array overhead
  for (const line of data) {
    // String overhead + content
    bytes += 64 + (line.lineId.length + line.label.length + line.color.length) * 2;
    // Change-points: 16 bytes per entry (2 × float64) + array overhead
    bytes += 64 + line.changePoints.length * 16;
  }
  return bytes;
}
