# Requirements Document

## Introduction

Replace the existing static JSON file-based data loading with runtime Airtable API calls. The application currently loads individual JSON files per artist from `public/data/`, each containing artist metadata and nested releases with `dailyValues` and `embeds`. The new system fetches from 4 Airtable tables (Artists, Releases, Rankings, Episodes), joins them at runtime, and produces the same `DataStore` interface that the existing rendering code expects. This enables live data updates without requiring a rebuild and redeploy cycle.

## Glossary

- **Airtable_Client**: The module responsible for authenticating with and making HTTP requests to the Airtable REST API using the `airtable` npm package (v0.12.2)
- **Data_Adapter**: The module responsible for transforming raw Airtable records into the existing `DataStore` interface consumed by the rendering code
- **DataStore**: The central runtime data structure containing all parsed artists, releases, dates, and chart wins (defined in `src/models.ts`)
- **Cache_Manager**: The module responsible for storing and retrieving fetched Airtable data in browser storage to avoid redundant API calls
- **Rate_Limiter**: The mechanism that ensures API requests do not exceed Airtable's 5 requests per second per base limit
- **PAT**: Personal Access Token — a read-only Airtable credential injected at build time via `VITE_AIRTABLE_API_TOKEN`
- **Record**: A single row in an Airtable table, identified by a unique record ID
- **Linked_Record**: An Airtable field that references one or more Records in another table by record ID
- **ChartSource**: A snake_case identifier for a Korean music show (e.g., `inkigayo`, `m_countdown`)
- **Show_Name_Map**: A lookup table that converts Airtable show display names (e.g., "M Countdown") to ChartSource strings (e.g., `m_countdown`)

## Requirements

### Requirement 1: Airtable Authentication

**User Story:** As a developer, I want the application to authenticate with Airtable using a build-time injected token, so that data can be fetched securely without exposing credentials in source code.

#### Acceptance Criteria

1. THE Airtable_Client SHALL authenticate using the value of the `VITE_AIRTABLE_API_TOKEN` environment variable (accessed via `import.meta.env.VITE_AIRTABLE_API_TOKEN`) as a read-only Personal Access Token
2. IF the `VITE_AIRTABLE_API_TOKEN` environment variable is undefined, empty, or contains only whitespace, THEN THE Airtable_Client SHALL throw an error indicating the token is missing at module initialization before any API requests are attempted
3. THE Airtable_Client SHALL connect to the Airtable base with ID `appIMO72GWmTyfeik`

### Requirement 2: Table Fetching with Pagination

**User Story:** As a developer, I want the system to fetch all records from the 4 Airtable tables handling pagination, so that datasets larger than 100 records are fully retrieved.

#### Acceptance Criteria

1. THE Airtable_Client SHALL fetch all records from the Artists table (ID `tbloWz7REcAe4TM7V`)
2. THE Airtable_Client SHALL fetch all records from the Releases table (ID `tbl1LNqB2Aqsra6Jd`)
3. THE Airtable_Client SHALL fetch all records from the Episodes table (ID `tblcWb6XwuZnw6pNk`)
4. THE Airtable_Client SHALL fetch all records from the Rankings table (ID `tblqtNRBa5FEkJX8T`)
5. WHEN an Airtable response contains an offset token, THE Airtable_Client SHALL request the next page of records using that offset token until all pages are retrieved
6. THE Airtable_Client SHALL request 100 records per page (the Airtable API maximum)
7. THE Airtable_Client SHALL fetch tables sequentially (one table at a time) to stay within rate limits

### Requirement 3: Rate Limiting

**User Story:** As a developer, I want API requests to be throttled, so that the application does not exceed Airtable's rate limit and receive 429 errors.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL ensure no more than 5 requests are sent per second to the Airtable API
2. WHEN 5 requests have been sent within the current 1-second window, THE Rate_Limiter SHALL delay subsequent requests until the next 1-second window begins
3. IF the Airtable API returns a 429 (Too Many Requests) response, THEN THE Airtable_Client SHALL retry the request using exponential backoff with delays of 3 seconds, 5 seconds, and 10 seconds for the first, second, and third retries respectively
4. THE Airtable_Client SHALL retry a 429 response a maximum of 3 times before throwing an error

