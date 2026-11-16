import type { DataStore } from "./models.ts";

/**
 * Fill in ALL calendar days from one day before the first date to the last
 * date. This ensures every day is represented (consistent x-spacing,
 * hoverable). Mutates `dataStore.dates` in place.
 *
 * `dataStore.startDate` is deliberately left on the first real data date: the
 * zero-day carries no data, and the nav label reads startDate.
 */
export function fillCalendarDays(dataStore: DataStore): void {
  const firstRealDate = dataStore.dates[0];
  const lastRealDate = dataStore.dates[dataStore.dates.length - 1];
  if (firstRealDate && lastRealDate) {
    try {
      const start = new Date(firstRealDate + "T00:00:00");
      start.setDate(start.getDate() - 1); // zero-day
      const end = new Date(lastRealDate + "T00:00:00");
      const allDays: string[] = [];
      const current = new Date(start);
      while (current <= end) {
        allDays.push(current.toISOString().split("T")[0]);
        current.setDate(current.getDate() + 1);
      }
      dataStore.dates = allDays;
    } catch { /* leave as-is */ }
  }
}
