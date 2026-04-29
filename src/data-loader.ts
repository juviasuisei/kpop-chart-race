/**
 * Data_Loader — fetches, validates, and combines JSON data files into a DataStore.
 *
 * Each JSON file is a single ArtistEntry. A manifest file (index.json) lists
 * all filenames to load. Invalid entries are skipped with warnings; unparseable
 * files are logged as errors. Unknown ChartSource values trigger a warning but
 * the entry is still included.
 */

import type { ArtistEntry, ArtistType, DailyValueEntry, ReleaseEntry } from "./types.ts";
import type {
  DataStore,
  ParsedArtist,
  ParsedRelease,
  ParsedEmbedDateEntry,
} from "./models.ts";

/** The set of valid ArtistType values */
const VALID_ARTIST_TYPES: ReadonlySet<string> = new Set<ArtistType>([
  "boy_group",
  "girl_group",
  "solo_male",
  "solo_female",
  "mixed_group",
]);

/** Known ChartSource values that have logos */
const KNOWN_CHART_SOURCES: ReadonlySet<string> = new Set([
  "inkigayo",
  "the_show",
  "show_champion",
  "music_bank",
  "m_countdown",
  "show_music_core",
]);

/**
 * Slugify a string: lowercase, replace non-alphanumeric runs with hyphens,
 * trim leading/trailing hyphens.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Validate an ArtistEntry parsed from JSON.
 * Returns null if the entry is invalid (with console warnings).
 * Logs warnings for unknown ChartSource values but still returns the entry.
 */
export function validateArtistEntry(
  entry: ArtistEntry,
  filename: string,
): boolean {
  // Required fields
  if (!entry.name || typeof entry.name !== "string") {
    console.warn(`[Data_Loader] Skipping "${filename}": missing or invalid "name" field.`);
    return false;
  }

  if (!entry.artistType || typeof entry.artistType !== "string") {
    console.warn(`[Data_Loader] Skipping "${filename}": missing "artistType" field.`);
    return false;
  }

  if (!VALID_ARTIST_TYPES.has(entry.artistType)) {
    console.warn(
      `[Data_Loader] Skipping "${filename}": invalid artistType "${entry.artistType}".`,
    );
    return false;
  }

  if (entry.generation == null || typeof entry.generation !== "number") {
    console.warn(`[Data_Loader] Skipping "${filename}": missing "generation" field.`);
    return false;
  }

  if (!Number.isInteger(entry.generation) || entry.generation < 1) {
    console.warn(
      `[Data_Loader] Skipping "${filename}": generation must be a positive integer, got ${entry.generation}.`,
    );
    return false;
  }

  // Must have at least one release with daily values
  if (!Array.isArray(entry.releases) || entry.releases.length === 0) {
    console.warn(`[Data_Loader] Skipping "${filename}": no releases found.`);
    return false;
  }

  const hasReleasesWithDailyValues = entry.releases.some(
    (r) => r.dailyValues && Object.keys(r.dailyValues).length > 0,
  );
  if (!hasReleasesWithDailyValues) {
    console.warn(
      `[Data_Loader] Skipping "${filename}": no releases with daily values.`,
    );
    return false;
  }

  // Warn about unknown chart sources (but don't skip)
  for (const release of entry.releases) {
    if (!release.dailyValues) continue;
    for (const [date, dv] of Object.entries(release.dailyValues)) {
      const dvEntry = dv as DailyValueEntry;
      if (dvEntry.source && !KNOWN_CHART_SOURCES.has(dvEntry.source)) {
        console.warn(
          `[Data_Loader] Unknown ChartSource "${dvEntry.source}" in "${filename}" release "${release.title}" on ${date}.`,
        );
      }
    }
  }

  return true;
}

/**
 * Convert a validated ArtistEntry into a ParsedArtist with slugified ids
 * and Map-based lookups.
 */
