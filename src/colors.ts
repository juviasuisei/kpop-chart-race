/**
 * Shared color constants for artist type visualization.
 * Imported by both chart-race-renderer.ts and detail-panel.ts.
 */

import type { ArtistType } from "./types.ts";

/** Colorblind-friendly palette: blue for boy/male, red-pink for girl/female, green for mixed */
export const ARTIST_TYPE_COLORS: Record<ArtistType, string> = {
  boy_group: "#1565C0",
  girl_group: "#C62828",
  solo_male: "#64B5F6",
  solo_female: "#EF9A9A",
  mixed_group: "#009E73",
};
