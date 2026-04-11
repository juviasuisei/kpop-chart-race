/**
 * Shared color constants for artist type visualization.
 * Imported by both chart-race-renderer.ts and detail-panel.ts.
 */

import type { ArtistType } from "./types.ts";

/** Colorblind-friendly palette: green for boy/male, purple for girl/female, blue for mixed */
export const ARTIST_TYPE_COLORS: Record<ArtistType, string> = {
  boy_group: "#2E7D32",
  girl_group: "#7B1FA2",
  solo_male: "#81C784",
  solo_female: "#CE93D8",
  mixed_group: "#1565C0",
};
