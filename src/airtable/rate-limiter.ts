/**
 * Token-bucket rate limiter: max 5 tokens per 1-second window.
 * Callers await acquire() before each HTTP request.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;
  private readonly queue: Array<() => void> = [];
  private drainScheduled: boolean = false;

  constructor(maxTokens: number = 5, refillIntervalMs: number = 1000) {
    this.maxTokens = maxTokens;
    this.refillIntervalMs = refillIntervalMs;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  /** Wait until a token is available, then consume it. */
  acquire(): Promise<void> {
    this.refill();

    if (this.tokens > 0) {
      this.tokens--;
      return Promise.resolve();
    }

    // No tokens available — queue the caller and schedule a drain
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.scheduleDrain();
    });
  }

  /** Schedule a single drain attempt for the next refill window. */
  private scheduleDrain(): void {
    if (this.drainScheduled) {
      return;
    }
    this.drainScheduled = true;

    const elapsed = Date.now() - this.lastRefill;
    const waitMs = Math.max(this.refillIntervalMs - elapsed, 0);

    setTimeout(() => {
      this.drainScheduled = false;
      this.refill();

      // Release up to maxTokens queued callers
      while (this.tokens > 0 && this.queue.length > 0) {
        this.tokens--;
        const resolve = this.queue.shift()!;
        resolve();
      }

      // If there are still callers waiting, schedule another drain
      if (this.queue.length > 0) {
        this.scheduleDrain();
      }
    }, waitMs);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed >= this.refillIntervalMs) {
      // Calculate how many full intervals have passed
      const intervals = Math.floor(elapsed / this.refillIntervalMs);
      this.tokens = this.maxTokens;
      this.lastRefill = this.lastRefill + intervals * this.refillIntervalMs;
    }
  }
}