### Requirement 4: Artist Record Mapping

**User Story:** As a developer, I want Airtable Artist records mapped to `ParsedArtist` objects, so that the rendering code receives the same data shape it expects.

#### Acceptance Criteria

1. THE Data_Adapter SHALL map the Artist `Full Name` formula field to the `ParsedArtist.name` property
2. WHEN the Artist `Native Name` field contains a non-empty string value, THE Data_Adapter SHALL map it to the `ParsedArtist.koreanName` property. WHEN the `Native Name` field is empty or absent, THE Data_Adapter SHALL set `ParsedArtist.koreanName` to undefined
3. THE Data_Adapter SHALL map the Artist `Type` field to the `ParsedArtist.artistType` property by converting the display value to snake_case using these mappings: "Boy Group" becomes `boy_group`, "Girl Group" becomes `girl_group`, "Solo Male" becomes `solo_male`, "Solo Female" becomes `solo_female`, "Mixed Group" becomes `mixed_group`
4. THE Data_Adapter SHALL map the Artist `Gen` field to the `ParsedArtist.generation` property by parsing the string value to a positive integer (e.g., "5" becomes `5`)
5. WHEN the Artist `Debut` field contains a non-empty string, THE Data_Adapter SHALL map it to the `ParsedArtist.debut` property as an ISO 8601 date string (YYYY-MM-DD format). WHEN the `Debut` field is empty or absent, THE Data_Adapter SHALL set `ParsedArtist.debut` to undefined
6. THE Data_Adapter SHALL derive the `ParsedArtist.logoUrl` from the Artist `logo_name` formula field using the pattern `assets/logos/{logo_name}.svg`
7. THE Data_Adapter SHALL use the Artist `logo_name` formula field directly as the `ParsedArtist.id` value (it is already a unique, slugified identifier)
8. IF the Artist `Type` field contains a value not matching any of the 5 defined mappings, THEN THE Data_Adapter SHALL skip that Artist record and log a console warning indicating the unrecognized type value
9. IF the Artist `Gen` field is empty, absent, or not parseable as a positive integer, THEN THE Data_Adapter SHALL skip that Artist record and log a console warning indicating the invalid generation value

### Requirement 5: Release Record Mapping

**User Story:** As a developer, I want Airtable Release records mapped to `ParsedRelease` objects and associated with their linked artists, so that multi-artist releases are properly represented.

#### Acceptance Criteria

1. THE Data_Adapter SHALL map the Release `Name` field to the `ParsedRelease.title` property
2. THE Data_Adapter SHALL derive the `ParsedRelease.id` by slugifying the Release `Name` field using the same slugify logic as the existing data loader (lowercase, replace non-alphanumeric runs with hyphens, trim leading/trailing hyphens)
3. THE Data_Adapter SHALL include a `ParsedRelease` in the `releases` array of each `ParsedArtist` linked to that Release, such that a Release linking to N Artists produces N independent `ParsedRelease` instances with identical `dailyValues` and `embeds` content
4. WHEN a Release links to multiple Artists, THE Data_Adapter SHALL populate the `dailyValues` Map in each linked Artist's copy of the `ParsedRelease` with the same set of Ranking-derived entries (date key, value, source, and episode)
5. IF a Release record links to zero Artists, THEN THE Data_Adapter SHALL skip that Release with a console warning indicating the Release Name and the reason it was excluded

### Requirement 6: Ranking and Episode Mapping to DailyValues

**User Story:** As a developer, I want Rankings and Episodes joined and mapped to `dailyValues` entries, so that chart scores appear correctly in the timeline.

#### Acceptance Criteria

