/**
 * The nav label "N total points from <startDate> forward" reads
 * dataStore.startDate. The timeline is padded with a leading zero-day so the
 * chart can rewind to an empty state, but that padded day has no data and must
 * never become the startDate.
 */

import { describe, it, expect } from 'vitest';
import { fillCalendarDays } from '../../src/calendar-days.ts';
import type { DataStore } from '../../src/models.ts';

function makeStore(dates: string[]): DataStore {
  return {
    artists: new Map(),
    dates,
    startDate: dates[0] ?? '',
    endDate: dates[dates.length - 1] ?? '',
    firstAppearance: new Map(),
    chartWins: new Map(),
    releaseWinDates: new Map(),
  };
}

describe('fillCalendarDays', () => {
  it('keeps startDate on the first real data date, not the zero-day', () => {
    const store = makeStore(['2024-03-10', '2024-03-12']);
    fillCalendarDays(store);
    expect(store.startDate).toBe('2024-03-10');
  });

  it('still prepends a zero-day before startDate and fills every calendar day', () => {
    const store = makeStore(['2024-03-10', '2024-03-12']);
    fillCalendarDays(store);
    // 3 real calendar days (10th, 11th, 12th) plus the zero-day. Timezone-independent.
    expect(store.dates).toHaveLength(4);
    expect(store.dates[0] < store.startDate).toBe(true);
    expect([...store.dates].sort()).toEqual(store.dates);
  });

  // The padding loop turns local midnight into a UTC string, so exact dates only
  // hold at UTC and in zones west of it (this is existing behavior, not part of
  // the label fix).
  it.runIf(new Date().getTimezoneOffset() >= 0)('pads with the exact previous calendar day', () => {
    const store = makeStore(['2024-03-10', '2024-03-12']);
    fillCalendarDays(store);
    expect(store.dates).toEqual(['2024-03-09', '2024-03-10', '2024-03-11', '2024-03-12']);
  });

  it('keeps startDate across a month boundary', () => {
    const store = makeStore(['2024-03-01', '2024-03-02']);
    fillCalendarDays(store);
    expect(store.dates).toHaveLength(3);
    expect(store.dates[0] < store.startDate).toBe(true);
    expect(store.startDate).toBe('2024-03-01');
  });

  it('leaves an empty store untouched', () => {
    const store = makeStore([]);
    fillCalendarDays(store);
    expect(store.dates).toEqual([]);
    expect(store.startDate).toBe('');
  });
});
