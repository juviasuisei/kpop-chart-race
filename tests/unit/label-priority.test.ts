import { describe, it, expect } from 'vitest';
import {
  rankLabelCandidates,
  winAgeDays,
  shiftDate,
  buildWinnersByDate,
  lastActivityAtOrBefore,
  WINNER_LOOKBACK_DAYS,
  type LabelRankInput,
} from '../../src/label-priority.ts';

const NOW = '2025-03-31';

function c(o: Partial<LabelRankInput> & { lineId: string }): LabelRankInput {
  return { total: 0, lastActivityIdx: 0, artistTotal: 0, title: o.lineId, artistName: 'x', ...o };
}
const winners = (m: Record<string, string[]>) =>
  new Map(Object.entries(m).map(([d, ids]) => [d, new Set(ids)]));
const order = (cs: LabelRankInput[], w: Record<string, string[]> = {}, pinned?: string) =>
  rankLabelCandidates(cs, { nowDate: NOW, winnersByDate: winners(w), pinnedLineId: pinned }).map(x => x.lineId);

describe('shiftDate / winAgeDays', () => {
  it('shifts across month and leap boundaries', () => {
    expect(shiftDate('2025-03-01', -1)).toBe('2025-02-28');
    expect(shiftDate('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftDate('nope', -1)).toBeNull();
  });
  it('window is exactly 29 days: now-28 counts, now-29 does not', () => {
    expect(WINNER_LOOKBACK_DAYS).toBe(29);
    expect(winAgeDays('a', NOW, winners({ [shiftDate(NOW, -28)!]: ['a'] }))).toBe(28);
    expect(winAgeDays('a', NOW, winners({ [shiftDate(NOW, -29)!]: ['a'] }))).toBe(29);
    expect(winAgeDays('a', NOW, winners({}))).toBe(29);
  });
  it('uses the most recent win when a line won on several days', () => {
    expect(winAgeDays('a', NOW, winners({ [shiftDate(NOW, -9)!]: ['a'], [shiftDate(NOW, -2)!]: ['a'] }))).toBe(2);
  });
});

describe('rankLabelCandidates tie-break levels', () => {
  it('1: #1 overall beats a winner on now', () => {
    const r = order([c({ lineId: 'win', total: 5 }), c({ lineId: 'top', total: 100 })], { [NOW]: ['win'] });
    expect(r[0]).toBe('top');
  });
  it('2: winner on now beats winner yesterday beats winner 28 days ago beats non-winner', () => {
    const cs = ['none', 'd28', 'd1', 'd0', 'top'].map(id => c({ lineId: id, total: id === 'top' ? 999 : 1, lastActivityIdx: id === 'none' ? 99 : 0 }));
    const r = order(cs, { [NOW]: ['d0'], [shiftDate(NOW, -1)!]: ['d1'], [shiftDate(NOW, -28)!]: ['d28'] });
    expect(r).toEqual(['top', 'd0', 'd1', 'd28', 'none']);
  });
  it('2: a win older than 28 days is no win', () => {
    const r = order([c({ lineId: 'old', lastActivityIdx: 0 }), c({ lineId: 'recent', lastActivityIdx: 5, total: 2 }), c({ lineId: 'top', total: 9 })], { [shiftDate(NOW, -29)!]: ['old'] });
    expect(r).toEqual(['top', 'recent', 'old']);
  });
  it('2: several winners on one day tie there and fall through to recent activity', () => {
    const r = order([c({ lineId: 'a', lastActivityIdx: 1 }), c({ lineId: 'b', lastActivityIdx: 7 }), c({ lineId: 'top', total: 9 })], { [NOW]: ['a', 'b'] });
    expect(r).toEqual(['top', 'b', 'a']);
  });
  it('2: a line winning on now and 5 days ago ranks by now', () => {
    const r = order([c({ lineId: 'once', total: 1 }), c({ lineId: 'twice', total: 1 }), c({ lineId: 'top', total: 9 })], { [NOW]: ['twice'], [shiftDate(NOW, -1)!]: ['once'], [shiftDate(NOW, -5)!]: ['twice'] });
    expect(r).toEqual(['top', 'twice', 'once']);
  });
  it('3: most recent activity beats larger total', () => {
    const r = order([c({ lineId: 'big', total: 50, lastActivityIdx: 3 }), c({ lineId: 'fresh', total: 10, lastActivityIdx: 8 }), c({ lineId: 'top', total: 99 })]);
    expect(r).toEqual(['top', 'fresh', 'big']);
  });
  it('4: larger total as of now beats larger artist total', () => {
    const r = order([c({ lineId: 'a', total: 5, artistTotal: 900 }), c({ lineId: 'b', total: 7, artistTotal: 10 }), c({ lineId: 'top', total: 99 })]);
    expect(r).toEqual(['top', 'b', 'a']);
  });
  it('5: larger artist total wins when totals tie', () => {
    const r = order([c({ lineId: 'a', total: 5, artistTotal: 10 }), c({ lineId: 'b', total: 5, artistTotal: 40 }), c({ lineId: 'top', total: 99 })]);
    expect(r).toEqual(['top', 'b', 'a']);
  });
  it('6: alphabetical by title, then artist, case-insensitive, then lineId', () => {
    const r = order([
      c({ lineId: '3', title: 'beta', artistName: 'Z' }),
      c({ lineId: '2', title: 'Alpha', artistName: 'b' }),
      c({ lineId: '1', title: 'alpha', artistName: 'A' }),
      c({ lineId: '0', title: 'alpha', artistName: 'a' }),
    ]);
    expect(r).toEqual(['0', '1', '2', '3']);
  });
  it('a prefix title sorts before the longer title (title is compared before artist)', () => {
    expect(order([c({ lineId: 'b', title: 'Love Me', artistName: 'A' }), c({ lineId: 'a', title: 'Love', artistName: 'Z' })])).toEqual(['a', 'b']);
  });
  it('tied #1 totals fall through to the later rules', () => {
    const r = order([c({ lineId: 'a', total: 9, lastActivityIdx: 1 }), c({ lineId: 'b', total: 9, lastActivityIdx: 4 })]);
    expect(r).toEqual(['b', 'a']);
  });
  it('pinned line goes before #1; empty input is empty', () => {
    expect(order([c({ lineId: 'p', total: 1 }), c({ lineId: 'top', total: 9 })], {}, 'p')).toEqual(['p', 'top']);
    expect(order([])).toEqual([]);
  });
  it('does not mutate its input', () => {
    const cs = [c({ lineId: 'a', total: 1 }), c({ lineId: 'b', total: 2 })];
    order(cs);
    expect(cs.map(x => x.lineId)).toEqual(['a', 'b']);
  });
});

describe('window across month/year rollover and non-finite input', () => {
  it('counts a win on 2024-12-20 as age 28 for now=2025-01-17, not for 2025-01-18', () => {
    const w = winners({ '2024-12-20': ['a'] });
    expect(winAgeDays('a', '2025-01-17', w)).toBe(28);
    expect(winAgeDays('a', '2025-01-18', w)).toBe(29);
  });
  it('non-finite totals are treated as 0 (so +Infinity does not become #1)', () => {
    const r = order([c({ lineId: 'inf', total: Infinity, title: 'z' }), c({ lineId: 'one', total: 1, title: 'a' }), c({ lineId: 'nan', total: NaN, title: 'm' })]);
    expect(r[0]).toBe('one');
    expect(r).toEqual(['one', 'nan', 'inf']);
  });
});

describe('buildWinnersByDate / lastActivityAtOrBefore', () => {
  const dv = new Map([['2025-01-01', { source: 'music_bank' }], ['2025-01-02', { source: 'inkigayo' }]]);
  const rel = { id: 'r1', artistIds: ['a1', 'a2'], dailyValues: dv };
  const artists = new Map([
    ['a1', { releases: [rel] }],
    ['a2', { releases: [rel] }],
  ]);
  const wins = new Map([['a1::r1', ['2025-01-01']], ['a2::r1', ['2025-01-01', '2025-01-02']]]);
  it('songs mode maps co-credited wins to the primary lineId', () => {
    const m = buildWinnersByDate(artists, wins, 'songs');
    expect([...m.get('2025-01-01')!]).toEqual(['a1::r1']);
    expect([...m.get('2025-01-02')!]).toEqual(['a1::r1']);
  });
  it('artists mode maps wins to the winning artist', () => {
    const m = buildWinnersByDate(artists, wins, 'artists');
    expect([...m.get('2025-01-01')!].sort()).toEqual(['a1', 'a2']);
  });
  it('a source filter keeps only wins on that show; undefined wins map is empty', () => {
    const m = buildWinnersByDate(artists, wins, 'songs', 'inkigayo');
    expect([...m.keys()]).toEqual(['2025-01-02']);
    expect(buildWinnersByDate(artists, undefined, 'songs').size).toBe(0);
  });
  it('lastActivityAtOrBefore binary-searches', () => {
    expect(lastActivityAtOrBefore([2, 5, 9], 8)).toBe(5);
    expect(lastActivityAtOrBefore([2, 5, 9], 9)).toBe(9);
    expect(lastActivityAtOrBefore([2, 5, 9], 1)).toBe(-1);
    expect(lastActivityAtOrBefore([], 5)).toBe(-1);
  });
});
