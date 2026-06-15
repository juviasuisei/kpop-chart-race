import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../../src/airtable/rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to maxTokens (5) immediate calls without delay', async () => {
    const limiter = new RateLimiter();
    const results: number[] = [];

    for (let i = 0; i < 5; i++) {
      await limiter.acquire();
      results.push(i);
    }

    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it('delays the 6th call until the next window', async () => {
    const limiter = new RateLimiter();
    let sixthResolved = false;

    // Consume all 5 tokens
    for (let i = 0; i < 5; i++) {
      await limiter.acquire();
    }

    // 6th call should be delayed
    const sixthPromise = limiter.acquire().then(() => {
      sixthResolved = true;
    });

    // Should not have resolved yet
    expect(sixthResolved).toBe(false);

    // Advance time to next window
    await vi.advanceTimersByTimeAsync(1000);

    await sixthPromise;
    expect(sixthResolved).toBe(true);
  });

  it('respects custom token count', async () => {
    const limiter = new RateLimiter(3, 1000);
    const results: number[] = [];

    // 3 calls should be immediate
    for (let i = 0; i < 3; i++) {
      await limiter.acquire();
      results.push(i);
    }

    expect(results).toEqual([0, 1, 2]);

    // 4th call should be delayed
    let fourthResolved = false;
    const fourthPromise = limiter.acquire().then(() => {
      fourthResolved = true;
    });

    expect(fourthResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await fourthPromise;
    expect(fourthResolved).toBe(true);
  });

  it('respects custom refill interval', async () => {
    const limiter = new RateLimiter(2, 500);

    // Consume both tokens
    await limiter.acquire();
    await limiter.acquire();

    let resolved = false;
    const promise = limiter.acquire().then(() => {
      resolved = true;
    });

    // At 400ms, should not yet be resolved
    await vi.advanceTimersByTimeAsync(400);
    expect(resolved).toBe(false);

    // At 500ms, should resolve
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    expect(resolved).toBe(true);
  });

  it('refills tokens after window elapses', async () => {
    const limiter = new RateLimiter(5, 1000);

    // Use all tokens
    for (let i = 0; i < 5; i++) {
      await limiter.acquire();
    }

    // Advance past one full window
    await vi.advanceTimersByTimeAsync(1000);

    // Should be able to acquire 5 more immediately
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      await limiter.acquire();
      results.push(i);
    }

    expect(results).toEqual([0, 1, 2, 3, 4]);
  });
});