1. THE Data_Adapter SHALL map the Ranking `Score` field to `DailyValueEntry.value`
2. THE Data_Adapter SHALL map the linked Episode `Date` field to the date key in the release's `dailyValues` map
3. THE Data_Adapter SHALL map the linked Episode `Show` field to `DailyValueEntry.source` using the Show_Name_Map (e.g., "The Show" becomes `the_show`, "M Countdown" becomes `m_countdown`, "Show! Music Core" becomes `show_music_core`)
4. THE Data_Adapter SHALL map the linked Episode `Episode` number field to `DailyValueEntry.episode`
5. IF a Ranking record has no linked Episode, THEN THE Data_Adapter SHALL skip that Ranking with a console warning
6. IF a Ranking record has no linked Release, THEN THE Data_Adapter SHALL skip that Ranking with a console warning

### Requirement 7: Embed Generation

**User Story:** As a developer, I want embed entries generated from Release and Ranking data, so that media links appear on the correct dates in the timeline.

#### Acceptance Criteria

1. WHEN a Release has a `Date` field and an `Apple Music` URL, THE Data_Adapter SHALL create a `release_date` embed entry keyed by the Release Date with the `url` property set to the Release `Apple Music` URL value
2. WHEN a Release has a `Date` field and an `MV` URL, THE Data_Adapter SHALL create an `mv` embed entry keyed by the Release Date with the `url` property set to the Release `MV` URL value
3. WHEN a Ranking has a `Performance` URL and its linked Episode has a `Date` field, THE Data_Adapter SHALL create a `live_performance` embed entry keyed by the linked Episode Date with the `url` property set to the Ranking `Performance` URL value
4. THE Data_Adapter SHALL only produce embeds of types `release_date`, `mv`, and `live_performance`
5. WHEN multiple embeds share the same date for a release, THE Data_Adapter SHALL group them into a single array under that date key ordered by type: `release_date` first, then `mv`, then `live_performance`
6. IF a Ranking has a `Performance` URL but its linked Episode has no `Date` field, THEN THE Data_Adapter SHALL skip that embed with a console warning identifying the Ranking record

### Requirement 8: DataStore Assembly

**User Story:** As a developer, I want the final DataStore assembled from all mapped data, so that the rendering code can consume it without modification.

#### Acceptance Criteria

1. THE Data_Adapter SHALL produce a `DataStore` with an `artists` Map keyed by artist ID (the slugified artist name: lowercased, non-alphanumeric runs replaced with hyphens, leading/trailing hyphens trimmed) containing all `ParsedArtist` objects that passed validation and have at least one release with at least one `dailyValues` entry
2. THE Data_Adapter SHALL produce a sorted `dates` array containing all unique date strings (in YYYY-MM-DD format) across all releases' `dailyValues` from all included artists, ordered by lexicographic ascending sort
3. IF the `dates` array is non-empty, THEN THE Data_Adapter SHALL set `startDate` to the first element and `endDate` to the last element of the `dates` array
4. IF the `dates` array is empty, THEN THE Data_Adapter SHALL set `startDate` and `endDate` to empty strings
5. THE Data_Adapter SHALL compute a `firstAppearance` Map keyed by artist ID where each value is the lexicographically earliest date string across all of that artist's releases' `dailyValues` keys
6. IF an artist has zero releases containing at least one `dailyValues` entry, THEN THE Data_Adapter SHALL exclude that artist from the `artists` Map
7. THE Data_Adapter SHALL initialize `chartWins` as an empty Map (computed downstream by `computeChartWins`)

### Requirement 9: Client-Side Caching

**User Story:** As a user, I want fetched data cached in my browser, so that repeat visits do not re-fetch all data from the API.

#### Acceptance Criteria

