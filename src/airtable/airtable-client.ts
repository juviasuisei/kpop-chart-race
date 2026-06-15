import type { RateLimiter } from "./rate-limiter";

/** Raw Airtable record with id and fields object */
export interface AirtableRecord<T = Record<string, unknown>> {
  id: string;
  fields: T;
}

/** Configuration for the Airtable client */
export interface AirtableClientConfig {
  token: string;
  baseId: string;
  rateLimiter: RateLimiter;
  timeoutMs?: number; // default: 30_000
}

/** Airtable list response shape */
interface AirtableListResponse<T> {
  records: AirtableRecord<T>[];
  offset?: string;
}

/** Retry delays for 429 responses: 3s, 5s, 10s */
const RETRY_DELAYS_MS = [3000, 5000, 10000] as const;
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;

/**
 * Fetches all records from a table, handling pagination and 429 retries.
 */
export class AirtableClient {
  private readonly token: string;
  private readonly baseId: string;
  private readonly rateLimiter: RateLimiter;
  private readonly timeoutMs: number;

  constructor(config: AirtableClientConfig) {
    if (!config.token || config.token.trim().length === 0) {
      throw new Error(
        "Airtable API token is missing. Set the VITE_AIRTABLE_API_TOKEN environment variable.",
      );
    }

    this.token = config.token;
    this.baseId = config.baseId;
    this.rateLimiter = config.rateLimiter;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Fetch all records from a table, paginating through all pages.
   * @param tableId - The Airtable table ID
   * @returns Array of all records
   * @throws Error on HTTP errors, timeout, or exhausted retries
   */
  async fetchAll<T>(tableId: string): Promise<AirtableRecord<T>[]> {
    const allRecords: AirtableRecord<T>[] = [];
    let offset: string | undefined;

    do {
      const url = this.buildUrl(tableId, offset);
      const response = await this.fetchWithRetry<T>(url);
      allRecords.push(...response.records);
      offset = response.offset;
    } while (offset);

    return allRecords;
  }

  private buildUrl(tableId: string, offset?: string): string {
    const url = new URL(
      `https://api.airtable.com/v0/${this.baseId}/${tableId}`,
    );
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (offset) {
      url.searchParams.set("offset", offset);
    }
    return url.toString();
  }

  private async fetchWithRetry<T>(
    url: string,
  ): Promise<AirtableListResponse<T>> {
    let retries = 0;

    while (true) {
      await this.rateLimiter.acquire();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 429) {
          if (retries >= MAX_RETRIES) {
            throw new Error(
              `Airtable API error (HTTP 429): Rate limit exceeded after ${MAX_RETRIES} retries`,
            );
          }
          const delay = RETRY_DELAYS_MS[retries];
          retries++;
          await this.sleep(delay);
          continue;
        }

        if (!response.ok) {
          const errorBody = await this.extractErrorMessage(response);
          throw new Error(
            `Airtable API error (HTTP ${response.status}): ${errorBody}`,
          );
        }

        return (await response.json()) as AirtableListResponse<T>;
      } catch (error: unknown) {
        clearTimeout(timeoutId);

        if (error instanceof Error) {
          // Re-throw our own errors (HTTP errors, exhausted retries)
          if (error.message.startsWith("Airtable API error")) {
            throw error;
          }

          // AbortError means the request timed out
          if (
            error.name === "AbortError" ||
            error.name === "TimeoutError"
          ) {
            throw new Error(
              `Airtable API request timed out after ${Math.round(this.timeoutMs / 1000)} seconds`,
            );
          }

          // Any other fetch error is a network failure
          throw new Error(
            "Network error: Unable to connect to Airtable API",
          );
        }

        throw new Error(
          "Network error: Unable to connect to Airtable API",
        );
      }
    }
  }

  private async extractErrorMessage(response: Response): Promise<string> {
    try {
      const body = await response.json();
      if (body?.error?.message) {
        return body.error.message;
      }
      if (typeof body?.error === "string") {
        return body.error;
      }
      return response.statusText || "Unknown error";
    } catch {
      return response.statusText || "Unknown error";
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
