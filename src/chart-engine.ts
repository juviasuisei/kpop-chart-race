/**
 * ChartEngine — pure computation module for cumulative values, rankings,
 * and featured releases. No DOM access.
 */

import type { DailyValueEntry } from "./types.ts";
import type { DataStore, ParsedArtist, ChartSnapshot, RankedEntry, FeaturedReleaseInfo } from "./models.ts";

/**
 * Compute the daily performance value for an artist on a given date.
 * This is the sum of all release `.value` fields for that date.
 */
export function computeDailyValue(artist: ParsedArtist, date: string): number {
  let total = 0;
  for (const release of artist.releases) {
    const entry = release.dailyValues.get(date);
    if (entry) {
      total += entry.value;
    }
  }
  return total;
}

/**
 * Compute the cumulative value for an artist from startDate through the given date.
 * Sums daily performance values across all dates in the sorted dates array up to
 * and including `date`.
 */
export function computeCumulativeValue(
  artist: ParsedArtist,
  date: string,
  dates: string[],
): number {
  let cumulative = 0;
  for (const d of dates) {
    if (d > date) break;
    cumulative += computeDailyValue(artist, d);
  }
  return cumulative;
}

/**
 * Identify the featured release for an artist on a given date.
 *
 * - If one or more releases have a non-zero daily value on the current date,
 *   the featured release is the one with the highest value.
 * - If all releases have zero (or no entry) on the current date, retain the
 *   most recent release that had a non-zero value (scanning backwards through dates).
 * - If no release ever had a non-zero value, fall back to the first release.
 */
export function identifyFeaturedRelease(
  artist: ParsedArtist,
  date: string,
  dates: string[],
): FeaturedReleaseInfo {
  // Check current date: find release with highest daily value
  let bestRelease: { id: string; title: string } | null = null;
  let bestValue = 0;

  for (const release of artist.releases) {
    const entry = release.dailyValues.get(date);
    const value = entry?.value ?? 0;
    if (value > bestValue) {
      bestValue = value;
      bestRelease = { id: release.id, title: release.title };
    }
  }

  if (bestRelease) {
    return { releaseId: bestRelease.id, title: bestRelease.title };
  }

  // All zero on current date — find most recent release with non-zero value
  // Walk backwards through dates before the current date
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i];
    if (d >= date) continue; // only look at dates before current
    for (const release of artist.releases) {
      const entry = release.dailyValues.get(d);
      if (entry && entry.value > 0) {
        return { releaseId: release.id, title: release.title };
      }
    }
  }

  // Fallback: first release
  const fallback = artist.releases[0];
  return { releaseId: fallback?.id ?? "", title: fallback?.title ?? "" };
}


/**
 * Compute a full chart snapshot for a given date.
 *
 * @param date - The current date (YYYY-MM-DD)
 * @param dataStore - The loaded DataStore with all artist data
 * @param previousSnapshot - Optional previous snapshot for stable sort and previous values
 * @returns A ChartSnapshot with ranked entries
 */
export function computeSnapshot(
  date: string,
  dataStore: DataStore,
  previousSnapshot?: ChartSnapshot,
): ChartSnapshot {
  const { artists, dates } = dataStore;

  // Build a lookup from the previous snapshot for previousCumulativeValue,
  // previousRank, and tie-breaking order.
  const previousMap = new Map<string, { cumulativeValue: number; rank: number; index: number }>();
  if (previousSnapshot) {
    for (let i = 0; i < previousSnapshot.entries.length; i++) {
      const e = previousSnapshot.entries[i];
      previousMap.set(e.artistId, {
        cumulativeValue: e.cumulativeValue,
        rank: e.rank,
        index: i,
      });
    }
  }

  // Build unsorted entries for all artists
  const unsorted: RankedEntry[] = [];

  for (const [artistId, artist] of artists) {
    const dailyValue = computeDailyValue(artist, date);
    const cumulativeValue = computeCumulativeValue(artist, date, dates);
    const prev = previousMap.get(artistId);
    const previousCumulativeValue = prev?.cumulativeValue ?? 0;
    const previousRank = prev?.rank ?? 0;
    const featuredRelease = identifyFeaturedRelease(artist, date, dates);

    unsorted.push({
      artistId,
      artistName: artist.name,
      artistType: artist.artistType,
      generation: artist.generation,
      logoUrl: artist.logoUrl,
      cumulativeValue,
      previousCumulativeValue,
      dailyValue,
      rank: 0, // will be assigned after sorting
      previousRank,
      featuredRelease,
    });
  }

  // Filter out entries with zero cumulative value — only artists who have
  // earned points should appear in the snapshot. The previousMap still
  // tracks all artists so transitions from 0→non-zero are handled correctly.
  const nonZero = unsorted.filter(e => e.cumulativeValue > 0);

  // Sort descending by cumulative value, with stable sort for ties
  // (preserve previous order from previousSnapshot)
  nonZero.sort((a, b) => {
    if (b.cumulativeValue !== a.cumulativeValue) {
      return b.cumulativeValue - a.cumulativeValue;
    }
    // Tie: preserve previous relative order
    const prevA = previousMap.get(a.artistId);
    const prevB = previousMap.get(b.artistId);
    if (prevA != null && prevB != null) {
      return prevA.index - prevB.index;
    }
    // If one was in previous and the other wasn't, the one that was comes first
    if (prevA != null) return -1;
    if (prevB != null) return 1;
    // Neither in previous — maintain insertion order (stable)
    return 0;
  });

  // Assign ranks (1-based) on filtered array only
  for (let i = 0; i < nonZero.length; i++) {
    nonZero[i].rank = i + 1;
  }

  return {
    date,
    entries: nonZero,
  };
}


