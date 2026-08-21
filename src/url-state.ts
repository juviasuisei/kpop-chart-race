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
    }
  }
  return partial;
}
