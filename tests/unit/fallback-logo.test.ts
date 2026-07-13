/**
 * Tests for generateFallbackLogoDataUri utility function.
 * Verifies that the fallback logo generates a valid SVG data URI
 * with the artist's native name rendered as text.
 */

import { describe, it, expect } from "vitest";
import { generateFallbackLogoDataUri } from "../../src/utils.ts";

describe("generateFallbackLogoDataUri", () => {
  it("returns a data URI starting with the SVG data prefix", () => {
    const result = generateFallbackLogoDataUri("BTS");
    expect(result).toMatch(/^data:image\/svg\+xml,/);
  });

  it("encodes the artist name into the SVG text element", () => {
    const result = generateFallbackLogoDataUri("에스파");
    const decoded = decodeURIComponent(result.replace("data:image/svg+xml,", ""));
    expect(decoded).toContain("에스파");
    expect(decoded).toContain("<text");
    expect(decoded).toContain('fill="#fff"');
  });

  it("uses a large font size for short names (≤3 chars)", () => {
    const result = generateFallbackLogoDataUri("BTS");
    const decoded = decodeURIComponent(result.replace("data:image/svg+xml,", ""));
    expect(decoded).toContain('font-size="64"');
  });

  it("uses a medium font size for medium-length names (4-5 chars)", () => {
    const result = generateFallbackLogoDataUri("에이핑크");
    const decoded = decodeURIComponent(result.replace("data:image/svg+xml,", ""));
    expect(decoded).toContain('font-size="48"');
  });

  it("uses a smaller font size for longer names (6-8 chars)", () => {
    const result = generateFallbackLogoDataUri("에이티즈앱세");
    const decoded = decodeURIComponent(result.replace("data:image/svg+xml,", ""));
    expect(decoded).toContain('font-size="36"');
  });

  it("uses smallest font size for very long names (>12 chars)", () => {
    const result = generateFallbackLogoDataUri("This Is A Very Long Name");
    const decoded = decodeURIComponent(result.replace("data:image/svg+xml,", ""));
    expect(decoded).toContain('font-size="22"');
  });

  it("escapes XML special characters in the name", () => {
    const result = generateFallbackLogoDataUri('A&B<C>"D');
    const decoded = decodeURIComponent(result.replace("data:image/svg+xml,", ""));
    expect(decoded).toContain("A&amp;B&lt;C&gt;&quot;D");
    expect(decoded).not.toContain("A&B");
  });

  it("produces a valid SVG structure", () => {
    const result = generateFallbackLogoDataUri("지아");
    const decoded = decodeURIComponent(result.replace("data:image/svg+xml,", ""));
    expect(decoded).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(decoded).toContain('viewBox="0 0 200 200"');
    expect(decoded).toContain("</svg>");
    expect(decoded).toContain('text-anchor="middle"');
    expect(decoded).toContain('dominant-baseline="middle"');
  });

  it("uses the English name when no Korean name is provided", () => {
    const result = generateFallbackLogoDataUri("Zia");
    const decoded = decodeURIComponent(result.replace("data:image/svg+xml,", ""));
    expect(decoded).toContain("Zia");
  });
});
