/**
 * Maps Airtable show display names to ChartSource identifiers.
 * Used by the Data_Adapter to convert Episode "Show" field values
 * into the snake_case strings expected by the rendering code.
 */
export const SHOW_NAME_MAP: ReadonlyMap<string, string> = new Map([
  ["The Show", "the_show"],
  ["Show Champion", "show_champion"],
  ["M Countdown", "m_countdown"],
  ["Music Bank", "music_bank"],
  ["Show! Music Core", "show_music_core"],
  ["Inkigayo", "inkigayo"],
]);

/**
 * Convert a show display name to its ChartSource string.
 * Looks up the known mapping first; falls back to lowercased
 * with all non-alphanumeric characters replaced by underscores.
 */
export function toChartSource(displayName: string): string {
  const mapped = SHOW_NAME_MAP.get(displayName);
  if (mapped !== undefined) {
    return mapped;
  }
  return displayName.toLowerCase().replace(/[^a-z0-9]/g, "_");
}
