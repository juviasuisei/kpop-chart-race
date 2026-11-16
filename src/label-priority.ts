/**
 * Endpoint-label priority for the race view.
 *
 * When endpoint labels collide, the candidate that ranks first is placed
 * first and wins the slot. This module is pure (no DOM, no canvas) so the
 * order can be tested on its own. Rules, in precedence order:
 *
 *   1. #1 overall: the highest cumulative total as of "now".
 *   2. Chart winner on "now", then on now-1, ... back to now-28 (29 calendar
 *      days). A more recent win outranks an older one. A line that won on
 *      several of those days counts by its MOST RECENT win. Several winners
 *      on the same day (different shows, or a tie) are equal at this rule
 *      and fall through to rule 3.
 *   3. Most recent activity (latest day, up to now, with any points).
 *   4. Largest cumulative total as of now.
 *   5. Largest summed total of the artist's lines as of now.
 *   6. Alphabetical: title, then artist name (case-insensitive), then lineId
 *      so the order is a strict total order.
 */

/** Calendar days considered for rule 2: now, now-1, ..., now-28. */
export const WINNER_LOOKBACK_DAYS = 29;

export interface LabelRankInput {
  lineId: string;
  /** Cumulative total as of "now". */
  total: number;
  /** Date index of the latest day with points, up to now (-1 = none). */
  lastActivityIdx: number;
  /** Sum of totals over all of this line's artist's lines as of now. */
  artistTotal: number;
  /** Song title (Songs mode) or artist name (Artists mode). */
  title: string;
  artistName: string;
}

export interface LabelRankContext {
  /** The frame's far-right date, YYYY-MM-DD. */
  nowDate: string;
  /** date (YYYY-MM-DD) -> lineIds that won a chart show on that date. */
  winnersByDate: ReadonlyMap<string, ReadonlySet<string>>;
  /** Pinned line (Artists-mode filter): placed before everything, even #1. */
  pinnedLineId?: string;
}

/** Shift a YYYY-MM-DD date by whole calendar days (UTC). null if unparsable. */
export function shiftDate(date: string, deltaDays: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]) + deltaDays * 86_400_000;
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/** The lookback window's dates, newest first: nowDate, nowDate-1, ... */
export function winnerWindowDates(nowDate: string): string[] {
  const out: string[] = [];
  for (let k = 0; k < WINNER_LOOKBACK_DAYS; k++) {
    const d = shiftDate(nowDate, -k);
    if (d === null) break;
    out.push(d);
  }
  return out;
}

function ageInWindow(
  lineId: string,
  window: readonly string[],
  winnersByDate: ReadonlyMap<string, ReadonlySet<string>>,
): number {
  for (let k = 0; k < window.length; k++) {
    if (winnersByDate.get(window[k])?.has(lineId)) return k;
  }
  return WINNER_LOOKBACK_DAYS;
}

/**
 * Age in days (0..28) of the line's most recent win within the lookback
 * window ending at nowDate, or WINNER_LOOKBACK_DAYS if it has none.
 */
export function winAgeDays(
  lineId: string,
  nowDate: string,
  winnersByDate: ReadonlyMap<string, ReadonlySet<string>>,
): number {
  return ageInWindow(lineId, winnerWindowDates(nowDate), winnersByDate);
}

const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

interface Keyed<T> {
  item: T;
  isTop: boolean;
  winAge: number;
  title: string;
  artist: string;
}

function compareKeyed<T extends LabelRankInput>(a: Keyed<T>, b: Keyed<T>): number {
  const x = a.item;
  const y = b.item;
  if (a.isTop !== b.isTop) return a.isTop ? -1 : 1;
  if (a.winAge !== b.winAge) return a.winAge - b.winAge;
  const act = finite(y.lastActivityIdx) - finite(x.lastActivityIdx);
  if (act !== 0) return act;
  const tot = finite(y.total) - finite(x.total);
  if (tot !== 0) return tot;
  const art = finite(y.artistTotal) - finite(x.artistTotal);
  if (art !== 0) return art;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  if (a.artist !== b.artist) return a.artist < b.artist ? -1 : 1;
  if (x.lineId !== y.lineId) return x.lineId < y.lineId ? -1 : 1;
  return 0;
}

/** Return the candidates ordered by label priority (highest priority first). */
export function rankLabelCandidates<T extends LabelRankInput>(
  candidates: readonly T[],
  ctx: LabelRankContext,
): T[] {
  if (candidates.length === 0) return [];
  let maxTotal = -Infinity;
  for (const c of candidates) maxTotal = Math.max(maxTotal, finite(c.total));
  const window = winnerWindowDates(ctx.nowDate);
  const keyed: Keyed<T>[] = candidates.map(item => ({
    item,
    isTop: finite(item.total) === maxTotal,
    winAge: ageInWindow(item.lineId, window, ctx.winnersByDate),
    title: item.title.toLowerCase(),
    artist: item.artistName.toLowerCase(),
  }));
  keyed.sort(compareKeyed);
  const result = keyed.map(k => k.item);
  if (ctx.pinnedLineId !== undefined) {
    const i = result.findIndex(c => c.lineId === ctx.pinnedLineId);
    if (i > 0) result.unshift(...result.splice(i, 1));
  }
  return result;
}

/**
 * Build date -> winning lineIds from `DataStore.releaseWinDates`
 * (keys `${artistId}::${releaseId}`). Songs mode maps a win to the song's
 * primary-artist lineId (`${artistIds[0]}::${releaseId}`); Artists mode maps
 * it to the winning artist's id. With `source` set, only wins on that chart
 * show count (matches the source filter on the drawn lines).
 */
export function buildWinnersByDate(
  artists: ReadonlyMap<
    string,
    { releases: readonly { id: string; artistIds: readonly string[]; dailyValues: ReadonlyMap<string, { source: string }> }[] }
  >,
  releaseWinDates: ReadonlyMap<string, readonly string[]> | undefined,
  mode: "songs" | "artists",
  source: string = "all",
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [key, dates] of releaseWinDates ?? []) {
    const sep = key.indexOf("::");
    if (sep < 0) continue;
    const artistId = key.slice(0, sep);
    const releaseId = key.slice(sep + 2);
    const rel = artists.get(artistId)?.releases.find(r => r.id === releaseId);
    let lineId = artistId;
    if (mode === "songs") lineId = `${rel?.artistIds[0] ?? artistId}::${releaseId}`;
    for (const d of dates) {
      if (source !== "all" && rel?.dailyValues.get(d)?.source !== source) continue;
      let s = out.get(d);
      if (!s) out.set(d, (s = new Set()));
      s.add(lineId);
    }
  }
  return out;
}

/**
 * Largest value in the ascending-sorted `indices` that is <= `nowIdx`,
 * or -1 when there is none.
 */
export function lastActivityAtOrBefore(indices: readonly number[], nowIdx: number): number {
  let lo = 0;
  let hi = indices.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (indices[mid] <= nowIdx) {
      best = indices[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
