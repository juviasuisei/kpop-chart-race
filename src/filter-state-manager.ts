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
  zoom: 10,
  view: "line",
  metric: "points",
};

export class FilterStateManager {
  private state: FilterState;
  private eventBus: EventBus;

  constructor(eventBus: EventBus, initial?: Partial<FilterState>) {
    this.eventBus = eventBus;
    this.state = { ...DEFAULT_STATE, ...initial };
  }

  /** Returns a copy of the current filter state (safe from external mutation). */
  getState(): FilterState {
    return { ...this.state };
  }

  /** Merges partial updates into the current state and emits "filter:change". */
  update(partial: Partial<FilterState>): void {
    this.state = { ...this.state, ...partial };
    this.eventBus.emit("filter:change", this.getState());
  }

  /** Restores all fields to defaults and emits "filter:change". */
  reset(): void {
    this.state = { ...DEFAULT_STATE };
    this.eventBus.emit("filter:change", this.getState());
  }
}