1. WHEN Airtable data is successfully fetched and assembled, THE Cache_Manager SHALL serialize the DataStore (converting all Map instances to arrays of key-value pairs) and store the result in `sessionStorage` under a key that includes a cache version identifier
2. WHEN the application starts, THE Cache_Manager SHALL check `sessionStorage` for an entry whose key matches the current cache version identifier, whose stored data deserializes into a structurally complete DataStore (containing a non-empty `artists` collection and a non-empty `dates` array), and whose stored timestamp is less than 1 hour old
3. WHEN a valid and non-expired cache entry exists, THE Cache_Manager SHALL deserialize and return the cached DataStore (restoring all Map instances from their key-value pair arrays) without making API calls
7. THE Cache_Manager SHALL store a timestamp alongside the serialized DataStore and SHALL treat any cache entry older than 1 hour as expired, clearing it and fetching fresh data from the API
8. IF the current page URL contains the query parameter `nocache`, THEN THE Cache_Manager SHALL skip reading from cache and fetch fresh data from the API (the fetched data SHALL still be written to cache for subsequent loads without the parameter)
4. THE Cache_Manager SHALL include a cache version identifier in the storage key formatted as a constant string that is updated whenever the DataStore schema or serialization format changes, so that schema changes invalidate old caches automatically
5. IF the cached data fails to deserialize, is missing required fields, or cannot be restored to a valid DataStore, THEN THE Cache_Manager SHALL clear the invalid entry from `sessionStorage` and fetch fresh data from the API
6. IF storing the serialized DataStore in `sessionStorage` throws a QuotaExceededError, THEN THE Cache_Manager SHALL catch the error, clear any partial cache entry, and continue operation without caching (the application SHALL still function normally with freshly fetched data)

### Requirement 10: Loading Progress Reporting

**User Story:** As a user, I want to see loading progress while data is fetched from Airtable, so that I know the application is working.

#### Acceptance Criteria

1. WHEN the Airtable_Client completes fetching a table, THE Data_Adapter SHALL invoke the `onProgress` callback with the number of tables fetched so far as `loaded`, the total number of artists (once known) as `total`, and the completed table's name (one of "Artists", "Releases", "Episodes", "Rankings") as `name`
2. THE Data_Adapter SHALL accept an optional `onProgress` callback with the signature `(loaded: number, total: number, name: string) => void`
3. DURING the assembly phase, THE Data_Adapter SHALL invoke the `onProgress` callback once per artist assembled, with the count of artists assembled so far as `loaded`, the total number of artists as `total`, and the artist's name as `name`
4. WHEN loading from cache, THE Data_Adapter SHALL invoke the `onProgress` callback once with `loaded` equal to `total` and `name` as "Cache"
5. THE per-artist progress during assembly SHALL drive the same loading screen progress bar that the existing JSON loader provides

### Requirement 11: Error Handling

**User Story:** As a user, I want clear error messages when data loading fails, so that I can understand what went wrong.

#### Acceptance Criteria

1. IF the Airtable API returns an HTTP error (4xx or 5xx), THEN THE Airtable_Client SHALL throw an Error whose message includes the numeric HTTP status code and the error message returned by the Airtable API response body
2. IF a network failure occurs during fetching, THEN THE Airtable_Client SHALL throw an Error whose message indicates a network connectivity problem
3. IF an Airtable API request receives no response within 30 seconds, THEN THE Airtable_Client SHALL abort the request and throw an Error indicating the request timed out
4. IF the fetched data produces zero valid artists (artists with at least one release containing dailyValues), THEN THE Data_Adapter SHALL throw an Error indicating no chart data is available
5. THE Data_Adapter SHALL propagate all errors thrown by the Airtable_Client or internal processing as rejected promises to the caller, enabling the caller to pass an appropriate display string to `loadingScreen.onError(message: string)`

### Requirement 12: Environment Configuration for CI/CD

**User Story:** As a developer, I want the Airtable token injected during the GitHub Actions build, so that the deployed app can access the API without storing secrets in the repository.

#### Acceptance Criteria

