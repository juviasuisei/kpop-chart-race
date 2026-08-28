/**
 * Deterministic score fill for charts that don't publish concrete scores for
 * their full ranking.
 *
 * Two shows in the source data leave lower-ranked scores blank, encoded in
 * Airtable as negative sentinel values (-1, -2, -3, … in rank order, where -1
 * is the highest missing rank and more-negative is lower). The sentinels stay
 * in Airtable as the source of truth; this module fills them in at runtime when
 * the Data_Adapter prepares data for the site.
 *
 *  - Music Bank publishes ranks 1–20; ranks 21–50 are missing. We extend the
 *    chart's own decay with a power-law tail (fit from real Music Bank data),
 *    anchored to the real rank-20 score.
 *  - M Countdown publishes only rank 1; ranks 2–20 are missing. Its #1 carries
 *    a large winner boost, so we borrow the decay SHAPE of Show! Music Core
 *    (the closest comparable chart) and anchor it to a de-spiked implied #2
 *    (25% below the real #1) so #2 doesn't ride up against the boosted #1.
 *
 * All fills are deterministic (same inputs → same outputs), produced as
 * strictly-decreasing integers so ranks never tie or invert, with an absolute
 * floor of {@link SCORE_FLOOR} reserved for the very last rank.
 *
 * The fitted constants were derived once from real chart data; see the project
 * spec / commit history for the derivation. They are intentionally frozen here.
 */

import type { DailyValueEntry } from "../types.ts";
import type { ParsedArtist } from "../models.ts";

/** Absolute minimum score, reserved for the lowest possible rank. */
export const SCORE_FLOOR = 13;

/** Power-law exponent for the Music Bank tail: f(r) ∝ r^(-MB_TAIL_EXPONENT). */
export const MB_TAIL_EXPONENT = 0.5934;

/** Highest real rank Music Bank publishes (fill continues below this). */
export const MB_LAST_REAL_RANK = 20;

/**
 * De-spike factor for M Countdown: implied #2 = real #1 × this. The real #1 is
 * inflated by a winner boost, so anchoring the borrowed shape to a lower #2
 * keeps the runner-up from riding up against #1 (user-chosen 25% drop).
 */
export const MCD_DESPIKE_FACTOR = 0.75;

/**
 * Show! Music Core decay shape as a ratio to rank 2 (ranks 2–20), averaged over
 * real SMC episodes. Used to shape the M Countdown fill below its implied #2.
 */
export const SMC_SHAPE_REL2: Readonly<Record<number, number>> = {
  2: 1.0, 3: 0.8456, 4: 0.7181, 5: 0.5902, 6: 0.5339, 7: 0.4459, 8: 0.3951,
  9: 0.3267, 10: 0.2556, 11: 0.2323, 12: 0.2135, 13: 0.19, 14: 0.1702,
  15: 0.1624, 16: 0.1489, 17: 0.1334, 18: 0.1265, 19: 0.1189, 20: 0.1108,
};

/** A rank slot to be filled: its 1-based rank and the unclamped target score. */
interface RawSlot {
  rank: number;
  raw: number;
}

/**
 * Turn raw target scores into a strictly-decreasing integer sequence.
 *
 * Rules (applied top-down over ascending ranks):
 *  - round to an integer;
 *  - never exceed `prevScore - 1` (strictly below the rank above);
 *  - never fall below `SCORE_FLOOR + (lastRank - rank)`, which reserves one
 *    point of descent room per remaining rank so the tail can keep stepping
 *    down by 1 and land exactly on SCORE_FLOOR at the last rank — no ties.
 *
 * @param slots     ascending-rank slots with raw target scores
 * @param prevScore the real score of the rank immediately above the first slot
 * @param lastRank  the final rank in this fill block
 */
export function enforceStrictDescending(
  slots: RawSlot[],
  prevScore: number,
  lastRank: number,
): Array<{ rank: number; score: number }> {
  const out: Array<{ rank: number; score: number }> = [];
  let prev = prevScore;
  for (const { rank, raw } of slots) {
    const perRankMin = SCORE_FLOOR + (lastRank - rank);
    let v = Math.round(raw);
    // Raise toward the per-rank floor first (soft target for the tail)...
    if (v < perRankMin) v = perRankMin;
    // ...but strict descent is the hard invariant and always wins: never allow
    // a value >= the rank above, even if that means dropping below the floor.
    // (Only possible in degenerate data where the anchor is too small to fit
    // the whole descent; real chart anchors are far above 13 + slot count.)
    if (v > prev - 1) v = prev - 1;
    out.push({ rank, score: v });
    prev = v;
  }
  return out;
}

/**
 * Music Bank tail: fill `firstRank..lastRank` from the power-law decay anchored
 * to the real rank-20 score. Ratio to rank 20 is (r^-k)/(20^-k).
 */
