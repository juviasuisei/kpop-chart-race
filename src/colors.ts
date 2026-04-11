/**
 * Shared color constants for artist type visualization.
 * Imported by both chart-race-renderer.ts and detail-panel.ts.
 */

import type { ArtistType } from "./types.ts";

/** Colorblind-friendly palette: blue for boy/male, purple for girl/female, green for mixed */
export const ARTIST_TYPE_COLORS: Record<ArtistType, string> = {
  boy_group: "#1565C0",
  girl_group: "#7B1FA2",
  solo_male: "#64B5F6",
  solo_female: "#CE93D8",
  mixed_group: "#009E73",
};
