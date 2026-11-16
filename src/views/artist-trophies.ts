/**
 * Artist trophy row — every music-show win an artist has earned, oldest first,
 * shown on the artist view between the metadata line and the stats grid.
 * Each trophy reveals "Song - Show - Date" on hover, keyboard focus or tap.
 *
 * All text is set via textContent / setAttribute (never innerHTML) because
 * song titles come from the data files.
 */

import type { DataStore, ParsedArtist } from "../models.ts";

/** One music-show win. */
export interface Trophy {
  /** ISO date (YYYY-MM-DD) of the win. */
  date: string;
  /** Source key of the show, e.g. "inkigayo". */
  source: string;
  episode: number;
  songTitle: string;
  /** The artist's win count for this song on this show (crown icon level, >= 1). */
  crownLevel: number;
}

const UNKNOWN_SONG = "Unknown song";
const MAX_CROWN_ICON = 12;

/**
 * Derive the artist's trophies, oldest first. Ties on the same day are ordered
 * by source key so the result is deterministic. When more than one of the
 * artist's songs charted on the winning show that day, the highest-scoring one
 * gets the credit (one trophy per win, not per song).
 */
export function deriveTrophies(
  artist: ParsedArtist,
  dataStore: DataStore,
  sourceFilter: string = "all",
): Trophy[] {
  const trophies: Trophy[] = [];

  for (const [date, bySource] of dataStore.chartWins) {
    for (const [source, win] of bySource) {
      if (sourceFilter !== "all" && source !== sourceFilter) continue;
      if (!win.artistIds.includes(artist.id)) continue;

      let best: { title: string; value: number; episode: number } | null = null;
      for (const release of artist.releases) {
        const dv = release.dailyValues.get(date);
        if (!dv || dv.source !== source) continue;
        if (!best || dv.value > best.value) {
          best = { title: release.title, value: dv.value, episode: dv.episode };
        }
      }

      trophies.push({
        date,
        source,
        episode: best?.episode ?? 0,
        songTitle: best?.title ?? UNKNOWN_SONG,
        crownLevel: Math.max(1, win.crownLevels.get(artist.id) ?? 1),
      });
    }
  }

  // Plain code-unit comparison (not localeCompare) so the order never varies by locale.
  const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  trophies.sort((a, b) => cmp(a.date, b.date) || cmp(a.source, b.source));
  return trophies;
}

/** "Jan 15, 2024" (en-US, local-midnight parse so no timezone shift). */
export function formatTrophyDate(date: string): string {
  const d = new Date(date + "T00:00:00");
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** "Song - Show - Date", used for both the tooltip and the aria-label. */
export function formatTrophyLabel(t: Trophy, sourceLabels: Record<string, string>): string {
  // own-property check: a data-controlled key like "constructor" must not hit Object.prototype.
  const show = Object.prototype.hasOwnProperty.call(sourceLabels, t.source) ? sourceLabels[t.source] : t.source;
  return `${t.songTitle} - ${show} - ${formatTrophyDate(t.date)}`;
}

/**
 * Build the trophy row, or null when there are no wins (the row is omitted
 * rather than showing an empty state).
 */
export function createTrophyRow(
  trophies: Trophy[],
  sourceLabels: Record<string, string>,
): HTMLElement | null {
  if (trophies.length === 0) return null;

  const row = document.createElement("div");
  row.className = "artist-trophies";

  const count = document.createElement("div");
  count.className = "artist-trophies__count";
  count.textContent = `${trophies.length} ${trophies.length === 1 ? "win" : "wins"}`;
  row.appendChild(count);

  const list = document.createElement("div");
  list.className = "artist-trophies__list";
  list.setAttribute("role", "list");
  row.appendChild(list);

  // One shared tooltip, positioned under JS control so it never clips at the
  // row edges. Hidden from AT: each trophy already carries the same aria-label.
  const tip = document.createElement("div");
  tip.className = "artist-trophies__tip";
  tip.setAttribute("aria-hidden", "true");
  tip.hidden = true;
  row.appendChild(tip);

  let pinned: HTMLElement | null = null; // item pinned by tap / click

  const itemFrom = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(".artist-trophies__item") : null;

  // Document-level dismissal (Escape, click outside) is attached only while the
  // tooltip is visible, so hidden rows leave no listeners behind.
  const onDocKeydown = (e: KeyboardEvent): void => {
    if (!row.isConnected) return detach();
    if (e.key === "Escape") hide();
  };
  const onDocClick = (e: Event): void => {
    if (!row.isConnected) return detach();
    if (!row.contains(e.target as Node)) hide();
  };
  function detach(): void {
    document.removeEventListener("keydown", onDocKeydown);
    document.removeEventListener("click", onDocClick);
  }

  const show = (item: HTMLElement): void => {
    tip.textContent = item.getAttribute("aria-label") ?? "";
    tip.hidden = false;
    const rowW = row.clientWidth;
    const tipW = tip.offsetWidth;
    const center = item.offsetLeft + item.offsetWidth / 2;
    const left = rowW > 0 ? Math.min(Math.max(center - tipW / 2, 0), Math.max(rowW - tipW, 0)) : 0;
    tip.style.left = `${left}px`;
    tip.style.top = `${item.offsetTop + item.offsetHeight + 6}px`;
    document.addEventListener("keydown", onDocKeydown);
    document.addEventListener("click", onDocClick);
  };

  function hide(): void {
    tip.hidden = true;
    pinned = null;
    detach();
  }

  for (const t of trophies) {
    const label = formatTrophyLabel(t, sourceLabels);
    // The wrapper carries the list-item role so the button keeps its own role.
    const cell = document.createElement("div");
    cell.setAttribute("role", "listitem");

    const item = document.createElement("button");
    item.type = "button";
    item.className = "artist-trophies__item";
    item.setAttribute("aria-label", label);

    const img = document.createElement("img");
    img.src = `assets/crowns/crown-${Math.min(t.crownLevel, MAX_CROWN_ICON)}.svg`;
    img.alt = "";
    img.width = 24;
    img.height = 24;
    img.loading = "lazy";
    item.appendChild(img);

    cell.appendChild(item);
    list.appendChild(cell);
  }

  // Hovering or focusing a trophy previews it and drops any pin on another
  // trophy. The pinned trophy itself is left alone so a second tap (which
  // fires mouseover then click on touch) toggles it off.
  const preview = (item: HTMLElement): void => {
    if (pinned === item) return;
    pinned = null;
    show(item);
  };
  row.addEventListener("mouseover", (e) => {
    const item = itemFrom(e.target);
    if (item) preview(item);
  });
  row.addEventListener("mouseout", (e) => {
    if (itemFrom(e.target) && !pinned) hide();
  });
  row.addEventListener("focusin", (e) => {
    const item = itemFrom(e.target);
    if (item) preview(item);
  });
  row.addEventListener("focusout", (e) => {
    if (!itemFrom(e.target)) return;
    const next = (e as FocusEvent).relatedTarget as Node | null;
    // Moving to another trophy is handled by its focusin; leaving the row hides.
    if (!next || !row.contains(next)) hide();
  });
  // Click / tap / Enter / Space toggles a pinned tooltip so touch (no hover) works.
  row.addEventListener("click", (e) => {
    const item = itemFrom(e.target);
    if (!item) return;
    if (pinned === item) {
      hide();
    } else {
      pinned = item;
      show(item);
    }
  });

  return row;
}
