import {
  orderLabelsByPriority,
  getLabelCandidateCommands,
  type LabelPriorityCandidate,
} from '../../src/views/line-chart-controller.ts';
import type { LineDrawCommand } from '../../src/worker/messages.ts';

/** Convenience builder for a label candidate with sensible defaults. */
function candidate(overrides: Partial<LabelPriorityCandidate>): LabelPriorityCandidate {
  return {
    lineId: 'line',
    y: 0,
    finalValue: 0,
    lastActivityIdx: 0,
    ...overrides,
  };
}

describe('orderLabelsByPriority', () => {
  it('picks the highest value ("#1") first regardless of clustering', () => {
    const candidates = [
      candidate({ lineId: 'a', y: 0, finalValue: 100, lastActivityIdx: 0 }),
      candidate({ lineId: 'b', y: 500, finalValue: 50, lastActivityIdx: 99 }),
    ];

    const [first] = orderLabelsByPriority(candidates, 18);
    expect(first.lineId).toBe('a');
  });

  it('in a small (<=5) colliding cluster, the largest value wins even if less recent', () => {
    // Two entries whose endpoints are 2px apart -- a genuine collision.
    // "b" has more recent activity but a lower value; per the rule, the
    // larger value should win when the cluster size is <= 5.
    const candidates = [
      candidate({ lineId: 'a', y: 100, finalValue: 66912, lastActivityIdx: 5 }),
      candidate({ lineId: 'b', y: 102, finalValue: 61311, lastActivityIdx: 50 }),
      // Unrelated top-value line, far away, just so "a"/"b" aren't the global max.
      candidate({ lineId: 'top', y: 0, finalValue: 999999, lastActivityIdx: 0 }),
    ];

    const ordered = orderLabelsByPriority(candidates, 18);
    const aIndex = ordered.findIndex(c => c.lineId === 'a');
    const bIndex = ordered.findIndex(c => c.lineId === 'b');
    expect(aIndex).toBeLessThan(bIndex);
  });

  it('a genuine 2-way tie is NOT treated as a large cluster merely because unrelated, non-colliding labels sit within a wider band', () => {
    // Regression test for the bug: "a" and "b" truly collide (2px apart,
    // well under the 18px collision threshold). "c", "d", "e", "f" sit
    // 20px apart from their neighbors -- far enough that none of them
    // collide with anything (20 > 18) -- but all six labels fall within a
    // 90px band, which is what the old (buggy) detection window used
    // (minGap * 5). Under the old logic this whole band was treated as one
    // cluster of size 6 (> 5), flipping "a" vs "b" to recency-based
    // tie-breaking and letting the more-recent-but-lower-value "b" win.
    // With correct chained detection at the real 18px threshold, "a"/"b"
    // form their own cluster of size 2, so the larger value ("a") must win.
    const candidates = [
      candidate({ lineId: 'top', y: 0, finalValue: 999999, lastActivityIdx: 0 }),
      candidate({ lineId: 'a', y: 100, finalValue: 66912, lastActivityIdx: 5 }),
      candidate({ lineId: 'b', y: 102, finalValue: 61311, lastActivityIdx: 50 }),
      candidate({ lineId: 'c', y: 122, finalValue: 100, lastActivityIdx: 1 }),
      candidate({ lineId: 'd', y: 142, finalValue: 90, lastActivityIdx: 1 }),
      candidate({ lineId: 'e', y: 162, finalValue: 80, lastActivityIdx: 1 }),
      candidate({ lineId: 'f', y: 182, finalValue: 70, lastActivityIdx: 1 }),
    ];

    const ordered = orderLabelsByPriority(candidates, 18);
    const aIndex = ordered.findIndex(c => c.lineId === 'a');
    const bIndex = ordered.findIndex(c => c.lineId === 'b');
    // "a" has the larger value of the truly-colliding pair, so it must win.
    expect(aIndex).toBeLessThan(bIndex);
  });

  it('in a large (>5) colliding cluster, the most recently active line wins', () => {
    // Six entries all within 18px of a chained neighbor -- a genuine
    // large cluster of size 6.
    const candidates = [
      candidate({ lineId: 'top', y: 0, finalValue: 999999, lastActivityIdx: 0 }),
      candidate({ lineId: 'a', y: 100, finalValue: 500, lastActivityIdx: 10 }),
      candidate({ lineId: 'b', y: 110, finalValue: 400, lastActivityIdx: 90 }),
      candidate({ lineId: 'c', y: 120, finalValue: 300, lastActivityIdx: 20 }),
      candidate({ lineId: 'd', y: 130, finalValue: 200, lastActivityIdx: 30 }),
      candidate({ lineId: 'e', y: 140, finalValue: 100, lastActivityIdx: 40 }),
      candidate({ lineId: 'f', y: 150, finalValue: 50, lastActivityIdx: 15 }),
    ];

    const ordered = orderLabelsByPriority(candidates, 18);
    // "b" is the most recently active of the cluster (excluding the #1 line),
    // so it must be placed ahead of every other cluster member despite not
    // having the largest value.
    const bIndex = ordered.findIndex(c => c.lineId === 'b');
    const others = ['a', 'c', 'd', 'e', 'f'].map(id => ordered.findIndex(c => c.lineId === id));
    expect(others.every(idx => bIndex < idx)).toBe(true);
  });

  it('breaks recency ties in a large cluster using value descending', () => {
    const candidates = [
      candidate({ lineId: 'top', y: 0, finalValue: 999999, lastActivityIdx: 0 }),
      candidate({ lineId: 'a', y: 100, finalValue: 500, lastActivityIdx: 10 }),
      candidate({ lineId: 'b', y: 110, finalValue: 400, lastActivityIdx: 10 }),
      candidate({ lineId: 'c', y: 120, finalValue: 300, lastActivityIdx: 10 }),
      candidate({ lineId: 'd', y: 130, finalValue: 200, lastActivityIdx: 10 }),
      candidate({ lineId: 'e', y: 140, finalValue: 100, lastActivityIdx: 10 }),
      candidate({ lineId: 'f', y: 150, finalValue: 50, lastActivityIdx: 10 }),
    ];

    const ordered = orderLabelsByPriority(candidates, 18);
    const aIndex = ordered.findIndex(c => c.lineId === 'a');
    const bIndex = ordered.findIndex(c => c.lineId === 'b');
    // All tied on recency, so higher value ("a") must win over "b".
    expect(aIndex).toBeLessThan(bIndex);
  });

  it('returns an empty array for no candidates', () => {
    expect(orderLabelsByPriority([], 18)).toEqual([]);
  });

  it('regression: REDRED (higher value, older) must beat Paradise of Rumors (lower value, more recent) in their isolated 2-item cluster', () => {
    // Reported real-world values (2026-07-22 frame):
    //   REDRED — CORTIS: 50,346, last activity 2026-07-17 (5 days stale)
    //   Paradise of Rumors — AKMU: 49,895, last activity 2026-07-20 (2 days stale)
    // Y positions derived from the actual linear value->pixel mapping used by
    // chart-worker.ts's buildPixelPoints (y = top + chartH - value/max*chartH),
    // using the visible max ("Suddenly", 115,936) and the on-screen scale
    // (~18px per ~2268 value-units). VIRAL and Catch Catch are included,
    // unchanged, to confirm they do NOT chain into the same cluster.
    const pxPerUnit = 18 / 2268;
    const maxValue = 115936;
    const y = (value: number) => (maxValue - value) * pxPerUnit;

    const candidates = [
      candidate({ lineId: 'suddenly', y: y(115936), finalValue: 115936, lastActivityIdx: 100 }),
      candidate({ lineId: 'viral', y: y(56876), finalValue: 56876, lastActivityIdx: 90 }),
      candidate({ lineId: 'redred', y: y(50346), finalValue: 50346, lastActivityIdx: 17 }),
      candidate({ lineId: 'paradise', y: y(49895), finalValue: 49895, lastActivityIdx: 20 }),
      candidate({ lineId: 'catchcatch', y: y(42972), finalValue: 42972, lastActivityIdx: 80 }),
    ];

    const ordered = orderLabelsByPriority(candidates, 18);
    const redredIndex = ordered.findIndex(c => c.lineId === 'redred');
    const paradiseIndex = ordered.findIndex(c => c.lineId === 'paradise');
    expect(redredIndex).toBeLessThan(paradiseIndex);
  });
});

/** Convenience builder for a minimal LineDrawCommand. */
function drawCommand(lineId: string): LineDrawCommand {
  return {
    lineId,
    points: [{ x: 0, y: 0 }],
    values: [0],
    color: '#000000',
    opacity: 1,
    lineWidth: 1,
  };
}

describe('getLabelCandidateCommands', () => {
  it('includes both foreground and background lines', () => {
    // Regression test: a line that has faded into the background layer
    // (opacity <= 0.5, but still > 0.05) must still be able to compete for
    // a label slot -- excluding it would let a foreground line "win" a
    // slot by default without ever being compared against it.
    const result = {
      background: [drawCommand('bg-line')],
      foreground: [drawCommand('fg-line')],
    };

    const candidates = getLabelCandidateCommands(result);
    const ids = candidates.map(c => c.lineId);
    expect(ids).toContain('bg-line');
    expect(ids).toContain('fg-line');
    expect(candidates).toHaveLength(2);
  });

  it('returns an empty array when both layers are empty', () => {
    expect(getLabelCandidateCommands({ background: [], foreground: [] })).toEqual([]);
  });
});
