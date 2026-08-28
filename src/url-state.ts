/**
 * URL hash encoding/decoding for filter state.
 * Keeps the shareable/refresh-persistent subset of FilterState in the URL
 * hash. Only non-default values are encoded, so a clean default state yields
 * an empty hash.
 */

import type { FilterState } from "./types.ts";

/** Default values; fields equal to these are omitted from the hash. */
export const DEFAULT_FILTER_VALUES: Partial<FilterState> = {
  view: "line",
  generation: "all",
  source: "all",
  artist: "all",
  displayMode: "songs",
  zoom: 10,
  metric: "points",
};

/** Encode the current filter state into a URL hash (e.g. "#view=yearly&zoom=all"). */
export function encodeStateToHash(state: FilterState): string {
  const params: string[] = [];
  if (state.view !== DEFAULT_FILTER_VALUES.view) params.push(`view=${state.view}`);
  if (state.generation !== DEFAULT_FILTER_VALUES.generation) params.push(`gen=${state.generation}`);
  if (state.source !== DEFAULT_FILTER_VALUES.source) params.push(`source=${state.source}`);
  if (state.artist !== DEFAULT_FILTER_VALUES.artist) params.push(`artist=${state.artist}`);
  if (state.displayMode !== DEFAULT_FILTER_VALUES.displayMode) params.push(`mode=${state.displayMode}`);
  if (state.zoom !== DEFAULT_FILTER_VALUES.zoom) params.push(`zoom=${state.zoom}`);
  if (state.metric !== DEFAULT_FILTER_VALUES.metric) params.push(`metric=${state.metric}`);
  // Playback date (race/line view only): a shareable pointer to a specific day.
  if (state.date) params.push(`date=${state.date}`);
  // Value-axis detail zoom (race/line view only); 100% is the default, omitted.
  if (state.detail !== undefined && state.detail !== 100) params.push(`detail=${state.detail}`);
  return params.length > 0 ? `#${params.join("&")}` : "";
}

/** Parse a URL hash into a partial filter state, ignoring invalid values. */
export function parseHashToState(hash: string): Partial<FilterState> {
  const partial: Partial<FilterState> = {};
  if (!hash || hash === "#") return partial;

  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const pairs = raw.split("&");
  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    if (!key || !value) continue;
    switch (key) {
      case "view":
        if (["line", "race", "yearly", "episodes", "artist-timeline"].includes(value)) {
          partial.view = value as FilterState["view"];
        }
        break;
      case "gen":
        partial.generation = value === "all" ? "all" : parseInt(value, 10);
        break;
      case "source":
        partial.source = value;
        break;
      case "artist":
        partial.artist = value;
        break;
      case "mode":
        if (value === "songs" || value === "artists") {
          partial.displayMode = value;
        }
        break;
      case "zoom":
        if (value === "all") {
          partial.zoom = "all";
        } else if (value === "10") {
          partial.zoom = 10;
        }
        break;
      case "metric":
        if (value === "points" || value === "wins" || value === "appearances") {
          partial.metric = value;
        }
        break;
      case "date":
        // Basic YYYY-MM-DD shape check; the loader snaps to the nearest actual date.
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          partial.date = value;
        }
        break;
      case "detail": {
        const n = parseInt(value, 10);
        if (Number.isFinite(n) && n >= 1 && n <= 100) {
          partial.detail = n;
        }
        break;
      }
    }
  }
  return partial;
}

/**
 * Build a full, shareable URL (origin + path + hash) for a target filter
 * state. `target` is merged over `base` (typically the current state) so
 * callers only need to specify the fields that change — e.g.
 * `buildShareableUrl({ view: "artist-timeline", artist: "aespa" }, current)`.
 *
 * Used to open a navigation target in a new browser tab, where the hash must
 * be a complete absolute URL rather than an in-place state mutation.
 */
export function buildShareableUrl(
  target: Partial<FilterState>,
  base: FilterState,
): string {
  const merged: FilterState = { ...base, ...target };
  const hash = encodeStateToHash(merged);
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${hash}`;
}

/**
 * True when a mouse event expresses intent to open a link in a new tab or
 * window: Cmd (macOS), Ctrl (Windows/Linux), Shift (new window), or a
 * middle-click (button 1). Mirrors the browser's native anchor behavior so
 * our in-place navigations can honor the same gestures.
 */
export function isNewTabIntent(e: MouseEvent): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;
}
