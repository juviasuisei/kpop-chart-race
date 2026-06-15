# Implementation Plan: Airtable Data Layer

## Overview

Replace the static JSON file-based data loading with runtime Airtable API calls. Implementation follows a bottom-up dependency order: standalone utilities first (rate limiter, show name map, cache manager), then the Airtable client, then the data adapter that orchestrates everything, and finally integration into main.ts with CI/CD changes.

## Tasks

- [x] 1. CI/CD and environment configuration
  - [x] 1.1 Update `.gitignore` to exclude `.env` files and add `VITE_AIRTABLE_API_TOKEN` to deploy workflow
    - Add `.env` and `.env.*` patterns to `.gitignore` to prevent committing secrets
    - Update `.github/workflows/deploy.yml` to inject `VITE_AIRTABLE_API_TOKEN: ${{ secrets.API_AIRTABLE_TOKEN }}` as env var on the `npm run build` step
    - Add a validation step before the build that fails the workflow if `VITE_AIRTABLE_API_TOKEN` is empty or unset
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 2. Implement the rate limiter module
  - [x] 2.1 Create `src/airtable/rate-limiter.ts` with token-bucket implementation
    - Implement `RateLimiter` class with configurable `maxTokens` (default 5) and `refillIntervalMs` (default 1000)
    - `acquire()` returns a Promise that resolves when a token is available
    - Refill tokens at the start of each new window based on elapsed time
    - _Requirements: 3.1, 3.2_

  - [x] 2.2 Write property test for rate limiter throughput constraint
    - **Property 3: Rate limiter throughput constraint**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 2.3 Write unit tests for rate limiter
    - Test that 5 immediate calls resolve without delay
    - Test that the 6th call is delayed until the next window
    - Test custom token count and interval configuration
    - _Requirements: 3.1, 3.2_

- [x] 3. Implement the show name map module
  - [x] 3.1 Create `src/airtable/show-name-map.ts` with static mappings and fallback logic
    - Export `SHOW_NAME_MAP` as a `ReadonlyMap<string, string>` with all 6 show mappings
    - Export `toChartSource(displayName: string): string` that looks up the map and falls back to lowercase with non-alphanumeric replaced by underscores
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

  - [x] 3.2 Write property test for show name fallback format
    - **Property 10: Show name fallback format**
    - **Validates: Requirements 14.7**

  - [x] 3.3 Write unit tests for show name map
    - Test all 6 known mappings return correct ChartSource values
    - Test unknown show name returns lowercased underscore fallback
    - Test edge cases: empty string, special characters, mixed case
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

- [x] 4. Implement the cache manager module
  - [x] 4.1 Create `src/airtable/cache-manager.ts` with sessionStorage serialization and TTL
    - Implement `CacheManager` class with `get()`, `set()`, `shouldBypass()`, and `clear()` methods
    - Serialize DataStore Maps as `[key, value][]` arrays for JSON storage
    - Include version identifier (`"airtable-v1"`) in storage key for schema invalidation
    - Store timestamp alongside data; treat entries older than 1 hour as expired
    - Handle `QuotaExceededError` by clearing partial entries and continuing without cache
    - Check URL for `?nocache` query parameter in `shouldBypass()`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x] 4.2 Write property test for cache TTL expiry
    - **Property 9: Cache TTL expiry**
    - **Validates: Requirements 9.2, 9.7**

  - [x] 4.3 Write unit tests for cache manager
    - Test cache bypass with `?nocache` URL parameter
    - Test cache version mismatch invalidation
    - Test valid cache read/write round-trip
    - Test expired cache is cleared and returns null
    - Test deserialization failure clears invalid entry
    - Test QuotaExceededError is handled gracefully
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement the Airtable client module
  - [x] 6.1 Create `src/airtable/airtable-client.ts` with authentication, pagination, and retry logic
    - Implement `AirtableClient` class accepting `AirtableClientConfig` (token, baseId, rateLimiter, timeoutMs)
    - Validate token at construction time; throw if undefined, empty, or whitespace-only
    - Implement `fetchAll<T>(tableId: string)` that paginates through all pages (100 records/page) using offset tokens
    - Use `AbortController` with 30-second timeout on each fetch request
    - Handle 429 responses with exponential backoff retries (3s, 5s, 10s delays, max 3 retries)
    - Throw descriptive errors for HTTP errors (include status code + API message), network failures, and timeouts
    - Call `rateLimiter.acquire()` before each HTTP request
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.3, 3.4, 11.1, 11.2, 11.3_

  - [x] 6.2 Write property test for whitespace token rejection
    - **Property 1: Whitespace token rejection**
    - **Validates: Requirements 1.2**

  - [x] 6.3 Write property test for pagination completeness
    - **Property 2: Pagination completeness**
    - **Validates: Requirements 2.5**

  - [x] 6.4 Write unit tests for Airtable client
    - Test missing/empty token throws at construction
    - Test successful single-page fetch
    - Test multi-page pagination with offset tokens
    - Test 429 retry with exponential backoff succeeds on retry
    - Test retry exhaustion after 3 attempts throws error
    - Test HTTP error includes status code and message
    - Test network failure error message format
    - Test timeout error behavior (30s abort)
    - _Requirements: 1.1, 1.2, 1.3, 2.5, 2.6, 3.3, 3.4, 11.1, 11.2, 11.3_

