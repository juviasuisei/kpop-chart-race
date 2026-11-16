import { getLabelCandidateCommands } from '../../src/views/line-chart-controller.ts';
import type { LineDrawCommand } from '../../src/worker/messages.ts';

// The label ordering rules moved to src/label-priority.ts (see
// tests/unit/label-priority.test.ts); this file covers candidate selection.

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
