import { describe, it, expect } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('serializes requests for the same platform:account', async () => {
    const limiter = new RateLimiter();
    const order: number[] = [];

    // Task 1: takes 50ms then records 1
    const task1 = limiter.execute('meta', 'brand_a', async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
      return 1;
    });

    // Task 2: takes 0ms but queued behind task1
    const task2 = limiter.execute('meta', 'brand_a', async () => {
      order.push(2);
      return 2;
    });

    await Promise.all([task1, task2]);

    expect(order).toEqual([1, 2]);
  });

  it('allows parallel requests for different accounts', async () => {
    const limiter = new RateLimiter();
    const order: string[] = [];

    // brand_a takes 80ms
    const taskA = limiter.execute('meta', 'brand_a', async () => {
      await new Promise((r) => setTimeout(r, 80));
      order.push('brand_a');
      return 'a';
    });

    // brand_b takes 10ms — should finish first since it runs in parallel
    const taskB = limiter.execute('meta', 'brand_b', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('brand_b');
      return 'b';
    });

    await Promise.all([taskA, taskB]);

    // brand_b finishes before brand_a
    expect(order[0]).toBe('brand_b');
    expect(order[1]).toBe('brand_a');
  });

  it('returns the value from the executed function', async () => {
    const limiter = new RateLimiter();
    const result = await limiter.execute('google', 'acct1', async () => 42);
    expect(result).toBe(42);
  });
});
