import { randomUUID } from 'node:crypto';

const MAX_PENDING_TOKENS = 100;
const TOKEN_TTL_MS = 60_000;
const SWEEP_INTERVAL_MS = 30_000;

interface PendingToken {
  token: string;
  expiresAt: number;
  used: boolean;
}

export class DeleteGuard {
  private readonly pending = new Map<string, PendingToken>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // Don't block process exit
    this.sweepTimer.unref();
  }

  requestConfirmation(
    entityType: string,
    entityId: string,
    summary: string,
  ): { confirmation_required: true; confirmation_token: string; summary: string } {
    const token = randomUUID();
    const entry: PendingToken = {
      token,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      used: false,
    };

    // Evict oldest entry if at capacity
    if (this.pending.size >= MAX_PENDING_TOKENS) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [key, val] of this.pending) {
        if (val.expiresAt < oldestTime) {
          oldestTime = val.expiresAt;
          oldestKey = key;
        }
      }
      if (oldestKey !== undefined) {
        this.pending.delete(oldestKey);
      }
    }

    this.pending.set(token, entry);

    return {
      confirmation_required: true,
      confirmation_token: token,
      summary: `[${entityType}:${entityId}] ${summary}`,
    };
  }

  confirm(token: string): boolean {
    const entry = this.pending.get(token);

    if (!entry) {
      return false;
    }

    if (entry.used) {
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      this.pending.delete(token);
      return false;
    }

    // Mark as used (single-use)
    entry.used = true;
    return true;
  }

  destroy(): void {
    clearInterval(this.sweepTimer);
    this.pending.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.pending) {
      if (now > entry.expiresAt) {
        this.pending.delete(key);
      }
    }
  }
}
