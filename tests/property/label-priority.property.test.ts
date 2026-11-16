import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { rankLabelCandidates, shiftDate, type LabelRankInput } from '../../src/label-priority.ts';

const NOW = '2025-06-15';
const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const arbCandidates = fc
  .uniqueArray(fc.constantFrom(...ids), { minLength: 0, maxLength: 8 })
  .chain(used =>
    fc.tuple(...used.map(lineId =>
      fc.record({
        lineId: fc.constant(lineId),
        total: fc.integer({ min: 0, max: 4 }),
        lastActivityIdx: fc.integer({ min: -1, max: 3 }),
        artistTotal: fc.integer({ min: 0, max: 4 }),
        title: fc.constantFrom('x', 'X', 'y', 'Y'),
        artistName: fc.constantFrom('p', 'P', 'q'),
      }),
    )) as fc.Arbitrary<LabelRankInput[]>,
  );

const arbWinners = fc
  .array(fc.tuple(fc.integer({ min: -3, max: 31 }), fc.constantFrom(...ids)), { maxLength: 12 })
  .map(pairs => {
    const m = new Map<string, Set<string>>();
    for (const [k, id] of pairs) {
      const d = shiftDate(NOW, -k)!;
      if (!m.has(d)) m.set(d, new Set());
      m.get(d)!.add(id);
    }
    return m;
  });

const rank = (cs: LabelRankInput[], w: Map<string, Set<string>>) =>
  rankLabelCandidates(cs, { nowDate: NOW, winnersByDate: w });

describe('rankLabelCandidates properties', () => {
  it('is a permutation of its input', () => {
    fc.assert(fc.property(arbCandidates, arbWinners, (cs, w) => {
      expect(rank(cs, w).map(x => x.lineId).sort()).toEqual(cs.map(x => x.lineId).sort());
    }));
  });
  it('is deterministic and independent of input order (strict total order)', () => {
    fc.assert(fc.property(arbCandidates, arbWinners, fc.integer(), (cs, w, seed) => {
      const shuffled = [...cs].sort((p, q) => ((p.lineId.charCodeAt(0) * 31 + seed) % 7) - ((q.lineId.charCodeAt(0) * 31 + seed) % 7));
      const a = rank(cs, w).map(x => x.lineId);
      expect(rank(cs, w).map(x => x.lineId)).toEqual(a);
      expect(rank(shuffled, w).map(x => x.lineId)).toEqual(a);
    }));
  });
  it('rule 1: a candidate with the maximum total is always first', () => {
    fc.assert(fc.property(arbCandidates, arbWinners, (cs, w) => {
      fc.pre(cs.length > 0);
      const max = Math.max(...cs.map(x => x.total));
      expect(rank(cs, w)[0].total).toBe(max);
    }));
  });
  it('rule 2 precedes 3-6: among non-#1 lines a more recent win never ranks below an older/no win', () => {
    fc.assert(fc.property(arbCandidates, arbWinners, (cs, w) => {
      fc.pre(cs.length > 0);
      const max = Math.max(...cs.map(x => x.total));
      const age = (id: string) => {
        for (let k = 0; k < 29; k++) if (w.get(shiftDate(NOW, -k)!)?.has(id)) return k;
        return 29;
      };
      const rest = rank(cs, w).filter(x => x.total !== max);
      for (let i = 1; i < rest.length; i++) expect(age(rest[i - 1].lineId)).toBeLessThanOrEqual(age(rest[i].lineId));
    }));
  });
  it('ties on rules 1-5 are broken alphabetically by title then artist', () => {
    fc.assert(fc.property(arbCandidates, (cs) => {
      const flat = cs.map(x => ({ ...x, total: 1, lastActivityIdx: 0, artistTotal: 0 }));
      const r = rank(flat, new Map());
      for (let i = 1; i < r.length; i++) {
        const p = r[i - 1], q = r[i];
        const kp = [p.title.toLowerCase(), p.artistName.toLowerCase(), p.lineId].join('\u0000');
        const kq = [q.title.toLowerCase(), q.artistName.toLowerCase(), q.lineId].join('\u0000');
        expect(kp < kq).toBe(true);
      }
    }));
  });
  it('is stable under NaN/Infinity inputs (still a permutation, no throw)', () => {
    const cs = [
      { lineId: 'a', total: NaN, lastActivityIdx: 0, artistTotal: 0, title: 't', artistName: 'a' },
      { lineId: 'b', total: Infinity, lastActivityIdx: NaN, artistTotal: -Infinity, title: 't', artistName: 'a' },
    ];
    expect(rank(cs, new Map()).length).toBe(2);
  });
});
