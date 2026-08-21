import {
  findFirstPlaceLineId,
  resolveLineOpacity,
  computeInactivityOpacity,
  FADE_START_DAYS,
  BASE_FADE_END_DAYS,
  type LineValue,
} from '../../src/worker/visibility.ts';

describe('findFirstPlaceLineId', () => {
  it('returns the line with the highest value', () => {
    const lines: LineValue[] = [
      { lineId: 'a', value: 100 },
      { lineId: 'b', value: 300 },
      { lineId: 'c', value: 200 },
    ];
    expect(findFirstPlaceLineId(lines)).toBe('b');
  });

  it('returns null when there are no lines', () => {
    expect(findFirstPlaceLineId([])).toBeNull();
  });

  it('returns null when every value is zero or negative', () => {
    // Guards the #1-immunity from latching onto a line that has no points yet.
    expect(findFirstPlaceLineId([{ lineId: 'a', value: 0 }, { lineId: 'b', value: 0 }])).toBeNull();
  });

  it('keeps the incumbent on an exact tie (a tie is not "surpassing")', () => {
    // First line encountered with the max value wins; a later equal value
    // does not unseat it.
    const lines: LineValue[] = [
      { lineId: 'incumbent', value: 500 },
      { lineId: 'challenger', value: 500 },
    ];
    expect(findFirstPlaceLineId(lines)).toBe('incumbent');
  });

  it('hands #1 to a challenger the instant it exceeds the leader', () => {
    // Same leader, one point higher on the challenger -> leader changes.
    const before = findFirstPlaceLineId([
      { lineId: 'leader', value: 1000 },
      { lineId: 'challenger', value: 999 },
    ]);
    const after = findFirstPlaceLineId([
      { lineId: 'leader', value: 1000 },
      { lineId: 'challenger', value: 1001 },
    ]);
    expect(before).toBe('leader');
    expect(after).toBe('challenger');
  });
});

describe('computeInactivityOpacity', () => {
  it('is fully opaque within the grace window', () => {
    expect(computeInactivityOpacity(0, 0)).toBe(1.0);
    expect(computeInactivityOpacity(FADE_START_DAYS, 0)).toBe(1.0);
  });

  it('is fully transparent at or past the ceiling', () => {
    expect(computeInactivityOpacity(BASE_FADE_END_DAYS, 0)).toBe(0.0);
    expect(computeInactivityOpacity(BASE_FADE_END_DAYS + 100, 0)).toBe(0.0);
  });

  it('ramps linearly between the grace window and the ceiling', () => {
    // Halfway between FADE_START_DAYS (7) and BASE_FADE_END_DAYS (28) is
    // 17.5 days -> opacity 0.5.
    const mid = (FADE_START_DAYS + BASE_FADE_END_DAYS) / 2;
    expect(computeInactivityOpacity(mid, 0)).toBeCloseTo(0.5, 5);
  });

  it('widens the ceiling as active filters increase', () => {
    // With one filter the ceiling doubles, so a line that would be fully
    // faded at filterCount 0 is still partly visible at filterCount 1.
    expect(computeInactivityOpacity(BASE_FADE_END_DAYS, 0)).toBe(0.0);
    expect(computeInactivityOpacity(BASE_FADE_END_DAYS, 1)).toBeGreaterThan(0.0);
  });
});

describe('resolveLineOpacity', () => {
  const base = {
    isSelected: false,
    isPinnedArtist: false,
    isFirstPlace: false,
    artistFilterActive: false,
    daysSinceActivity: 999, // long-inactive: would fully fade if not immune
    filterCount: 0,
  };

  it('keeps the #1 line fully visible no matter how long it has been inactive', () => {
    expect(resolveLineOpacity({ ...base, isFirstPlace: true })).toBe(1.0);
  });

  it('applies the inactivity fade immediately once a line is no longer #1', () => {
    // Same long-inactive line, but no longer #1 -> falls straight through to
    // the fade, which at 999 days is fully transparent. This is the
    // "immediately kick in when surpassed" half of the rule.
    expect(resolveLineOpacity({ ...base, isFirstPlace: false })).toBe(0.0);
  });

  it('keeps selected lines fully visible', () => {
    expect(resolveLineOpacity({ ...base, isSelected: true })).toBe(1.0);
  });

  it('keeps everything visible when an artist filter is active', () => {
    expect(resolveLineOpacity({ ...base, artistFilterActive: true })).toBe(1.0);
  });

  it('keeps the pinned artist fully visible even when long-inactive and not #1', () => {
    // The pinned artist (Artists-mode filter) is treated like #1 for
    // visibility: immune to the inactivity fade regardless of recency.
    expect(resolveLineOpacity({ ...base, isPinnedArtist: true })).toBe(1.0);
  });

  it('pinned-artist immunity does not require being #1 or selected', () => {
    const stale = { ...base, daysSinceActivity: 500, isFirstPlace: false, isSelected: false };
    expect(resolveLineOpacity({ ...stale, isPinnedArtist: true })).toBe(1.0);
    expect(resolveLineOpacity({ ...stale, isPinnedArtist: false })).toBe(0.0);
  });

  it('otherwise defers to the inactivity fade', () => {
    expect(resolveLineOpacity({ ...base, daysSinceActivity: 0 })).toBe(1.0);
    const mid = (FADE_START_DAYS + BASE_FADE_END_DAYS) / 2;
    expect(resolveLineOpacity({ ...base, daysSinceActivity: mid })).toBeCloseTo(0.5, 5);
  });

  it('models the full surpass transition for a stale former leader', () => {
    // A line that coasted as #1 while going stale (60 days inactive) is
    // fully visible while #1, then drops to 0 the moment it is surpassed --
    // no grace, no lingering.
    const stale = { ...base, daysSinceActivity: 60 };
    expect(resolveLineOpacity({ ...stale, isFirstPlace: true })).toBe(1.0);
    expect(resolveLineOpacity({ ...stale, isFirstPlace: false })).toBe(0.0);
  });
});
