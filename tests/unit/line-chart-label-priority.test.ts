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
  it('picks the highest value ("#1") first regardless of pile-up', () => {
    const candidates = [
      candidate({ lineId: 'a', y: 0, finalValue: 100, lastActivityIdx: 0 }),
      candidate({ lineId: 'b', y: 500, finalValue: 50, lastActivityIdx: 99 }),
    ];

    const [first] = orderLabelsByPriority(candidates);
    expect(first.lineId).toBe('a');
  });

  it('in a small (<=5) mutual clique, the largest value wins even if less recent', () => {
    // Two entries whose endpoints are 2px apart -- a genuine collision.
    // "b" has more recent activity but a lower value; per the rule, the
    // larger value should win when pile-up size is <= 5.
    const candidates = [
      candidate({ lineId: 'a', y: 100, finalValue: 66912, lastActivityIdx: 5 }),
      candidate({ lineId: 'b', y: 102, finalValue: 61311, lastActivityIdx: 50 }),
      // Unrelated top-value line, far away, just so "a"/"b" aren't the global max.
      candidate({ lineId: 'top', y: 0, finalValue: 999999, lastActivityIdx: 0 }),
    ];

    const ordered = orderLabelsByPriority(candidates);
    const aIndex = ordered.findIndex(c => c.lineId === 'a');
    const bIndex = ordered.findIndex(c => c.lineId === 'b');
    expect(aIndex).toBeLessThan(bIndex);
  });

  it('regression (real data, frame 1): REDRED beats Paradise of Rumors despite sitting inside the chart\'s dense long tail', () => {
    // Real reported values from the 2026-07-22 frame (songs mode). REDRED
    // (50,346, last active 2026-07-17) and Paradise of Rumors (49,895, last
    // active 2026-07-20) are 0.87px apart -- essentially an exact tie -- but
    // both sit inside a long run of other, unrelated songs (Boompala,
    // Viral, Catch Catch, ...) each only 3-17px away. Using the wide
    // MIN_GAP (18px) as the pile-up threshold swept several of those
    // meaningfully-different-valued neighbors into the same "cluster" as
    // the pair, misclassifying it as a large (>5) pile-up and flipping the
    // tie-break to recency. The default (tight) pileupGap keeps this a
    // clean 2-way value tie.
    const candidates = [
      candidate({ lineId: 'suddenly', y: 40, finalValue: 115936, lastActivityIdx: 57 }),
      candidate({ lineId: 'boompala', y: 145.07, finalValue: 61311, lastActivityIdx: 57 }),
      candidate({ lineId: 'lemon-tang', y: 148.85, finalValue: 59344, lastActivityIdx: 57 }),
      candidate({ lineId: 'do-your-dance', y: 149.09, finalValue: 59220, lastActivityIdx: 56 }),
      candidate({ lineId: 'viral', y: 153.6, finalValue: 56876, lastActivityIdx: 56 }),
      candidate({ lineId: 'redred', y: 166.16, finalValue: 50346, lastActivityIdx: 55 }),
      candidate({ lineId: 'paradise', y: 167.03, finalValue: 49895, lastActivityIdx: 57 }),
      candidate({ lineId: 'catch-catch', y: 180.34, finalValue: 42972, lastActivityIdx: 57 }),
      candidate({ lineId: 'wda', y: 183.66, finalValue: 41247, lastActivityIdx: 57 }),
      candidate({ lineId: 'rude', y: 189.92, finalValue: 37996, lastActivityIdx: 57 }),
      candidate({ lineId: 'joy-sorrow', y: 199.31, finalValue: 33111, lastActivityIdx: 57 }),
      candidate({ lineId: 'landing-in-love', y: 202.52, finalValue: 31443, lastActivityIdx: 57 }),
      candidate({ lineId: 'drowning', y: 203.53, finalValue: 30920, lastActivityIdx: 57 }),
      candidate({ lineId: 'run-to-you', y: 205.62, finalValue: 29829, lastActivityIdx: 57 }),
      candidate({ lineId: 'pretty-girl', y: 206.68, finalValue: 29279, lastActivityIdx: 57 }),
      candidate({ lineId: 'bang-bang', y: 207.49, finalValue: 28859, lastActivityIdx: 57 }),
      candidate({ lineId: '404', y: 210.04, finalValue: 27535, lastActivityIdx: 57 }),
      candidate({ lineId: 'love-attack', y: 210.31, finalValue: 27395, lastActivityIdx: 57 }),
    ];

    // No explicit pileupGap -- exercise the real default used in production.
    const ordered = orderLabelsByPriority(candidates);
    const redredIndex = ordered.findIndex(c => c.lineId === 'redred');
    const paradiseIndex = ordered.findIndex(c => c.lineId === 'paradise');
    expect(redredIndex).toBeLessThan(paradiseIndex);
  });

  it('regression (real data, frame 2): REDRED still beats Paradise of Rumors at a different animation frame\'s scale', () => {
    // Same real pair, captured from a second console dump at a slightly
    // different render scale (the chart's value->pixel mapping drifts a
    // little between animation frames). This is the exact data that broke
    // the mutual-clique fix when it used the wide MIN_GAP (18px): the
    // group {Boompala, Lemon Tang, Do Your Dance, Viral, REDRED, Paradise}
    // spanned just under 18px at this scale, forming a clique of 6 and
    // flipping the tie-break to recency even though REDRED/Paradise on
    // their own are still just a clean 2-way tie (0.63px apart).
    const candidates = [
      candidate({ lineId: 'suddenly', y: 40, finalValue: 115936, lastActivityIdx: 57 }),
      candidate({ lineId: 'boompala', y: 116.33, finalValue: 61311, lastActivityIdx: 57 }),
      candidate({ lineId: 'lemon-tang', y: 119.08, finalValue: 59344, lastActivityIdx: 57 }),
      candidate({ lineId: 'do-your-dance', y: 119.25, finalValue: 59220, lastActivityIdx: 56 }),
      candidate({ lineId: 'viral', y: 122.53, finalValue: 56876, lastActivityIdx: 56 }),
      candidate({ lineId: 'redred', y: 131.65, finalValue: 50346, lastActivityIdx: 55 }),
      candidate({ lineId: 'paradise', y: 132.28, finalValue: 49895, lastActivityIdx: 57 }),
      candidate({ lineId: 'catch-catch', y: 141.95, finalValue: 42972, lastActivityIdx: 57 }),
      candidate({ lineId: 'wda', y: 144.36, finalValue: 41247, lastActivityIdx: 57 }),
      candidate({ lineId: 'rude', y: 148.91, finalValue: 37996, lastActivityIdx: 57 }),
    ];

    const ordered = orderLabelsByPriority(candidates);
    const redredIndex = ordered.findIndex(c => c.lineId === 'redred');
    const paradiseIndex = ordered.findIndex(c => c.lineId === 'paradise');
    expect(redredIndex).toBeLessThan(paradiseIndex);
  });

  it('regression (real data, frame 3, isolated pair): an isolated 2-way tie must NOT be contaminated by an unrelated large pile-up elsewhere in the chart', () => {
    // Real values captured with nothing else within 30px of either REDRED
    // or Paradise of Rumors (a clean, isolated 2-way tie, 2.58px apart).
    // This is the bug a global per-pair-branching comparator produced: even
    // though this pair is genuinely isolated, REDRED still ranked 68 places
    // behind Paradise (76 vs 8) in the live app, because Array.prototype.sort
    // compared REDRED against unrelated candidates that WERE part of some
    // real pile-up elsewhere in the full 144-line dataset, tripping the
    // recency branch for those comparisons and sinking REDRED's rank for
    // reasons that had nothing to do with its own situation. A handful of
    // unrelated, distant, genuinely-packed candidates (a real pile-up of 6,
    // far away in Y) are included here to reproduce that exact shape.
    const candidates = [
      candidate({ lineId: 'suddenly', y: 40, finalValue: 115936, lastActivityIdx: 57 }),
      candidate({ lineId: 'redred', y: 414.52, finalValue: 50346, lastActivityIdx: 55 }),
      candidate({ lineId: 'paradise', y: 417.1, finalValue: 49895, lastActivityIdx: 57 }),
      // An unrelated, genuine pile-up far away in Y (span 2.5px, under the
      // default tight pileupGap, all mutually close), where recency
      // correctly overrides value -- but that must stay contained to this
      // group and not leak into REDRED's rank.
      candidate({ lineId: 'pileup-1', y: 900, finalValue: 600, lastActivityIdx: 5 }),
      candidate({ lineId: 'pileup-2', y: 900.5, finalValue: 500, lastActivityIdx: 5 }),
      candidate({ lineId: 'pileup-3', y: 901, finalValue: 400, lastActivityIdx: 5 }),
      candidate({ lineId: 'pileup-4', y: 901.5, finalValue: 300, lastActivityIdx: 90 }),
      candidate({ lineId: 'pileup-5', y: 902, finalValue: 200, lastActivityIdx: 5 }),
      candidate({ lineId: 'pileup-6', y: 902.5, finalValue: 100, lastActivityIdx: 5 }),
    ];

    const ordered = orderLabelsByPriority(candidates);
    const redredIndex = ordered.findIndex(c => c.lineId === 'redred');
    const paradiseIndex = ordered.findIndex(c => c.lineId === 'paradise');
    expect(redredIndex).toBeLessThan(paradiseIndex);
    // Sanity check: the unrelated pile-up's own recency override still works.
    const pileup4Index = ordered.findIndex(c => c.lineId === 'pileup-4');
    const pileup1Index = ordered.findIndex(c => c.lineId === 'pileup-1');
    expect(pileup4Index).toBeLessThan(pileup1Index);
  });

  it('a genuine near-tie is NOT treated as a large pile-up merely because it sits inside a long run of merely-adjacent, unrelated labels', () => {
    // "x" and "y" are 1px apart -- a genuine near-tie. They sit in the
    // middle of a chain where every adjacent pair is 15px apart (using a
    // wide, 18px pileupGap here to exercise the same failure mode the real
    // data hit): a transitive/chained algorithm would link the ENTIRE run
    // of 12 labels into one cluster (> 5), wrongly flipping x/y to
    // recency-based tie-breaking. The mutual-clique definition correctly
    // finds that x/y's own reachable clique tops out at 3 -- well under
    // the threshold -- so the larger value ("x") must still win.
    const candidates = [
      candidate({ lineId: 'n1', y: 0, finalValue: 10, lastActivityIdx: 1 }),
      candidate({ lineId: 'n2', y: 15, finalValue: 10, lastActivityIdx: 1 }),
      candidate({ lineId: 'n3', y: 30, finalValue: 10, lastActivityIdx: 1 }),
      candidate({ lineId: 'n4', y: 45, finalValue: 10, lastActivityIdx: 1 }),
      candidate({ lineId: 'n5', y: 60, finalValue: 10, lastActivityIdx: 1 }),
      candidate({ lineId: 'x', y: 75, finalValue: 50346, lastActivityIdx: 5 }),
      candidate({ lineId: 'y', y: 76, finalValue: 49895, lastActivityIdx: 50 }),
      candidate({ lineId: 'n6', y: 90, finalValue: 10, lastActivityIdx: 1 }),
      candidate({ lineId: 'n7', y: 105, finalValue: 10, lastActivityIdx: 1 }),
      candidate({ lineId: 'n8', y: 120, finalValue: 10, lastActivityIdx: 1 }),
      candidate({ lineId: 'n9', y: 135, finalValue: 10, lastActivityIdx: 1 }),
      candidate({ lineId: 'n10', y: 150, finalValue: 10, lastActivityIdx: 1 }),
      candidate({ lineId: 'top', y: -500, finalValue: 999999, lastActivityIdx: 0 }),
    ];

    const ordered = orderLabelsByPriority(candidates, 18);
    const xIndex = ordered.findIndex(c => c.lineId === 'x');
    const yIndex = ordered.findIndex(c => c.lineId === 'y');
    expect(xIndex).toBeLessThan(yIndex);
  });

  it('in a genuine large (>5) mutual clique, the most recently active line wins', () => {
    // Six entries spaced 3px apart -- the whole group's span is 15px, under
    // an 18px pileupGap, so every pair here is mutually within range of
    // each other: a true clique of size 6.
    const candidates = [
      candidate({ lineId: 'top', y: -1000, finalValue: 999999, lastActivityIdx: 0 }),
      candidate({ lineId: 'p1', y: 100, finalValue: 300, lastActivityIdx: 5 }),
      candidate({ lineId: 'p2', y: 103, finalValue: 250, lastActivityIdx: 5 }),
      candidate({ lineId: 'a', y: 106, finalValue: 500, lastActivityIdx: 10 }),
      candidate({ lineId: 'b', y: 109, finalValue: 100, lastActivityIdx: 90 }),
      candidate({ lineId: 'p3', y: 112, finalValue: 200, lastActivityIdx: 5 }),
      candidate({ lineId: 'p4', y: 115, finalValue: 150, lastActivityIdx: 5 }),
    ];

    const ordered = orderLabelsByPriority(candidates, 18);
    // "b" is far more recently active than "a" (and everything else in the
    // clique), so it must win despite having a much lower value.
    const aIndex = ordered.findIndex(c => c.lineId === 'a');
    const bIndex = ordered.findIndex(c => c.lineId === 'b');
    expect(bIndex).toBeLessThan(aIndex);
  });

  it('breaks recency ties in a large mutual clique using value descending', () => {
    const candidates = [
      candidate({ lineId: 'top', y: -1000, finalValue: 999999, lastActivityIdx: 0 }),
      candidate({ lineId: 'p1', y: 100, finalValue: 300, lastActivityIdx: 10 }),
      candidate({ lineId: 'a', y: 103, finalValue: 500, lastActivityIdx: 10 }),
      candidate({ lineId: 'b', y: 106, finalValue: 100, lastActivityIdx: 10 }),
      candidate({ lineId: 'p3', y: 109, finalValue: 200, lastActivityIdx: 10 }),
      candidate({ lineId: 'p4', y: 112, finalValue: 150, lastActivityIdx: 10 }),
      candidate({ lineId: 'p5', y: 115, finalValue: 120, lastActivityIdx: 10 }),
    ];

    const ordered = orderLabelsByPriority(candidates, 18);
    const aIndex = ordered.findIndex(c => c.lineId === 'a');
    const bIndex = ordered.findIndex(c => c.lineId === 'b');
    // All tied on recency, so higher value ("a") must win over "b".
    expect(aIndex).toBeLessThan(bIndex);
  });

  it('with the default (tight) pileupGap, a real pile-up needs lines within a couple pixels, not a whole label-height', () => {
    // The same six-entry clique from the ">5 mutual clique" test (3px
    // apart, span 15px) is NOT a pile-up under the tighter production
    // default -- it only becomes one under a wide 18px pileupGap. This
    // documents the intentional gap between MIN_GAP (label placement) and
    // the default pileupGap (tie-break pile-up detection).
    const candidates = [
      candidate({ lineId: 'top', y: -1000, finalValue: 999999, lastActivityIdx: 0 }),
      candidate({ lineId: 'p1', y: 100, finalValue: 300, lastActivityIdx: 5 }),
      candidate({ lineId: 'p2', y: 103, finalValue: 250, lastActivityIdx: 5 }),
      candidate({ lineId: 'a', y: 106, finalValue: 500, lastActivityIdx: 10 }),
      candidate({ lineId: 'b', y: 109, finalValue: 100, lastActivityIdx: 90 }),
      candidate({ lineId: 'p3', y: 112, finalValue: 200, lastActivityIdx: 5 }),
      candidate({ lineId: 'p4', y: 115, finalValue: 150, lastActivityIdx: 5 }),
    ];

    const ordered = orderLabelsByPriority(candidates); // default pileupGap
    // "a" has the largest value; with the tight default, this group isn't
    // dense enough to count as a pile-up, so value wins and "a" beats "b".
    const aIndex = ordered.findIndex(c => c.lineId === 'a');
    const bIndex = ordered.findIndex(c => c.lineId === 'b');
    expect(aIndex).toBeLessThan(bIndex);
  });

  it('returns an empty array for no candidates', () => {
    expect(orderLabelsByPriority([])).toEqual([]);
  });

  it('pins the given line to the top slot, above #1', () => {
    const candidates = [
      candidate({ lineId: 'top', y: 0, finalValue: 1000, lastActivityIdx: 99 }),
      candidate({ lineId: 'pinned', y: 500, finalValue: 5, lastActivityIdx: 0 }),
      candidate({ lineId: 'mid', y: 200, finalValue: 300, lastActivityIdx: 10 }),
    ];

    const ordered = orderLabelsByPriority(candidates, undefined, 'pinned');
    expect(ordered[0].lineId).toBe('pinned');
  });

  it('leaves #1 first when no pinned line is given', () => {
    const candidates = [
      candidate({ lineId: 'top', y: 0, finalValue: 1000, lastActivityIdx: 99 }),
      candidate({ lineId: 'other', y: 500, finalValue: 5, lastActivityIdx: 0 }),
    ];

    const ordered = orderLabelsByPriority(candidates);
    expect(ordered[0].lineId).toBe('top');
  });

  it('is a no-op when the pinned line id is not among the candidates', () => {
    const candidates = [
      candidate({ lineId: 'top', y: 0, finalValue: 1000, lastActivityIdx: 99 }),
      candidate({ lineId: 'other', y: 500, finalValue: 5, lastActivityIdx: 0 }),
    ];

    const ordered = orderLabelsByPriority(candidates, undefined, 'nonexistent');
    expect(ordered[0].lineId).toBe('top');
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