export function fillMusicBankTail(
  realScoreAtLastRealRank: number,
  firstRank: number,
  lastRank: number,
): Array<{ rank: number; score: number }> {
  const anchor = Math.pow(MB_LAST_REAL_RANK, -MB_TAIL_EXPONENT);
  const slots: RawSlot[] = [];
  for (let r = firstRank; r <= lastRank; r++) {
    const ratio = Math.pow(r, -MB_TAIL_EXPONENT) / anchor;
    slots.push({ rank: r, raw: realScoreAtLastRealRank * ratio });
  }
  return enforceStrictDescending(slots, realScoreAtLastRealRank, lastRank);
}

/**
 * M Countdown: fill `firstRank..lastRank` (firstRank is normally 2). De-spiked:
 * implied #2 = real #1 × MCD_DESPIKE_FACTOR, then ranks follow the SMC shape
 * relative to #2. Ranks beyond the SMC table (>20) reuse the rank-20 ratio.
 */
export function fillMCountdown(
  realScoreAtRank1: number,
  firstRank: number,
  lastRank: number,
): Array<{ rank: number; score: number }> {
  const implied2 = realScoreAtRank1 * MCD_DESPIKE_FACTOR;
  const slots: RawSlot[] = [];
  for (let r = firstRank; r <= lastRank; r++) {
    const ratio = SMC_SHAPE_REL2[r] ?? SMC_SHAPE_REL2[20];
    slots.push({ rank: r, raw: implied2 * ratio });
  }
  return enforceStrictDescending(slots, realScoreAtRank1, lastRank);
}

/** One chart entry seen while grouping: the shared entry object + its date. */
interface EpisodeEntry {
  date: string;
  entry: DailyValueEntry;
}

/**
 * Fill missing (negative-sentinel) scores across all artists in place.
 *
 * Groups every DailyValueEntry by episode (source + episode number), and for
 * Music Bank / M Countdown episodes replaces the negative sentinels with fitted
 * scores. Real (positive) scores are never modified. Entry objects are mutated
 * in place; since a multi-artist release shares one entry object across its
 * artists, we dedupe by object identity so each episode is processed once.
 */
export function fillMissingScores(artists: Map<string, ParsedArtist>): void {
  // episodeKey → entries (deduped by entry-object identity)
  const episodes = new Map<string, EpisodeEntry[]>();
  const seen = new Set<DailyValueEntry>();

  for (const artist of artists.values()) {
    for (const release of artist.releases) {
      for (const [date, entry] of release.dailyValues) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        const key = `${entry.source}::${entry.episode}`;
        const list = episodes.get(key);
        if (list) list.push({ date, entry });
        else episodes.set(key, [{ date, entry }]);
      }
    }
  }

  for (const list of episodes.values()) {
    if (list.length === 0) continue;
    const source = list[0].entry.source;
    if (source !== "music_bank" && source !== "m_countdown") continue;
    fillEpisode(source, list);
  }
}

/**
 * Fill one episode's sentinels. `entries` are all chart rows for the episode.
 * Rank order: real (positive) scores descending occupy the top ranks; sentinels
 * (negative) follow, ordered by value descending (-1 before -2 …).
 */
function fillEpisode(source: string, entries: EpisodeEntry[]): void {
  const reals = entries.filter(e => e.entry.value >= 0);
  const sentinels = entries.filter(e => e.entry.value < 0);
  if (sentinels.length === 0) return;

  // Reals ranked by score desc; sentinels ranked by sentinel value desc so that
  // -1 (highest missing rank) comes first, then -2, etc.
  reals.sort((a, b) => b.entry.value - a.entry.value);
  sentinels.sort((a, b) => b.entry.value - a.entry.value);

  const firstMissingRank = reals.length + 1;
  const lastRank = reals.length + sentinels.length;

  let filled: Array<{ rank: number; score: number }>;
  if (source === "music_bank") {
    // Anchor to the last real score (rank = reals.length). If somehow there are
    // no reals, fall back to a nominal anchor so we still produce a valid tail.
    const anchor = reals.length > 0 ? reals[reals.length - 1].entry.value : SCORE_FLOOR + lastRank;
    filled = fillMusicBankTail(anchor, firstMissingRank, lastRank);
  } else {
    // m_countdown: anchor to the real #1.
    const anchor = reals.length > 0 ? reals[0].entry.value : SCORE_FLOOR + lastRank;
    filled = fillMCountdown(anchor, firstMissingRank, lastRank);
  }

  // Write filled scores back onto the sentinel entries, in rank order, and
  // flag them as estimated (cosmetic — used to style them in the episode view).
  for (let i = 0; i < sentinels.length; i++) {
    sentinels[i].entry.value = filled[i].score;
    sentinels[i].entry.estimated = true;
  }
}