export function toParseArtist(entry: ArtistEntry, filename: string): ParsedArtist {
  const artistId = slugify(entry.name);
  const slug = filename.replace(/\.json$/i, "");

  const releases: ParsedRelease[] = entry.releases.map((rel: ReleaseEntry) => {
    const dailyValues = new Map<string, DailyValueEntry>();
    for (const [date, dv] of Object.entries(rel.dailyValues ?? {})) {
      dailyValues.set(date, dv);
    }

    const embeds = new Map<string, ParsedEmbedDateEntry[]>();
    for (const [date, entries] of Object.entries(rel.embeds ?? {})) {
      const parsed: ParsedEmbedDateEntry[] = (entries as Array<{ type: string; url: string }>).map(
        (e) => ({
          type: e.type as ParsedEmbedDateEntry["type"],
          url: e.url,
        }),
      );
      embeds.set(date, parsed);
    }

    return {
      id: slugify(rel.title),
      title: rel.title,
      dailyValues,
      embeds,
    };
  });

  return {
    id: artistId,
    name: entry.name,
    artistType: entry.artistType,
    generation: entry.generation,
    logoUrl: `assets/logos/${slug}.svg`,
    koreanName: entry.korean_name || undefined,
    debut: entry.debut || undefined,
    releases,
  };
}

/**
 * Collect all unique dates across all artists and releases, sorted ascending.
 */
function collectSortedDates(artists: Map<string, ParsedArtist>): string[] {
  const dateSet = new Set<string>();
  for (const artist of artists.values()) {
    for (const release of artist.releases) {
      for (const date of release.dailyValues.keys()) {
        dateSet.add(date);
      }
    }
  }
  return Array.from(dateSet).sort();
}

/**
 * Load all artist data from JSON files listed in the manifest (index.json).
 *
 * @param basePath - The base URL path to the data folder (e.g. "data" or "/data")
 * @returns A fully populated DataStore
 */
export async function loadAll(
  basePath: string,
  onProgress?: (loaded: number, total: number, artistName: string) => void,
): Promise<DataStore> {
  // Fetch the manifest listing all JSON filenames
  let filenames: string[];
  try {
    const manifestResponse = await fetch(`${basePath}/index.json`);
    if (!manifestResponse.ok) {
      throw new Error(`HTTP ${manifestResponse.status}`);
    }
    filenames = (await manifestResponse.json()) as string[];
    // Shuffle filenames so loading order is randomized
    for (let i = filenames.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filenames[i], filenames[j]] = [filenames[j], filenames[i]];
    }
  } catch (err) {
    console.error(
      `[Data_Loader] Failed to load manifest at "${basePath}/index.json":`,
      err,
    );
    return emptyDataStore();
  }

  const artists = new Map<string, ParsedArtist>();

  for (const filename of filenames) {
    const url = `${basePath}/${filename}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`[Data_Loader] Failed to fetch "${url}": HTTP ${response.status}`);
        continue;
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch (parseErr) {
        console.error(`[Data_Loader] Invalid JSON in "${filename}":`, parseErr);
        continue;
      }

      const entry = raw as ArtistEntry;

      if (!validateArtistEntry(entry, filename)) {
        continue;
      }

      const parsed = toParseArtist(entry, filename);
      artists.set(parsed.id, parsed);

      if (onProgress) {
        onProgress(artists.size, filenames.length, parsed.name);
      }
    } catch (err) {
      console.error(`[Data_Loader] Error loading "${filename}":`, err);
      continue;
    }
  }

  const dates = collectSortedDates(artists);

  return {
    artists,
    dates,
    startDate: dates[0] ?? "",
    endDate: dates[dates.length - 1] ?? "",
    chartWins: new Map(),
  };
}

/**
 * Serialize an ArtistEntry to a pretty-printed JSON string.
 */
export function serialize(artist: ArtistEntry): string {
  return JSON.stringify(artist, null, 2);
}

/**
 * Deserialize a JSON string back into an ArtistEntry.
 */
export function deserialize(json: string): ArtistEntry {
  return JSON.parse(json) as ArtistEntry;
}

/** Create an empty DataStore (used when manifest fails or no valid entries). */
function emptyDataStore(): DataStore {
  return {
    artists: new Map(),
    dates: [],
    startDate: "",
    endDate: "",
    chartWins: new Map(),
  };
}
