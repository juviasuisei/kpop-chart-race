/**
 * Data_Adapter — orchestrates fetching, joining, and assembling the DataStore
 * from Airtable. Drop-in replacement for the old loadAll() function.
 */

import type { ArtistType, DailyValueEntry } from "../types";
import type {
  DataStore,
  ParsedArtist,
  ParsedEmbedDateEntry,
  ParsedRelease,
} from "../models";
import type { AirtableRecord } from "./airtable-client";
import { AirtableClient } from "./airtable-client";
import { RateLimiter } from "./rate-limiter";
import { CacheManager } from "./cache-manager";
import { toChartSource } from "./show-name-map";
import { fillMissingScores } from "./score-fill";

// --- Constants ---

const BASE_ID = "appIMO72GWmTyfeik";
const TABLE_IDS = {
  Artists: "tbloWz7REcAe4TM7V",
  Releases: "tbl1LNqB2Aqsra6Jd",
  Episodes: "tblcWb6XwuZnw6pNk",
  Rankings: "tblqtNRBa5FEkJX8T",
} as const;

const ARTIST_TYPE_MAP: Record<string, ArtistType> = {
  "Boy Group": "boy_group",
  "Girl Group": "girl_group",
  "Solo Male": "solo_male",
  "Solo Female": "solo_female",
  "Mixed Group": "mixed_group",
  "Solo Non-Binary": "solo_non_binary",
};

// --- Types ---

export type ProgressCallback = (loaded: number, total: number, name: string) => void;

/** Airtable Artist record fields */
interface ArtistFields {
  "Full Name"?: string;
  "Native Name"?: string;
  "Type"?: string;
  "Gen"?: string;
  "Debut"?: string;
  "logo_name"?: string;
  "Releases"?: string[];
}

/** Airtable Release record fields */
interface ReleaseFields {
  "Name"?: string;
  "Artist"?: string[];
  "Date"?: string;
  "Apple Music"?: string;
  "MV"?: string;
  "Rankings"?: string[];
  "Is Single"?: boolean;
}

/** Airtable Episode record fields */
interface EpisodeFields {
  "Date"?: string;
  "Show"?: string;
  "Episode"?: number;
}

/** Airtable Ranking record fields */
interface RankingFields {
  "Score"?: number;
  "Release"?: string[];
  "Episode"?: string[];
  "Performance"?: string;
}

// --- Helpers ---

/**
 * Slugify a string: lowercase, replace non-alphanumeric runs with hyphens,
 * trim leading/trailing hyphens.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- Main Export ---

/**
 * Orchestrates fetching, joining, and assembling the DataStore from Airtable.
 * Drop-in replacement for the old loadAll() function.
 */
export async function loadFromAirtable(
  onProgress?: ProgressCallback,
  onArtistNames?: (names: string[]) => void,
): Promise<DataStore> {
  const cache = new CacheManager();

  // Check cache first (unless bypassed)
  if (!cache.shouldBypass()) {
    const cached = cache.get();
    if (cached) {
      const totalArtists = cached.artists.size;
      if (onProgress) {
        onProgress(totalArtists, totalArtists, "Cache");
      }
      if (onArtistNames) {
        onArtistNames(Array.from(cached.artists.values()).map(a => a.name));
      }
      return cached;
    }
  }

  // Fetch from Airtable
  const token = import.meta.env.VITE_AIRTABLE_API_TOKEN as string;
  const rateLimiter = new RateLimiter();
  const client = new AirtableClient({ token, baseId: BASE_ID, rateLimiter });

  // Fetch all 4 tables sequentially
  const artistRecords = await client.fetchAll<ArtistFields>(TABLE_IDS.Artists);
  if (onProgress) {
    onProgress(1, artistRecords.length, "Artists");
  }

  // Notify caller of artist names for loading animation
  if (onArtistNames) {
    const names = artistRecords
      .map(r => r.fields["Full Name"])
      .filter((n): n is string => !!n);
    onArtistNames(names);
  }

  const releaseRecords = await client.fetchAll<ReleaseFields>(TABLE_IDS.Releases);
  if (onProgress) {
    onProgress(2, artistRecords.length, "Releases");
  }

  const episodeRecords = await client.fetchAll<EpisodeFields>(TABLE_IDS.Episodes);
  if (onProgress) {
    onProgress(3, artistRecords.length, "Episodes");
  }

  const rankingRecords = await client.fetchAll<RankingFields>(TABLE_IDS.Rankings);
  if (onProgress) {
    onProgress(4, artistRecords.length, "Rankings");
  }

  // Assemble the DataStore
  const dataStore = assembleDataStore(
    artistRecords,
    releaseRecords,
    episodeRecords,
    rankingRecords,
    onProgress,
  );

  // Write cache
  cache.set(dataStore);

  return dataStore;
}

