// Feature: airtable-data-layer, Property 1: Whitespace token rejection
// Feature: airtable-data-layer, Property 2: Pagination completeness

import fc from 'fast-check';
import { test } from '@fast-check/vitest';
import { AirtableClient, type AirtableRecord } from '../../src/airtable/airtable-client.ts';
import type { RateLimiter } from '../../src/airtable/rate-limiter.ts';

// ============================================================
// Property 1: Whitespace token rejection
// **Validates: Requirements 1.2**
//
// For any string composed entirely of whitespace characters
// (spaces, tabs, newlines, or empty string), initializing the
// AirtableClient with that string as the token SHALL throw an
// error indicating the token is missing.
// ============================================================

/** Minimal mock RateLimiter that satisfies the interface */
const mockRateLimiter: RateLimiter = {
  acquire: () => Promise.resolve(),
} as unknown as RateLimiter;

describe('Property 1: Whitespace token rejection', () => {
  // Arbitrary that generates whitespace-only strings (including empty string)
  const whitespaceOnlyArb = fc.string({
    unit: fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'),
  });

  test.prop([whitespaceOnlyArb], { numRuns: 100 })(
    'constructing AirtableClient with a whitespace-only token throws "token is missing"',
    (whitespaceToken) => {
      expect(() => {
        new AirtableClient({
          token: whitespaceToken,
          baseId: 'appTEST123',
          rateLimiter: mockRateLimiter,
        });
      }).toThrow(/token is missing/i);
    },
  );

  // Inverse property: non-empty strings with at least one non-whitespace char should NOT throw
  const nonWhitespaceArb = fc
    .string({ minLength: 1 })
    .filter((s) => s.trim().length > 0);

  test.prop([nonWhitespaceArb], { numRuns: 100 })(
    'constructing AirtableClient with a non-whitespace token does NOT throw',
    (validToken) => {
      expect(() => {
        new AirtableClient({
          token: validToken,
          baseId: 'appTEST123',
          rateLimiter: mockRateLimiter,
        });
      }).not.toThrow();
    },
  );
});

// ============================================================
// Property 2: Pagination completeness
// **Validates: Requirements 2.5**
//
// For any sequence of paginated Airtable responses (N pages, each
// containing 1–100 records with offset tokens linking pages), the
// total records returned by fetchAll() SHALL equal the sum of records
// across all pages, and all records SHALL be present in the returned
// array.
// ============================================================

/** A mock RateLimiter that resolves immediately */
const immediateRateLimiter: RateLimiter = {
  acquire: () => Promise.resolve(),
} as unknown as RateLimiter;

/** Arbitrary to generate a single page of records (1–100 records with unique IDs) */
const recordPageArb = (pageIndex: number) =>
  fc.integer({ min: 1, max: 100 }).chain((count) =>
    fc.array(
      fc.record({
        id: fc.uuid(),
        fields: fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
        }),
      }),
      { minLength: count, maxLength: count },
    ).map((records) =>
      // Ensure unique IDs by prefixing with page index and record index
      records.map((r, i) => ({
        ...r,
        id: `page${pageIndex}_rec${i}_${r.id}`,
      })),
    ),
  );

/** Arbitrary to generate a sequence of 1–10 pages */
const paginatedResponseArb = fc
  .integer({ min: 1, max: 10 })
  .chain((numPages) =>
    fc.tuple(
      ...Array.from({ length: numPages }, (_, i) => recordPageArb(i)),
    ),
  );

describe('Property 2: Pagination completeness', () => {
  test.prop([paginatedResponseArb], { numRuns: 100 })(
    'fetchAll returns all records from all pages in order',
    async (pages) => {
      // Build mock fetch that returns pages sequentially with offset tokens
      let callIndex = 0;

      const mockFetch = vi.fn(async (url: string | URL | Request) => {
        const currentPage = callIndex;
        callIndex++;

        const records = pages[currentPage];
        const isLastPage = currentPage === pages.length - 1;

        const responseBody: {
          records: typeof records;
          offset?: string;
        } = {
          records,
        };

        if (!isLastPage) {
          responseBody.offset = `offset_token_${currentPage + 1}`;
        }

        return new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      vi.stubGlobal('fetch', mockFetch);

      try {
        const client = new AirtableClient({
          token: 'valid_token_123',
          baseId: 'appTEST123',
          rateLimiter: immediateRateLimiter,
          timeoutMs: 30_000,
        });

        const result = await client.fetchAll<{ name: string }>('tblTEST123');

        // Total records should equal the sum across all pages
        const expectedTotal = pages.reduce((sum, page) => sum + page.length, 0);
        expect(result.length).toBe(expectedTotal);

        // All records should be present in order
        const expectedRecords: AirtableRecord<{ name: string }>[] = pages.flat();
        expect(result).toEqual(expectedRecords);

        // fetch should have been called once per page
        expect(mockFetch).toHaveBeenCalledTimes(pages.length);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});
