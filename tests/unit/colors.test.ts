/**
 * Unit tests for the artist-type color palette.
 *
 * Locks in the "group hue → paler solo tint" relationship: each solo category
 * is a lighter version of its group counterpart's hue. Solo Non-Binary is a
 * paler blue derived from Mixed Group's blue, mirroring how Solo Male relates
 * to Boy Group (green) and Solo Female to Girl Group (purple).
 */

import { describe, it, expect } from "vitest";
import { ARTIST_TYPE_COLORS } from "../../src/colors.ts";

/** Parse a #RRGGBB string into [r, g, b] (0–255). */
function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB hex: ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Perceived lightness proxy: simple channel sum (higher = paler). */
function lightness(hex: string): number {
  const [r, g, b] = rgb(hex);
  return r + g + b;
}

describe("ARTIST_TYPE_COLORS — Solo Non-Binary", () => {
  it("defines a color for solo_non_binary", () => {
    expect(ARTIST_TYPE_COLORS.solo_non_binary).toBe("#90CAF9");
  });

  it("is a paler tint than Mixed Group", () => {
    expect(lightness(ARTIST_TYPE_COLORS.solo_non_binary)).toBeGreaterThan(
      lightness(ARTIST_TYPE_COLORS.mixed_group),
    );
  });

  it("shares Mixed Group's blue-dominant hue (blue is the largest channel)", () => {
    const [r, g, b] = rgb(ARTIST_TYPE_COLORS.solo_non_binary);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it("follows the same group→solo paling relationship as the gendered pairs", () => {
    // Every solo category is paler than its group counterpart.
    expect(lightness(ARTIST_TYPE_COLORS.solo_male)).toBeGreaterThan(
      lightness(ARTIST_TYPE_COLORS.boy_group),
    );
    expect(lightness(ARTIST_TYPE_COLORS.solo_female)).toBeGreaterThan(
      lightness(ARTIST_TYPE_COLORS.girl_group),
    );
    expect(lightness(ARTIST_TYPE_COLORS.solo_non_binary)).toBeGreaterThan(
      lightness(ARTIST_TYPE_COLORS.mixed_group),
    );
  });
});
