import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AirtableClient,
  type AirtableClientConfig,
} from "../../src/airtable/airtable-client";
import { RateLimiter } from "../../src/airtable/rate-limiter";

function createConfig(overrides: Partial<AirtableClientConfig> = {}): AirtableClientConfig {
  // Use a mock rate limiter that resolves immediately for most tests
  const mockRateLimiter = { acquire: () => Promise.resolve() } as unknown as RateLimiter;
  return {
    token: "pat_valid_token",
    baseId: "appTEST123",
    rateLimiter: mockRateLimiter,
    ...overrides,
  };
}

describe("AirtableClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("constructor - token validation", () => {
    it("throws when token is undefined", () => {
      expect(
        () => new AirtableClient(createConfig({ token: undefined as unknown as string })),
      ).toThrow("Airtable API token is missing");
    });

    it("throws when token is empty string", () => {
      expect(
        () => new AirtableClient(createConfig({ token: "" })),
      ).toThrow("Airtable API token is missing");
    });

    it("throws when token is whitespace only", () => {
      expect(
        () => new AirtableClient(createConfig({ token: "   \t\n  " })),
      ).toThrow("Airtable API token is missing");
    });

    it("does not throw for a valid token", () => {
      expect(
        () => new AirtableClient(createConfig({ token: "pat_abc123" })),
      ).not.toThrow();
    });
  });

  describe("fetchAll - pagination", () => {
    it("fetches a single page with no offset", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          records: [
            { id: "rec1", fields: { Name: "Alpha" } },
            { id: "rec2", fields: { Name: "Beta" } },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig());
      const records = await client.fetchAll("tblTEST");

      expect(records).toHaveLength(2);
      expect(records[0].id).toBe("rec1");
      expect(records[1].fields).toEqual({ Name: "Beta" });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const calledUrl = new URL(mockFetch.mock.calls[0][0]);
      expect(calledUrl.pathname).toBe("/v0/appTEST123/tblTEST");
      expect(calledUrl.searchParams.get("pageSize")).toBe("100");
    });

    it("paginates through multiple pages using offset tokens", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            records: [{ id: "rec1", fields: {} }],
            offset: "page2token",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            records: [{ id: "rec2", fields: {} }],
            offset: "page3token",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            records: [{ id: "rec3", fields: {} }],
          }),
        });
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig());
      const records = await client.fetchAll("tblTEST");

      expect(records).toHaveLength(3);
      expect(records.map((r) => r.id)).toEqual(["rec1", "rec2", "rec3"]);
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify offset passed in second and third calls
      const secondUrl = new URL(mockFetch.mock.calls[1][0]);
      expect(secondUrl.searchParams.get("offset")).toBe("page2token");
      const thirdUrl = new URL(mockFetch.mock.calls[2][0]);
      expect(thirdUrl.searchParams.get("offset")).toBe("page3token");
    });
  });

  describe("fetchAll - authorization header", () => {
    it("sends Bearer token in Authorization header", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: [] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig({ token: "pat_secret" }));
      await client.fetchAll("tblTEST");

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer pat_secret");
    });
  });

  describe("fetchAll - rate limiter integration", () => {
    it("calls rateLimiter.acquire() before each request", async () => {
      const acquireMock = vi.fn().mockResolvedValue(undefined);
      const mockRateLimiter = { acquire: acquireMock } as unknown as RateLimiter;

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            records: [{ id: "rec1", fields: {} }],
            offset: "next",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            records: [{ id: "rec2", fields: {} }],
          }),
        });
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig({ rateLimiter: mockRateLimiter }));
      await client.fetchAll("tblTEST");

      expect(acquireMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("fetchAll - HTTP error handling", () => {
    it("throws descriptive error for 4xx responses", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: { message: "Table not found" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig());
      await expect(client.fetchAll("tblBAD")).rejects.toThrow(
        "Airtable API error (HTTP 404): Table not found",
      );
    });

    it("throws descriptive error for 5xx responses", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ error: { message: "Server overloaded" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig());
      await expect(client.fetchAll("tblTEST")).rejects.toThrow(
        "Airtable API error (HTTP 500): Server overloaded",
      );
    });

    it("falls back to statusText when error body has no message", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({}),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig());
      await expect(client.fetchAll("tblTEST")).rejects.toThrow(
        "Airtable API error (HTTP 403): Forbidden",
      );
    });
  });

  describe("fetchAll - 429 retry with exponential backoff", () => {
    it("retries after 429 and succeeds on second attempt", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          json: async () => ({ error: { message: "Rate limited" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            records: [{ id: "rec1", fields: {} }],
          }),
        });
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig());
      const promise = client.fetchAll("tblTEST");

      // Advance past 3s delay for first retry
      await vi.advanceTimersByTimeAsync(3000);

      const records = await promise;
      expect(records).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries with correct backoff delays (3s, 5s, 10s)", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          json: async () => ({ error: { message: "Rate limited" } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          json: async () => ({ error: { message: "Rate limited" } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          json: async () => ({ error: { message: "Rate limited" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            records: [{ id: "rec1", fields: {} }],
          }),
        });
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig());
      const promise = client.fetchAll("tblTEST");

      // After first 429: wait 3s
      await vi.advanceTimersByTimeAsync(3000);
      // After second 429: wait 5s
      await vi.advanceTimersByTimeAsync(5000);
      // After third 429: wait 10s
      await vi.advanceTimersByTimeAsync(10000);

      const records = await promise;
      expect(records).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("throws after exhausting 3 retries on 429", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () => ({ error: { message: "Rate limited" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig());
      // Capture rejection immediately to prevent unhandled rejection warnings
      let caughtError: Error | undefined;
      const promise = client.fetchAll("tblTEST").catch((e) => {
        caughtError = e;
      });

      // Advance through all retry delays: 3s + 5s + 10s
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(10000);

      // Flush microtasks before asserting
      await vi.advanceTimersByTimeAsync(0);

      await promise;

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toBe(
        "Airtable API error (HTTP 429): Rate limit exceeded after 3 retries",
      );
      // Initial + 3 retries = 4 fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe("fetchAll - timeout handling", () => {
    it("throws timeout error when request exceeds 30 seconds", async () => {
      const mockFetch = vi.fn().mockImplementation((_url: string, options: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          const onAbort = () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (options.signal.aborted) {
            onAbort();
          } else {
            options.signal.addEventListener("abort", onAbort);
          }
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig());
      let caughtError: Error | undefined;
      const promise = client.fetchAll("tblTEST").catch((e) => {
        caughtError = e;
      });

      // Advance past 30s timeout and flush microtasks
      await vi.advanceTimersByTimeAsync(30_001);
      await promise;

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toBe(
        "Airtable API request timed out after 30 seconds",
      );
    });

    it("uses custom timeoutMs when provided", async () => {
      const mockFetch = vi.fn().mockImplementation((_url: string, options: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          const onAbort = () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (options.signal.aborted) {
            onAbort();
          } else {
            options.signal.addEventListener("abort", onAbort);
          }
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig({ timeoutMs: 5000 }));
      let caughtError: Error | undefined;
      const promise = client.fetchAll("tblTEST").catch((e) => {
        caughtError = e;
      });

      await vi.advanceTimersByTimeAsync(5001);
      await promise;

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toBe(
        "Airtable API request timed out after 5 seconds",
      );
    });
  });

  describe("fetchAll - network error handling", () => {
    it("throws network error on fetch failure", async () => {
      const mockFetch = vi.fn().mockRejectedValueOnce(
        new TypeError("Failed to fetch"),
      );
      vi.stubGlobal("fetch", mockFetch);

      const client = new AirtableClient(createConfig());
      await expect(client.fetchAll("tblTEST")).rejects.toThrow(
        "Network error: Unable to connect to Airtable API",
      );
    });
  });
});
