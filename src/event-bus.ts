/**
 * Minimal typed pub/sub EventBus for decoupled component communication.
 */

import type { ChartSnapshot } from "./models.ts";
import type { ZoomLevel } from "./types.ts";

/** Map of event names to their handler signatures */
export interface EventMap {
  "data:loaded": () => void;
  "date:change": (date: string) => void;
  "state:updated": (snapshot: ChartSnapshot) => void;
  "play": () => void;
  "pause": () => void;
  "zoom:change": (level: ZoomLevel) => void;
  "bar:click": (artistId: string) => void;
  "panel:close": () => void;
  "scrub:start": () => void;
  "scrub:end": () => void;
  "loading:progress": (loaded: number, total: number, artistNames: string[]) => void;
  "loading:complete": () => void;
  "loading:error": (message: string) => void;
}

type Handler = (...args: never[]) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  /** Subscribe to an event */
  on<K extends keyof EventMap>(event: K, handler: EventMap[K]): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler);
  }

  /** Unsubscribe from an event */
  off<K extends keyof EventMap>(event: K, handler: EventMap[K]): void {
    this.handlers.get(event)?.delete(handler as Handler);
  }

  /** Emit an event to all subscribed handlers */
  emit<K extends keyof EventMap>(event: K, ...args: Parameters<EventMap[K]>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as (...a: unknown[]) => void)(...args);
    }
  }
}