// --- Assembly Logic ---

/**
 * Joins all records and assembles the final DataStore.
 */
function assembleDataStore(
  artistRecords: AirtableRecord<ArtistFields>[],
  releaseRecords: AirtableRecord<ReleaseFields>[],
  episodeRecords: AirtableRecord<EpisodeFields>[],
  rankingRecords: AirtableRecord<RankingFields>[],
  onProgress?: ProgressCallback,
): DataStore {
  // Build lookup maps
  const episodeMap = new Map<string, AirtableRecord<EpisodeFields>>();
  for (const ep of episodeRecords) {
    episodeMap.set(ep.id, ep);
  }

  const releaseMap = new Map<string, AirtableRecord<ReleaseFields>>();
  for (const rel of releaseRecords) {
    releaseMap.set(rel.id, rel);
  }

  // Group rankings by release ID
  const rankingsByRelease = new Map<string, AirtableRecord<RankingFields>[]>();
  for (const ranking of rankingRecords) {
    const releaseLinks = ranking.fields["Release"];
    if (!releaseLinks || releaseLinks.length === 0) {
      console.warn(
        `[Data_Adapter] Skipping ranking "${ranking.id}": no linked Release.`,
      );
      continue;
    }

    const episodeLinks = ranking.fields["Episode"];
    if (!episodeLinks || episodeLinks.length === 0) {
      console.warn(
        `[Data_Adapter] Skipping ranking "${ranking.id}": no linked Episode.`,
      );
      continue;
    }

    const releaseId = releaseLinks[0];
    const existing = rankingsByRelease.get(releaseId);
    if (existing) {
      existing.push(ranking);
    } else {
      rankingsByRelease.set(releaseId, [ranking]);
    }
  }

  // Map valid artists
  const validArtists = new Map<string, { record: AirtableRecord<ArtistFields>; artistId: string }>();

  for (const artistRecord of artistRecords) {
    const fields = artistRecord.fields;
    const logoName = fields["logo_name"];
    const typeValue = fields["Type"];
    const genValue = fields["Gen"];

    if (!logoName) {
      console.warn(
        `[Data_Adapter] Skipping artist "${fields["Full Name"] ?? artistRecord.id}": missing logo_name.`,
      );
      continue;
    }

    if (!typeValue || !(typeValue in ARTIST_TYPE_MAP)) {
      console.warn(
        `[Data_Adapter] Skipping artist "${fields["Full Name"] ?? logoName}": invalid artist type "${typeValue ?? ""}".`,
      );
      continue;
    }

    if (!genValue) {
      console.warn(
        `[Data_Adapter] Skipping artist "${fields["Full Name"] ?? logoName}": invalid generation value (empty).`,
      );
      continue;
    }

    const generation = parseInt(genValue, 10);
    if (!Number.isFinite(generation) || generation < 1) {
      console.warn(
        `[Data_Adapter] Skipping artist "${fields["Full Name"] ?? logoName}": invalid generation value "${genValue}".`,
      );
      continue;
    }

    validArtists.set(artistRecord.id, { record: artistRecord, artistId: logoName });
  }

  // Build releases per artist with dailyValues and embeds
  // Structure: artistRecordId → ParsedRelease[]
  const releasesPerArtist = new Map<string, ParsedRelease[]>();

  // Album releases per artist (Apple Music URLs extracted separately)
  // Structure: artistRecordId → AlbumRelease[]
  const albumReleasesPerArtist = new Map<string, Array<{ date: string; appleMusicUrl: string; isSingle: boolean; artistIds: string[] }>>();

  for (const releaseRecord of releaseRecords) {
    const fields = releaseRecord.fields;
    const releaseName = fields["Name"];
    const artistLinks = fields["Artist"];
    const releaseDate = fields["Date"];
    const appleMusicUrl = fields["Apple Music"];

    if (!artistLinks || artistLinks.length === 0) {
      console.warn(
        `[Data_Adapter] Skipping release "${releaseName ?? releaseRecord.id}": links to zero Artists.`,
      );
      continue;
    }

    // Extract Apple Music URL into albumReleases for all linked artists
    if (releaseDate && appleMusicUrl) {
      const isSingle = fields["Is Single"] === true;
      // Resolve all valid artist slugs for this release
      const resolvedIds: string[] = [];
      for (const rid of artistLinks) {
        const info = validArtists.get(rid);
        if (info) resolvedIds.push(info.artistId);
      }
      for (const artistRecordId of artistLinks) {
        if (!validArtists.has(artistRecordId)) continue;
        const existing = albumReleasesPerArtist.get(artistRecordId);
        const entry = { date: releaseDate, appleMusicUrl, isSingle, artistIds: resolvedIds };
        if (existing) {
          existing.push(entry);
        } else {
          albumReleasesPerArtist.set(artistRecordId, [entry]);
        }
      }
    }

    // If no Name and no embeddable content, this release only contributes to albumReleases
    const mvUrl = fields["MV"];
    const hasRankings = rankingsByRelease.has(releaseRecord.id);
    if (!releaseName?.trim() && !mvUrl?.trim() && !hasRankings) {
      continue;
    }

    // Build dailyValues for this release from rankings
    const dailyValues = new Map<string, DailyValueEntry>();
    const embeds = new Map<string, ParsedEmbedDateEntry[]>();

    // Add MV embed (Apple Music is now handled separately via albumReleases)
    if (releaseDate && mvUrl?.trim()) {
      addEmbed(embeds, releaseDate, { type: "mv", url: mvUrl.trim() });
    }

    // Process rankings for this release
    const rankings = rankingsByRelease.get(releaseRecord.id) ?? [];
    for (const ranking of rankings) {
      const episodeLinks = ranking.fields["Episode"];
      if (!episodeLinks || episodeLinks.length === 0) {
        continue; // Already warned during grouping
      }

      const episodeId = episodeLinks[0];
      const episode = episodeMap.get(episodeId);
      if (!episode) {
        console.warn(
          `[Data_Adapter] Skipping ranking "${ranking.id}": linked Episode "${episodeId}" not found.`,
        );
        continue;
      }

      const episodeDate = episode.fields["Date"];
      const episodeShow = episode.fields["Show"];
      const episodeNumber = episode.fields["Episode"];

      if (!episodeDate) {
        console.warn(
          `[Data_Adapter] Skipping ranking "${ranking.id}": linked Episode has no Date.`,
        );
        continue;
      }

      // Map ranking to DailyValueEntry
      const score = ranking.fields["Score"];
      if (score != null && episodeShow != null && episodeNumber != null) {
        dailyValues.set(episodeDate, {
          value: score,
          source: toChartSource(episodeShow),
          episode: episodeNumber,
        });
      }

      // Generate live_performance embed
      const performanceUrl = ranking.fields["Performance"];
      if (performanceUrl) {
        addEmbed(embeds, episodeDate, { type: "live_performance", url: performanceUrl });
      }
    }

    // Sort embeds per date by type order
    for (const [date, entries] of embeds) {
      embeds.set(date, sortEmbeds(entries));
    }

    // Skip if release ended up with no content (no chart data and no embeds)
    if (dailyValues.size === 0 && embeds.size === 0) {
      continue;
    }

    // Create a ParsedRelease for each linked artist
    const releaseTitle = releaseName ?? "";
    const releaseId = slugify(releaseTitle || releaseRecord.id);
    // Resolve all valid artist slugs for this release's artistIds
    const resolvedArtistIds: string[] = [];
    for (const rid of artistLinks) {
      const info = validArtists.get(rid);
      if (info) {
        resolvedArtistIds.push(info.artistId);
      }
    }

    for (const artistRecordId of artistLinks) {
      // Only include if the artist is valid
      if (!validArtists.has(artistRecordId)) {
        continue;
      }

      const parsedRelease: ParsedRelease = {
        id: releaseId,
        title: releaseTitle,
        dailyValues: new Map(dailyValues),
        embeds: new Map(embeds.entries()),
        artistIds: resolvedArtistIds.length > 0 ? [...resolvedArtistIds] : [validArtists.get(artistRecordId)!.artistId],
      };

      const existing = releasesPerArtist.get(artistRecordId);
      if (existing) {
        existing.push(parsedRelease);
      } else {
        releasesPerArtist.set(artistRecordId, [parsedRelease]);
      }
    }
  }

  // Assemble ParsedArtist objects
  const artists = new Map<string, ParsedArtist>();
  const totalArtists = validArtists.size;
  let assembledCount = 0;

  for (const [recordId, { record, artistId }] of validArtists) {
    const fields = record.fields;
    const releases = releasesPerArtist.get(recordId) ?? [];

    // Check if artist has at least one release with dailyValues
    const hasData = releases.some((r) => r.dailyValues.size > 0);
    if (!hasData) {
      assembledCount++;
      if (onProgress) {
        onProgress(assembledCount, totalArtists, fields["Full Name"] ?? artistId);
      }
      continue; // Exclude artists with zero dailyValues
    }

    const nativeName = fields["Native Name"];
    const debut = fields["Debut"];

    const parsedArtist: ParsedArtist = {
      id: artistId,
      name: fields["Full Name"] ?? artistId,
      artistType: ARTIST_TYPE_MAP[fields["Type"]!],
      generation: parseInt(fields["Gen"]!, 10),
      logoUrl: `assets/logos/${artistId}.svg`,
      koreanName: nativeName && nativeName.trim() !== "" ? nativeName : undefined,
      debut: debut && debut.trim() !== "" ? debut : undefined,
      releases,
      albumReleases: albumReleasesPerArtist.get(recordId) ?? [],
    };

    artists.set(artistId, parsedArtist);
    assembledCount++;

    if (onProgress) {
      onProgress(assembledCount, totalArtists, parsedArtist.name);
    }
  }

  // Throw if zero valid artists
  if (artists.size === 0) {
    throw new Error("No chart data available: zero valid artists after assembly.");
  }

  // Fill in missing (negative-sentinel) scores for charts that don't publish
  // their full ranking (Music Bank ranks 21–50, M Countdown ranks 2–20). This
  // mutates the sentinel entries in place with deterministic fitted scores.
  fillMissingScores(artists);

  // Collect sorted dates
  const dateSet = new Set<string>();
  for (const artist of artists.values()) {
    for (const release of artist.releases) {
      for (const date of release.dailyValues.keys()) {
        dateSet.add(date);
      }
    }
  }
  const dates = Array.from(dateSet).sort();

  // Compute firstAppearance
  const firstAppearance = new Map<string, string>();
  for (const [artistId, artist] of artists) {
    let earliest: string | undefined;
    for (const release of artist.releases) {
      for (const date of release.dailyValues.keys()) {
        if (!earliest || date < earliest) {
          earliest = date;
        }
      }
    }
    if (earliest) {
      firstAppearance.set(artistId, earliest);
    }
  }

  return {
    artists,
    dates,
    startDate: dates[0] ?? "",
    endDate: dates[dates.length - 1] ?? "",
    firstAppearance,
    chartWins: new Map(),
    releaseWinDates: new Map(),
  };
}

// --- Embed Helpers ---

const EMBED_TYPE_ORDER: Record<string, number> = {
  release_date: 0,
  mv: 1,
  live_performance: 2,
};

function addEmbed(
  embeds: Map<string, ParsedEmbedDateEntry[]>,
  date: string,
  entry: ParsedEmbedDateEntry,
): void {
  const existing = embeds.get(date);
  if (existing) {
    existing.push(entry);
  } else {
    embeds.set(date, [entry]);
  }
}

function sortEmbeds(entries: ParsedEmbedDateEntry[]): ParsedEmbedDateEntry[] {
  return entries.sort((a, b) => {
    const orderA = EMBED_TYPE_ORDER[a.type] ?? 99;
    const orderB = EMBED_TYPE_ORDER[b.type] ?? 99;
    return orderA - orderB;
  });
}
