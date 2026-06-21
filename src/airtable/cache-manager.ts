import type {
  DataStore,
  ParsedArtist,
  ParsedEmbedDateEntry,
  ParsedRelease,
} from "../models";
import type { DailyValueEntry } from "../types";

/**
 * Serialized representation of the DataStore for sessionStorage.
 * Maps are converted to [key, value][] arrays for JSON compatibility.
 */
export interface SerializedDataStore {
  version: string;
  timestamp: number;
  data: {
    artists: [string, SerializedArtist][];
    dates: string[];
    startDate: string;
    endDate: string;
    firstAppearance: [string, string][];
    chartWins: [];
  };
}

interface SerializedArtist {
  id: string;
  name: string;
  artistType: string;
  generation: number;
  logoUrl: string;
  koreanName?: string;
  debut?: string;
  releases: SerializedRelease[];
  albumReleases: Array<{ date: string; appleMusicUrl: string; isSingle: boolean; artistIds: string[] }>;
}

interface SerializedRelease {
  id: string;
  title: string;
  dailyValues: [string, DailyValueEntry][];
  embeds: [string, ParsedEmbedDateEntry[]][];
  artistIds: string[];
}

const STORAGE_KEY = "airtable-v1";
const TTL_MS = 3_600_000; // 1 hour

/**
 * Manages caching of DataStore in sessionStorage with TTL-based expiry
 * and version-based invalidation. Handles serialization of Map instances
 * to JSON-compatible [key, value][] arrays.
 */
export class CacheManager {
  private readonly storageKey: string = STORAGE_KEY;
  private readonly ttlMs: number = TTL_MS;
  private readonly cacheVersion: string = "airtable-v1";

  constructor() {}

  /**
   * Attempt to load a valid, non-expired DataStore from sessionStorage.
   * Returns null if no valid entry exists, the entry is expired, or
   * deserialization fails.
   */
  get(): DataStore | null {
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      if (raw === null) return null;

      const parsed: SerializedDataStore = JSON.parse(raw);

      // Version mismatch invalidation
      if (parsed.version !== this.cacheVersion) {
        this.clear();
        return null;
      }

      // TTL check
      if (Date.now() - parsed.timestamp > this.ttlMs) {
        this.clear();
        return null;
      }

      // Structural validation
      if (
        !parsed.data ||
        !Array.isArray(parsed.data.artists) ||
        parsed.data.artists.length === 0 ||
        !Array.isArray(parsed.data.dates) ||
        parsed.data.dates.length === 0
      ) {
        this.clear();
        return null;
      }

      return this.deserialize(parsed);
    } catch {
      // Deserialization failure: clear invalid entry
      this.clear();
      return null;
    }
  }

  /**
   * Serialize and store a DataStore into sessionStorage.
   * Handles QuotaExceededError by clearing partial entries and
   * continuing without cache.
   */
  set(store: DataStore): void {
    try {
      const serialized: SerializedDataStore = this.serialize(store);
      const json = JSON.stringify(serialized);
      sessionStorage.setItem(this.storageKey, json);
    } catch (error: unknown) {
      // Handle QuotaExceededError gracefully
      if (
        error instanceof DOMException &&
        (error.name === "QuotaExceededError" ||
          error.code === 22)
      ) {
        this.clear();
        return;
      }
      // For any other storage error, also clear and continue
      this.clear();
    }
  }

  /**
   * Check if cache should be bypassed.
   * Returns true if the current URL contains the `nocache` query parameter.
   */
  shouldBypass(): boolean {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.has("nocache");
    } catch {
      return false;
    }
  }

  /** Clear any existing cache entry. */
  clear(): void {
    try {
      sessionStorage.removeItem(this.storageKey);
    } catch {
      // Silently ignore if sessionStorage is unavailable
    }
  }

  private serialize(store: DataStore): SerializedDataStore {
    const artists: [string, SerializedArtist][] = Array.from(
      store.artists.entries(),
    ).map(([key, artist]) => [key, this.serializeArtist(artist)]);

    const firstAppearance: [string, string][] = Array.from(
      store.firstAppearance.entries(),
    );

    return {
      version: this.cacheVersion,
      timestamp: Date.now(),
      data: {
        artists,
        dates: store.dates,
        startDate: store.startDate,
        endDate: store.endDate,
        firstAppearance,
        chartWins: [], // always empty, recomputed downstream
      },
    };
  }

  private serializeArtist(artist: ParsedArtist): SerializedArtist {
    return {
      id: artist.id,
      name: artist.name,
      artistType: artist.artistType,
      generation: artist.generation,
      logoUrl: artist.logoUrl,
      koreanName: artist.koreanName,
      debut: artist.debut,
      releases: artist.releases.map((release) =>
        this.serializeRelease(release),
      ),
      albumReleases: artist.albumReleases,
    };
  }

  private serializeRelease(release: ParsedRelease): SerializedRelease {
    return {
      id: release.id,
      title: release.title,
      dailyValues: Array.from(release.dailyValues.entries()),
      embeds: Array.from(release.embeds.entries()),
      artistIds: release.artistIds,
    };
  }

  private deserialize(serialized: SerializedDataStore): DataStore {
    const artists = new Map<string, ParsedArtist>(
      serialized.data.artists.map(([key, artist]) => [
        key,
        this.deserializeArtist(artist),
      ]),
    );

    const firstAppearance = new Map<string, string>(
      serialized.data.firstAppearance,
    );

    // chartWins is always empty, recomputed downstream
    const chartWins = new Map();

    return {
      artists,
      dates: serialized.data.dates,
      startDate: serialized.data.startDate,
      endDate: serialized.data.endDate,
      firstAppearance,
      chartWins,
      releaseWinDates: new Map(),
    };
  }

  private deserializeArtist(serialized: SerializedArtist): ParsedArtist {
    return {
      id: serialized.id,
      name: serialized.name,
      artistType: serialized.artistType as ParsedArtist["artistType"],
      generation: serialized.generation,
      logoUrl: serialized.logoUrl,
      koreanName: serialized.koreanName,
      debut: serialized.debut,
      releases: serialized.releases.map((release) =>
        this.deserializeRelease(release),
      ),
      albumReleases: serialized.albumReleases ?? [],
    };
  }

  private deserializeRelease(serialized: SerializedRelease): ParsedRelease {
    return {
      id: serialized.id,
      title: serialized.title,
      dailyValues: new Map(serialized.dailyValues),
      embeds: new Map(serialized.embeds),
      artistIds: serialized.artistIds ?? [],
    };
  }
}
