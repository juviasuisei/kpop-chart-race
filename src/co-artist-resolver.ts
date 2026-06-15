/**
 * Co-artist resolution module.
 * Resolves an array of artist IDs to their full artist data from the DataStore,
 * falling back to the parent artist data for IDs not found in the store.
 * Provides formatting utilities for co-artist display labels.
 */

import type { ArtistType } from './types.ts';
import type { ParsedArtist, DataStore, ResolvedArtist } from './models.ts';

// Re-export ResolvedArtist for backward compatibility
export type { ResolvedArtist } from './models.ts';

/** Map of artist type to its display indicator symbol */
const ARTIST_TYPE_INDICATORS: Record<ArtistType, string> = {
  boy_group: '▲',
  girl_group: '●',
  solo_male: '◆',
  solo_female: '★',
  mixed_group: '■',
};

/**
 * Formats a co-artist label string from an array of resolved artists.
 * Each artist's name is followed by their type indicator symbol.
 * Multiple artists are joined by " • " (bullet separator).
 *
 * @param artists - Array of resolved artists (1–20 entries) in display order
 * @returns Formatted label string, e.g., "BTS ▲ • aespa ●"
 */
export function formatCoArtistLabel(artists: ResolvedArtist[]): string {
  return artists
    .map((artist) => `${artist.name} ${ARTIST_TYPE_INDICATORS[artist.artistType]}`)
    .join(' • ');
}

/**
 * Resolves an array of artist IDs to ResolvedArtist objects.
 * For each ID present in the DataStore, uses that artist's data.
 * For IDs not present, falls back to the parentArtist's data.
 * If artistIds is empty, defaults to [parentArtist.id].
 *
 * @param artistIds - Ordered array of artist IDs (1–20 entries)
 * @param dataStore - The application data store containing all known artists
 * @param parentArtist - Fallback artist data for unresolved IDs
 * @returns Array of ResolvedArtist objects in the same order as input
 */
export function resolveArtists(
  artistIds: string[],
  dataStore: DataStore,
  parentArtist: ParsedArtist,
): ResolvedArtist[] {
  // If artistIds is empty, default to parent artist
  const ids = artistIds.length === 0 ? [parentArtist.id] : artistIds;

  return ids.map((id) => {
    const artist = dataStore.artists.get(id);
    if (artist) {
      return {
        id: artist.id,
        name: artist.name,
        logoUrl: artist.logoUrl,
        artistType: artist.artistType,
        generation: artist.generation,
      };
    }
    // Fallback to parent artist for missing IDs
    return {
      id: parentArtist.id,
      name: parentArtist.name,
      logoUrl: parentArtist.logoUrl,
      artistType: parentArtist.artistType,
      generation: parentArtist.generation,
    };
  });
}
