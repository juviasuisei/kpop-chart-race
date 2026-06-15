import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CacheManager } from "../../src/airtable/cache-manager";
import type { DataStore } from "../../src/models";

/**
 * Helper to build a minimal valid DataStore for testing.
 * Contains one artist with one release that has one dailyValue entry,
 * and a non-empty dates array.
 */
function createMinimalDataStore(): DataStore {
  return {
    artists: new Map([
      [
        "test_artist",
        {
          id: "test_artist",
          name: "Test Artist",
          artistType: "boy_group",
          generation: 5,
          logoUrl: "assets/logos/test_artist.svg",
          koreanName: "테스트",
          debut: "2024-01-01",
          releases: [
            {
              id: "test-release",
              title: "Test Release",
              dailyValues: new Map([
                [
                  "2024-06-01",
                  { value: 5000, source: "inkigayo", episode: 100 },
                ],
              ]),
              embeds: new Map([
                [
                  "2024-06-01",
                  [{ type: "mv", url: "https://example.com/mv" }],
                ],
              ]),
            },
          ],
        },
      ],
    ]),
    dates: ["2024-06-01"],
    startDate: "2024-06-01",
    endDate: "2024-06-01",
    firstAppearance: new Map([["test_artist", "2024-06-01"]]),
    chartWins: new Map(),
  };
}

