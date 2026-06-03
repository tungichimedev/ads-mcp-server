import PQueue from 'p-queue';

const TOOL_TIMEOUT_MS = 60_000;

export class RateLimiter {
  private queues = new Map<string, PQueue>();

  private getOrCreateQueue(platform: string, account: string): PQueue {
    const key = `${platform}:${account}`;
    if (!this.queues.has(key)) {
      this.queues.set(key, new PQueue({ concurrency: 1, timeout: TOOL_TIMEOUT_MS }));
    }
    return this.queues.get(key)!;
  }

  async execute<T>(platform: string, account: string, fn: () => Promise<T>): Promise<T> {
    const queue = this.getOrCreateQueue(platform, account);
    const result = await queue.add(fn);
    return result as T;
  }
}