- [x] 7. Implement the data adapter module
  - [x] 7.1 Create `src/airtable/data-adapter.ts` with record mapping and DataStore assembly
    - Export `loadFromAirtable(onProgress?: ProgressCallback): Promise<DataStore>`
    - Orchestrate: check cache → fetch 4 tables sequentially → join records → assemble DataStore → write cache
    - Map Artist records to `ParsedArtist` objects using type map, gen parsing, logo_name for id/logoUrl
    - Map Release records to `ParsedRelease` objects, duplicating for multi-artist links
    - Join Rankings → Episodes for dailyValues (date key, score, source via toChartSource, episode number)
    - Generate embeds from Release Date+Apple Music/MV URLs and Ranking Performance URLs
    - Order embeds per date: release_date, mv, live_performance
    - Assemble DataStore: artists Map, sorted dates, startDate/endDate, firstAppearance, empty chartWins
    - Skip invalid records with console warnings (invalid artist type, invalid gen, orphan releases/rankings)
    - Throw error if zero valid artists result
    - Report progress: per-table during fetch, per-artist during assembly, single "Cache" call on cache hit
    - _Requirements: 4.1–4.9, 5.1–5.5, 6.1–6.6, 7.1–7.6, 8.1–8.7, 10.1–10.5, 11.4, 11.5, 13.1, 13.2_

  - [x] 7.2 Write property test for artist record field mapping
    - **Property 4: Artist record field mapping**
    - **Validates: Requirements 4.1, 4.2, 4.4, 4.5, 4.6, 4.7**

  - [x] 7.3 Write property test for multi-artist release duplication
    - **Property 5: Multi-artist release duplication**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

  - [x] 7.4 Write property test for ranking-to-DailyValue mapping
    - **Property 6: Ranking-to-DailyValue mapping**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [x] 7.5 Write property test for embed generation and type ordering
    - **Property 7: Embed generation and type ordering**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

  - [x] 7.6 Write property test for DataStore assembly invariants
    - **Property 8: DataStore assembly invariants**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6**

  - [x] 7.7 Write unit tests for data adapter
    - Test invalid artist type → record skipped with warning
    - Test invalid generation → record skipped with warning
    - Test release with zero linked artists → skipped with warning
    - Test ranking with no linked episode → skipped with warning
    - Test ranking with no linked release → skipped with warning
    - Test embed skipped when episode has no date
    - Test zero valid artists throws error
    - Test progress callback: per-table during fetch phase
    - Test progress callback: single "Cache" call on cache hit
    - Test empty DataStore: startDate/endDate are empty strings
    - _Requirements: 4.8, 4.9, 5.5, 6.5, 6.6, 7.6, 8.4, 10.1, 10.4, 11.4_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Integration and wiring
  - [x] 9.1 Update `src/main.ts` to use `loadFromAirtable` instead of `loadAll`
    - Replace `import { loadAll } from "./data-loader.ts"` with `import { loadFromAirtable } from "./airtable/data-adapter.ts"`
    - Replace the `loadAll("data", ...)` call with `loadFromAirtable((loaded, total, name) => { loadingScreen.onFileProgress(loaded, total, [name]); })`
    - Ensure the error handling path still calls `loadingScreen.onError(message)`
    - Remove the `generate-data-index.js` script from `npm run dev` and `npm run build` in `package.json` (data manifest no longer needed)
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 9.2 Write property test for round-trip equivalence
    - **Property 11: Round-trip equivalence with JSON loader**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5**

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `airtable` npm package is NOT used — the design specifies direct `fetch()` calls to the Airtable REST API
- The existing `data-loader.ts` is kept in the codebase as reference but is no longer imported from `main.ts`
- All modules use TypeScript as specified in the design

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "3.2", "3.3", "4.2", "4.3"] },
    { "id": 2, "tasks": ["6.1"] },
    { "id": 3, "tasks": ["6.2", "6.3", "6.4"] },
    { "id": 4, "tasks": ["7.1"] },
    { "id": 5, "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6", "7.7"] },
    { "id": 6, "tasks": ["9.1"] },
    { "id": 7, "tasks": ["9.2"] }
  ]
}
```
