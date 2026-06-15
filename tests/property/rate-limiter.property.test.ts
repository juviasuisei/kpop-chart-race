// Feature: airtable-data-layer, Property 3: Rate limiter throughput constraint

import fc from 'fast-check';
import { test } from '@fast-check/vitest';
import { RateLimiter } from '../../src/airtable/rate-limiter.ts';

// ============================================================
// Property 3: Rate limiter throughput constraint
// **Validates: Requirements 3.1, 3.2**
//
// For any batch of N concurrent acquire() calls (where N > 5),
// the elapsed time from the first call resolving to the last call
// resolving SHALL be at least Math.floor((N - 5) / 5) * 1000 ms,
// ensuring no more than 5 tokens are consumed per 1-second window.
// ============================================================

describe('Property 3: Rate limiter throughput constraint', () => {
  test.prop([fc.integer({ min: 6, max: 30 })], { numRuns: 100 })(
    'elapsed time from first resolve to last resolve is at least Math.floor((N - 5) / 5) * 1000 ms',
    async (n) => {
      vi.useFakeTimers();

      try {
        const limiter = new RateLimiter();
        const resolveTimes: number[] = [];

        // Launch N concurrent acquire() calls
        const promises = Array.from({ length: n }, () =>
          limiter.acquire().then(() => {
            resolveTimes.push(Date.now());
          }),
        );

        // Advance timers in increments to allow setTimeout callbacks to fire
        const maxWaitMs = Math.ceil(n / 5) * 1000 + 1000;
        for (let elapsed = 0; elapsed < maxWaitMs; elapsed += 100) {
          await vi.advanceTimersByTimeAsync(100);
        }

        await Promise.all(promises);

        // All N calls must have resolved
        expect(resolveTimes.length).toBe(n);

        const firstResolve = Math.min(...resolveTimes);
        const lastResolve = Math.max(...resolveTimes);
        const elapsedMs = lastResolve - firstResolve;

        const minimumExpectedMs = Math.floor((n - 5) / 5) * 1000;

        expect(elapsedMs).toBeGreaterThanOrEqual(minimumExpectedMs);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