describe("CacheManager", () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    cacheManager = new CacheManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("cache bypass with ?nocache URL parameter", () => {
    it("returns true from shouldBypass when URL contains ?nocache", () => {
      Object.defineProperty(window, "location", {
        value: { search: "?nocache" },
        writable: true,
        configurable: true,
      });

      expect(cacheManager.shouldBypass()).toBe(true);
    });

    it("returns true from shouldBypass when ?nocache is among other params", () => {
      Object.defineProperty(window, "location", {
        value: { search: "?foo=bar&nocache&baz=1" },
        writable: true,
        configurable: true,
      });

      expect(cacheManager.shouldBypass()).toBe(true);
    });

    it("returns false from shouldBypass when URL does not contain ?nocache", () => {
      Object.defineProperty(window, "location", {
        value: { search: "" },
        writable: true,
        configurable: true,
      });

      expect(cacheManager.shouldBypass()).toBe(false);
    });

    it("returns false from shouldBypass when URL has unrelated params", () => {
      Object.defineProperty(window, "location", {
        value: { search: "?foo=bar&debug=true" },
        writable: true,
        configurable: true,
      });

      expect(cacheManager.shouldBypass()).toBe(false);
    });
  });

  describe("cache version mismatch invalidation", () => {
    it("returns null and clears storage when version does not match", () => {
      // Write an entry with a mismatched version directly to sessionStorage
      const invalidVersionEntry = {
        version: "old-version-v0",
        timestamp: Date.now(),
        data: {
          artists: [["test_artist", { id: "test_artist", name: "Test", artistType: "boy_group", generation: 5, logoUrl: "x.svg", releases: [] }]],
          dates: ["2024-01-01"],
          startDate: "2024-01-01",
          endDate: "2024-01-01",
          firstAppearance: [["test_artist", "2024-01-01"]],
          chartWins: [],
        },
      };

      sessionStorage.setItem("airtable-v1", JSON.stringify(invalidVersionEntry));

      const result = cacheManager.get();
      expect(result).toBeNull();
      expect(sessionStorage.getItem("airtable-v1")).toBeNull();
    });
  });

  describe("valid cache read/write round-trip", () => {
    it("stores and retrieves a DataStore with Maps intact", () => {
      Object.defineProperty(window, "location", {
        value: { search: "" },
        writable: true,
        configurable: true,
      });

      const store = createMinimalDataStore();
      vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));

      cacheManager.set(store);
      const retrieved = cacheManager.get();

      expect(retrieved).not.toBeNull();
      expect(retrieved!.dates).toEqual(["2024-06-01"]);
      expect(retrieved!.startDate).toBe("2024-06-01");
      expect(retrieved!.endDate).toBe("2024-06-01");

      // Verify artists Map was deserialized correctly
      const artist = retrieved!.artists.get("test_artist");
      expect(artist).toBeDefined();
      expect(artist!.name).toBe("Test Artist");
      expect(artist!.artistType).toBe("boy_group");
      expect(artist!.generation).toBe(5);
      expect(artist!.koreanName).toBe("테스트");

      // Verify release Maps deserialized
      const release = artist!.releases[0];
      expect(release.title).toBe("Test Release");
      expect(release.dailyValues).toBeInstanceOf(Map);
      expect(release.dailyValues.get("2024-06-01")).toEqual({
        value: 5000,
        source: "inkigayo",
        episode: 100,
      });
      expect(release.embeds).toBeInstanceOf(Map);
      expect(release.embeds.get("2024-06-01")).toEqual([
        { type: "mv", url: "https://example.com/mv" },
      ]);

      // Verify firstAppearance Map
      expect(retrieved!.firstAppearance.get("test_artist")).toBe("2024-06-01");

      // chartWins is always empty from cache
      expect(retrieved!.chartWins).toBeInstanceOf(Map);
    });
  });

  describe("expired cache is cleared and returns null", () => {
    it("returns null when cache entry is older than 1 hour", () => {
      Object.defineProperty(window, "location", {
        value: { search: "" },
        writable: true,
        configurable: true,
      });

      const store = createMinimalDataStore();

      // Set time and write cache
      vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
      cacheManager.set(store);

      // Advance time by just over 1 hour (3_600_001 ms)
      vi.setSystemTime(new Date("2024-06-15T13:00:01Z"));

      const result = cacheManager.get();
      expect(result).toBeNull();
      // Verify the expired entry was cleared
      expect(sessionStorage.getItem("airtable-v1")).toBeNull();
    });

    it("returns valid data when cache is exactly at the TTL boundary", () => {
      Object.defineProperty(window, "location", {
        value: { search: "" },
        writable: true,
        configurable: true,
      });

      const store = createMinimalDataStore();

      // Set time and write cache
      vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
      cacheManager.set(store);

      // Advance by exactly 1 hour (3_600_000 ms) — should still be valid (boundary: > not >=)
      vi.setSystemTime(new Date("2024-06-15T13:00:00Z"));

      const result = cacheManager.get();
      expect(result).not.toBeNull();
    });
  });

  describe("deserialization failure clears invalid entry", () => {
    it("returns null and clears storage when JSON is malformed", () => {
      sessionStorage.setItem("airtable-v1", "not valid json {{{");

      const result = cacheManager.get();
      expect(result).toBeNull();
      expect(sessionStorage.getItem("airtable-v1")).toBeNull();
    });

    it("returns null and clears storage when data structure is missing required fields", () => {
      const incompleteEntry = {
        version: "airtable-v1",
        timestamp: Date.now(),
        data: {
          artists: [], // empty artists — fails structural validation
          dates: ["2024-01-01"],
          startDate: "2024-01-01",
          endDate: "2024-01-01",
          firstAppearance: [],
          chartWins: [],
        },
      };

      sessionStorage.setItem("airtable-v1", JSON.stringify(incompleteEntry));

      const result = cacheManager.get();
      expect(result).toBeNull();
      expect(sessionStorage.getItem("airtable-v1")).toBeNull();
    });

    it("returns null and clears storage when dates array is empty", () => {
      const noDateEntry = {
        version: "airtable-v1",
        timestamp: Date.now(),
        data: {
          artists: [["test", { id: "test", name: "Test", artistType: "boy_group", generation: 5, logoUrl: "x.svg", releases: [] }]],
          dates: [], // empty dates — fails structural validation
          startDate: "",
          endDate: "",
          firstAppearance: [],
          chartWins: [],
        },
      };

      sessionStorage.setItem("airtable-v1", JSON.stringify(noDateEntry));

      const result = cacheManager.get();
      expect(result).toBeNull();
      expect(sessionStorage.getItem("airtable-v1")).toBeNull();
    });
  });

  describe("QuotaExceededError is handled gracefully", () => {
    it("catches QuotaExceededError, clears storage, and continues without throwing", () => {
      const store = createMinimalDataStore();

      // Mock sessionStorage.setItem to throw QuotaExceededError
      const quotaError = new DOMException(
        "Storage quota exceeded",
        "QuotaExceededError",
      );
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw quotaError;
      });
      const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

      // Should not throw
      expect(() => cacheManager.set(store)).not.toThrow();

      // Should have attempted to clear
      expect(removeItemSpy).toHaveBeenCalledWith("airtable-v1");

      setItemSpy.mockRestore();
      removeItemSpy.mockRestore();
    });

    it("handles DOMException with code 22 (legacy QuotaExceededError)", () => {
      const store = createMinimalDataStore();

      // Some browsers use code 22 instead of the name
      const legacyError = new DOMException("Quota exceeded");
      Object.defineProperty(legacyError, "code", { value: 22, writable: false });
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw legacyError;
      });
      const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

      expect(() => cacheManager.set(store)).not.toThrow();
      expect(removeItemSpy).toHaveBeenCalledWith("airtable-v1");

      setItemSpy.mockRestore();
      removeItemSpy.mockRestore();
    });

    it("handles non-DOMException storage errors gracefully", () => {
      const store = createMinimalDataStore();

      const genericError = new Error("Unknown storage error");
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw genericError;
      });
      const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

      expect(() => cacheManager.set(store)).not.toThrow();
      expect(removeItemSpy).toHaveBeenCalledWith("airtable-v1");

      setItemSpy.mockRestore();
      removeItemSpy.mockRestore();
    });
  });
});
