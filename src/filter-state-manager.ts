/**
 * Centralized filter state manager.
 * Holds all filter/toggle values and emits "filter:change" on the EventBus
 * whenever the state is updated or reset.
 */

import type { FilterState } from "./types.ts";
import type { EventBus } from "./event-bus.ts";

export type { FilterState };

const DEFAULT_STATE: FilterState = {
  displayMode: "songs",
  generation: "all",
  source: "all",
  artist: "all",
  zoom: 10,
  view: "line",
  metric: "points",
};

/**
 * Decide whether an implicitly-set artist filter should be cleared when the
 * app settles on `view`. An artist set by drilling in (clicking a name to open
 * the timeline) is "implicit" and must not linger as a filter once the user
 * navigates to any non-timeline view; an artist chosen via the dropdown or
 * loaded from the URL is "explicit" and persists. Pure so the routing rule can
 * be tested without the DOM.
 */
export function shouldClearImplicitArtist(
  view: FilterState["view"],
  artist: string,
  artistExplicit: boolean,
): boolean {
  return view !== "artist-timeline" && artist !== "all" && !artistExplicit;
}

/**
 * Decide whether an implicitly-set source filter should be cleared when the
 * app settles on `view`. A source set by drilling in (clicking a show/episode
 * link, which opens the episode browser scoped to that show) is "implicit" and
 * must not linger once the user navigates away from the episodes view; a source
 * chosen via the dropdown or loaded from the URL is "explicit" and persists.
 * Mirrors shouldClearImplicitArtist, but the implicit filter's "home" view is
 * `episodes` rather than `artist-timeline`. Pure for testability.
 */
export function shouldClearImplicitSource(
  view: FilterState["view"],
  source: string,
  sourceExplicit: boolean,
): boolean {
  return view !== "episodes" && source !== "all" && !sourceExplicit;
}

/** Options carrying caller intent that isn't part of the serialized state. */
export interface UpdateOptions {
  /**
   * Provenance of an `artist` change in this update:
   * - `true`  → the user explicitly chose the artist (e.g. toolbar dropdown),
   *             so the filter should persist across view changes.
   * - `false` → the artist was set implicitly by drilling in (e.g. clicking a
   *             name to open the timeline), so it should NOT persist as a
   *             filter when the user navigates to another view.
   * When omitted, a concrete artist defaults to explicit (a deliberate filter)
   * and clearing to "all" defaults to non-explicit. Only drill-in call sites
   * pass `false`.
   */
  artistExplicit?: boolean;
  /**
   * Provenance of a `source` change in this update, mirroring artistExplicit:
   * - `true`  → chosen explicitly (dropdown / URL), persists across views.
   * - `false` → set implicitly by drilling into a show, cleared on leaving the
   *             episodes view.
   * When omitted, a concrete source defaults to explicit and clearing to "all"
   * defaults to non-explicit. Only drill-in call sites pass `false`.
   */
  sourceExplicit?: boolean;
}

export class FilterStateManager {
  private state: FilterState;
  private eventBus: EventBus;
  /**
   * Whether the current `artist` value was set by an explicit user action
   * (dropdown) vs. an implicit drill-in (clicking a name). In-memory only —
   * not serialized to the URL. See UpdateOptions.artistExplicit.
   */
  private artistFilterExplicit = false;
  /**
   * Whether the current `source` value was set explicitly (dropdown/URL) vs.
   * implicitly by drilling into a show. In-memory only. See
   * UpdateOptions.sourceExplicit.
   */
  private sourceFilterExplicit = false;

  constructor(eventBus: EventBus, initial?: Partial<FilterState>) {
    this.eventBus = eventBus;
    this.state = { ...DEFAULT_STATE, ...initial };
    // A filter provided as initial state was chosen deliberately (saved config,
    // URL, etc.), so treat it as explicit — the same as a dropdown/URL choice.
    // Otherwise the first view change would wrongly clear it as a drill-in.
    this.artistFilterExplicit = this.state.artist !== "all";
    this.sourceFilterExplicit = this.state.source !== "all";
  }

  /** Returns a copy of the current filter state (safe from external mutation). */
  getState(): FilterState {
    return { ...this.state };
  }

  /** True when the current artist filter was set explicitly by the user. */
  isArtistFilterExplicit(): boolean {
    return this.artistFilterExplicit;
  }

  /** True when the current source filter was set explicitly by the user. */
  isSourceFilterExplicit(): boolean {
    return this.sourceFilterExplicit;
  }

  /**
   * Merges partial updates into the current state and emits "filter:change".
   *
   * Implicit filters (an artist/source set by drilling in rather than by an
   * explicit dropdown/URL choice) are cleared automatically in the SAME update
   * when the resulting view is no longer that filter's home. Folding the clear
   * in here means exactly one emit with the final state — the router never has
   * to re-emit, so the URL hash written from filter:change is always correct.
   */
  update(partial: Partial<FilterState>, opts?: UpdateOptions): void {
    // Provenance defaulting: only drill-in call sites pass `false`. Any other
    // update that sets a concrete artist/source (no opt given) is a deliberate
    // filter → explicit. Clearing to "all" is never explicit.
    if (partial.artist !== undefined) {
      if (opts?.artistExplicit !== undefined) {
        this.artistFilterExplicit = opts.artistExplicit;
      } else {
        this.artistFilterExplicit = partial.artist !== "all";
      }
    }
    if (partial.source !== undefined) {
      if (opts?.sourceExplicit !== undefined) {
        this.sourceFilterExplicit = opts.sourceExplicit;
      } else {
        this.sourceFilterExplicit = partial.source !== "all";
      }
    }

    const next = { ...this.state, ...partial };

    // Drop implicit filters that no longer belong to the resulting view.
    if (shouldClearImplicitArtist(next.view, next.artist, this.artistFilterExplicit)) {
      next.artist = "all";
      this.artistFilterExplicit = false;
    }
    if (shouldClearImplicitSource(next.view, next.source, this.sourceFilterExplicit)) {
      next.source = "all";
      this.sourceFilterExplicit = false;
    }

    this.state = next;
    this.eventBus.emit("filter:change", this.getState());
  }

  /** Restores all fields to defaults and emits "filter:change". */
  reset(): void {
    this.state = { ...DEFAULT_STATE };
    this.artistFilterExplicit = false;
    this.sourceFilterExplicit = false;
    this.eventBus.emit("filter:change", this.getState());
  }
}