/**
 * Deduplicate entries by artist, keeping only the highest-value release per artist.
 * If an artist has multiple releases tied at the same highest value, the first
 * encountered in iteration order is kept.
 */
function deduplicateByArtist(
  entries: { artistId: string; releaseId: string; value: number }[],
): { artistId: string; releaseId: string; value: number }[] {
  const bestByArtist = new Map<string, { artistId: string; releaseId: string; value: number }>();
  for (const entry of entries) {
    const existing = bestByArtist.get(entry.artistId);
    if (!existing || entry.value > existing.value) {
      bestByArtist.set(entry.artistId, entry);
    }
  }
  return Array.from(bestByArtist.values());
}

/**
 * Compute chart wins across all dates and sources.
 *
 * For each (date, source) pair, the artist(s) with the highest DailyValueEntry
 * value are the winners. Ties result in all tied artists being winners.
 *
 * Before determining winners, entries are deduplicated per artist so that each
 * artist is represented by at most one release (the highest-value one). Crown
 * level increments apply only to the selected release.
 *
 * Crown levels track the total number of wins per (artistId, releaseId, source)
 * tuple with no upper bound. The crown level for a given date entry is the running
 * total up to and including that date.
 *
 * @returns Map<date, Map<source, { artistIds, crownLevels }>>
 *   where crownLevels is Map<artistId, crownLevel>
 */
export function computeChartWins(
  dataStore: DataStore,
): Map<string, Map<string, { artistIds: string[]; crownLevels: Map<string, number> }>> {
  const { artists, dates } = dataStore;

  // Running win counts per (artistId, releaseId, source) → total wins
  // Key format: `${artistId}|${releaseId}|${source}`
  const winCounts = new Map<string, number>();

  const result = new Map<
    string,
    Map<string, { artistIds: string[]; crownLevels: Map<string, number> }>
  >();

  for (const date of dates) {
    // Collect all (artistId, releaseId, source, value) entries for this date
    const entriesBySource = new Map<
      string,
      { artistId: string; releaseId: string; value: number }[]
    >();

    for (const [artistId, artist] of artists) {
      for (const release of artist.releases) {
        const dv: DailyValueEntry | undefined = release.dailyValues.get(date);
        if (!dv) continue;

        const source = dv.source;
        if (!entriesBySource.has(source)) {
          entriesBySource.set(source, []);
        }
        entriesBySource.get(source)!.push({
          artistId,
          releaseId: release.id,
          value: dv.value,
        });
      }
    }

    // For each source, determine winner(s) and update crown levels
    const sourceMap = new Map<
      string,
      { artistIds: string[]; crownLevels: Map<string, number> }
    >();

    for (const [source, rawEntries] of entriesBySource) {
      // Deduplicate: keep only the highest-value release per artist
      const entries = deduplicateByArtist(rawEntries);

      // Find the maximum value for this (date, source)
      let maxValue = -Infinity;
      for (const entry of entries) {
        if (entry.value > maxValue) {
          maxValue = entry.value;
        }
      }

      // Collect all artists tied at the max value
      const winners = entries.filter((e) => e.value === maxValue);

      // Update running win counts for each winner's (artistId, releaseId, source) tuple
      for (const winner of winners) {
        const key = `${winner.artistId}|${winner.releaseId}|${source}`;
        const prev = winCounts.get(key) ?? 0;
        winCounts.set(key, prev + 1);
      }

      // Build crown levels for this (date, source) — one entry per winning artistId
      const crownLevels = new Map<string, number>();
      const winnerArtistIds = new Set<string>();

      for (const winner of winners) {
        winnerArtistIds.add(winner.artistId);
        const key = `${winner.artistId}|${winner.releaseId}|${source}`;
        const totalWins = winCounts.get(key) ?? 0;
        const crownLevel = totalWins;
        const existing = crownLevels.get(winner.artistId) ?? 0;
        if (crownLevel > existing) {
          crownLevels.set(winner.artistId, crownLevel);
        }
      }

      sourceMap.set(source, {
        artistIds: Array.from(winnerArtistIds),
        crownLevels,
      });
    }

    if (sourceMap.size > 0) {
      result.set(date, sourceMap);
    }
  }

  return result;
}