1. THE build pipeline SHALL pass the `API_AIRTABLE_TOKEN` secret from the `github-pages` GitHub Actions environment as the `VITE_AIRTABLE_API_TOKEN` environment variable during the `npm run build` step
2. WHEN the application is built with a non-empty `VITE_AIRTABLE_API_TOKEN` environment variable, THE bundled output SHALL contain the token value inlined by Vite's `import.meta.env` replacement
3. IF the `VITE_AIRTABLE_API_TOKEN` environment variable is empty or undefined at build time, THEN THE build pipeline SHALL fail the workflow run before the deploy step executes
4. THE repository SHALL NOT contain the Airtable token value in any committed file, including `.env` files, source code, or workflow definitions

### Requirement 13: Backward-Compatible Integration

**User Story:** As a developer, I want the new Airtable data layer to replace the existing `loadAll` function seamlessly, so that no rendering code requires changes.

#### Acceptance Criteria

1. THE Data_Adapter SHALL export a function that accepts an optional `onProgress` callback of type `(loaded: number, total: number, name: string) => void`, and returns a `Promise<DataStore>`
2. THE Data_Adapter SHALL produce `ParsedArtist`, `ParsedRelease`, and `ParsedEmbedDateEntry` objects whose properties match the names, types, and collection kinds defined in `models.ts`, including `Map<string, DailyValueEntry>` for `dailyValues`, `Map<string, ParsedEmbedDateEntry[]>` for `embeds`, and `Map<string, string>` for `firstAppearance`
3. WHEN the `main.ts` entry point calls the new data loading function, THE application SHALL produce the same `DataStore.dates` array, the same cumulative values per artist, and the same chart rankings as the JSON-based version given source data with identical artist entries and daily values

### Requirement 14: Show Name Mapping

**User Story:** As a developer, I want Airtable show display names converted to ChartSource strings, so that the rendering code can match shows to their logos and labels.

#### Acceptance Criteria

1. THE Show_Name_Map SHALL map "The Show" to `the_show`
2. THE Show_Name_Map SHALL map "Show Champion" to `show_champion`
3. THE Show_Name_Map SHALL map "M Countdown" to `m_countdown`
4. THE Show_Name_Map SHALL map "Music Bank" to `music_bank`
5. THE Show_Name_Map SHALL map "Show! Music Core" to `show_music_core`
6. THE Show_Name_Map SHALL map "Inkigayo" to `inkigayo`
7. IF an Episode contains a Show value not present in the Show_Name_Map, THEN THE Data_Adapter SHALL log a warning and use the lowercased value with spaces and non-alphanumeric characters replaced by underscores as a fallback

### Requirement 15: Data Adapter Round-Trip Equivalence

**User Story:** As a developer, I want confidence that the Airtable adapter produces identical output to the JSON loader for the same underlying data, so that I can verify correctness.

#### Acceptance Criteria

1. WHEN a set of Airtable records (Artists, Releases, Rankings, Episodes) represents the same logical data as a valid JSON `ArtistEntry` file, THE Data_Adapter SHALL produce a `ParsedArtist` whose `id`, `name`, `koreanName`, `artistType`, `generation`, `debut`, `logoUrl`, and `releases` array are value-equal to those produced by the JSON-based `toParseArtist` function for that equivalent file
2. THE Data_Adapter SHALL produce `dailyValues` Map entries where, for each date key, the `value` (numeric equality), `source` (string equality after Show_Name_Map conversion), and `episode` (integer equality) fields match the corresponding `DailyValueEntry` that the JSON loader would produce from the same underlying data
3. THE Data_Adapter SHALL produce `embeds` Map entries where, for each date key, the array contains entries with the same `type` and `url` string values as the JSON loader would produce, regardless of array ordering within a single date key
4. THE Data_Adapter SHALL treat an empty-string or null `Native Name` field from Airtable as `undefined` for `koreanName`, and an empty-string or null `Debut` field as `undefined` for `debut`, matching the JSON loader behavior of converting falsy values to `undefined`
5. WHEN a Release links to Rankings from multiple Episodes, THE Data_Adapter SHALL produce the same number of `dailyValues` entries as the equivalent JSON file contains date keys for that release
