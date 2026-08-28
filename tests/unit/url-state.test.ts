/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for URL hash state helpers, including the "open in new tab"
 * support: buildShareableUrl (constructs an absolute URL for a target state)
 * and isNewTabIntent (detects modifier/middle-click gestures).
 */

import { describe, it, expect } from "vitest";
import {
  encodeStateToHash,
  parseHashToState,
  buildShareableUrl,
  isNewTabIntent,
} from "../../src/url-state.ts";
import type { FilterState } from "../../src/types.ts";

const DEFAULT_STATE: FilterState = {
  view: "line",
  generation: "all",
  source: "all",
  artist: "all",
  displayMode: "songs",
  zoom: 10,
  metric: "points",
};

describe("encode/parse round-trip", () => {
  it("omits default values from the hash", () => {
    expect(encodeStateToHash(DEFAULT_STATE)).toBe("");
  });

  it("encodes only non-default fields", () => {
    const hash = encodeStateToHash({ ...DEFAULT_STATE, view: "artist-timeline", artist: "aespa" });
    expect(hash).toBe("#view=artist-timeline&artist=aespa");
  });

  it("round-trips a non-default state", () => {
    const partial = parseHashToState("#view=artist-timeline&artist=aespa");
    expect(partial).toEqual({ view: "artist-timeline", artist: "aespa" });
  });

  it("encodes a playback date when present", () => {
    const hash = encodeStateToHash({ ...DEFAULT_STATE, date: "2026-07-15" });
    expect(hash).toBe("#date=2026-07-15");
  });

  it("omits the date when not set", () => {
    expect(encodeStateToHash({ ...DEFAULT_STATE })).toBe("");
    expect(encodeStateToHash({ ...DEFAULT_STATE, date: undefined })).toBe("");
  });

  it("parses a valid YYYY-MM-DD date", () => {
    expect(parseHashToState("#date=2026-07-15")).toEqual({ date: "2026-07-15" });
  });

  it("ignores a malformed date", () => {
    expect(parseHashToState("#date=2026-7-5")).toEqual({});
    expect(parseHashToState("#date=bogus")).toEqual({});
    expect(parseHashToState("#date=2026-07")).toEqual({});
  });

  it("round-trips date alongside other params", () => {
    const hash = encodeStateToHash({ ...DEFAULT_STATE, source: "inkigayo", date: "2026-01-02" });
    expect(hash).toContain("source=inkigayo");
    expect(hash).toContain("date=2026-01-02");
    const parsed = parseHashToState(hash);
    expect(parsed.source).toBe("inkigayo");
    expect(parsed.date).toBe("2026-01-02");
  });

  it("encodes the detail zoom when not 100%", () => {
    expect(encodeStateToHash({ ...DEFAULT_STATE, detail: 5 })).toBe("#detail=5");
  });

  it("omits the detail zoom at 100% (the default)", () => {
    expect(encodeStateToHash({ ...DEFAULT_STATE, detail: 100 })).toBe("");
    expect(encodeStateToHash({ ...DEFAULT_STATE, detail: undefined })).toBe("");
  });

  it("parses a valid detail percentage", () => {
    expect(parseHashToState("#detail=25")).toEqual({ detail: 25 });
  });

  it("ignores an out-of-range or malformed detail value", () => {
    expect(parseHashToState("#detail=0")).toEqual({});
    expect(parseHashToState("#detail=150")).toEqual({});
    expect(parseHashToState("#detail=abc")).toEqual({});
  });
});

describe("buildShareableUrl", () => {
  it("merges the target over the base state and returns an absolute URL", () => {
    const url = buildShareableUrl(
      { view: "artist-timeline", artist: "aespa" },
      DEFAULT_STATE,
    );
    const { origin, pathname } = window.location;
    expect(url).toBe(`${origin}${pathname}#view=artist-timeline&artist=aespa`);
  });

  it("carries forward non-default fields already present in the base", () => {
    const base: FilterState = { ...DEFAULT_STATE, source: "inkigayo" };
    const url = buildShareableUrl({ view: "episodes" }, base);
    // source=inkigayo is non-default, so it stays in the hash alongside the view.
    expect(url).toContain("view=episodes");
    expect(url).toContain("source=inkigayo");
  });

  it("produces a hash that parses back to the merged state", () => {
    const url = buildShareableUrl(
      { view: "artist-timeline", artist: "bts" },
      DEFAULT_STATE,
    );
    const hash = url.slice(url.indexOf("#"));
    expect(parseHashToState(hash)).toEqual({ view: "artist-timeline", artist: "bts" });
  });

  it("returns a bare origin+path (no hash) when target equals defaults", () => {
    const url = buildShareableUrl({}, DEFAULT_STATE);
    const { origin, pathname } = window.location;
    expect(url).toBe(`${origin}${pathname}`);
  });
});

describe("isNewTabIntent", () => {
  it("is true for Cmd (metaKey)", () => {
    expect(isNewTabIntent(new MouseEvent("click", { metaKey: true }))).toBe(true);
  });

  it("is true for Ctrl", () => {
    expect(isNewTabIntent(new MouseEvent("click", { ctrlKey: true }))).toBe(true);
  });

  it("is true for Shift (new window)", () => {
    expect(isNewTabIntent(new MouseEvent("click", { shiftKey: true }))).toBe(true);
  });

  it("is true for a middle-click (button 1)", () => {
    expect(isNewTabIntent(new MouseEvent("auxclick", { button: 1 }))).toBe(true);
  });

  it("is false for a plain left-click", () => {
    expect(isNewTabIntent(new MouseEvent("click", { button: 0 }))).toBe(false);
  });
});
