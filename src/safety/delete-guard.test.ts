import { describe, it, expect, afterEach } from 'vitest';
import { DeleteGuard } from './delete-guard.js';

describe('DeleteGuard', () => {
  let guard: DeleteGuard;

  afterEach(() => {
    guard.destroy();
  });

  it('creates a confirmation token', () => {
    guard = new DeleteGuard();
    const result = guard.requestConfirmation('campaign', 'camp-123', 'Delete summer sale campaign');
    expect(result.confirmation_required).toBe(true);
    expect(typeof result.confirmation_token).toBe('string');
    expect(result.confirmation_token.length).toBeGreaterThan(0);
    expect(result.summary).toContain('campaign:camp-123');
    expect(result.summary).toContain('Delete summer sale campaign');
  });

  it('confirms with a valid token', () => {
    guard = new DeleteGuard();
    const { confirmation_token } = guard.requestConfirmation('adset', 'adset-456', 'Delete adset');
    expect(guard.confirm(confirmation_token)).toBe(true);
  });

  it('rejects a used token (single-use)', () => {
    guard = new DeleteGuard();
    const { confirmation_token } = guard.requestConfirmation('ad', 'ad-789', 'Delete ad');
    // First use — valid
    expect(guard.confirm(confirmation_token)).toBe(true);
    // Second use — must be rejected
    expect(guard.confirm(confirmation_token)).toBe(false);
  });

  it('rejects an invalid/unknown token', () => {
    guard = new DeleteGuard();
    expect(guard.confirm('non-existent-token-xyz')).toBe(false);
  });

  it('rejects an expired token', async () => {
    // Create a guard-like object with a very short TTL by mocking Date.now
    guard = new DeleteGuard();
    const { confirmation_token } = guard.requestConfirmation('campaign', 'c1', 'Expire test');

    // Manipulate the internal pending map to set expiry in the past
    // Access private map via type casting for testing purposes
    const internal = guard as unknown as { pending: Map<string, { token: string; expiresAt: number; used: boolean }> };
    const entry = internal.pending.get(confirmation_token);
    expect(entry).toBeDefined();
    entry!.expiresAt = Date.now() - 1; // Already expired

    expect(guard.confirm(confirmation_token)).toBe(false);
  });

  it('evicts the oldest token when exceeding 100 tokens', () => {
    guard = new DeleteGuard();

    // Fill to capacity (100 tokens), recording the first token
    let firstToken = '';
    for (let i = 0; i < 100; i++) {
      const result = guard.requestConfirmation('campaign', `id-${i}`, `Delete ${i}`);
      if (i === 0) {
        firstToken = result.confirmation_token;
        // Ensure the first token has the oldest expiresAt by backdating it
        const internal = guard as unknown as { pending: Map<string, { token: string; expiresAt: number; used: boolean }> };
        const entry = internal.pending.get(firstToken);
        entry!.expiresAt = Date.now() - 1000; // Make it the oldest
      }
    }

    // Verify the first token still exists before the 101st
    const internal = guard as unknown as { pending: Map<string, { token: string; expiresAt: number; used: boolean }> };
    expect(internal.pending.has(firstToken)).toBe(true);

    // Add the 101st token — should evict the oldest (first token)
    guard.requestConfirmation('campaign', 'id-100', 'Delete 100');

    // The oldest (first) token should have been evicted
    expect(internal.pending.has(firstToken)).toBe(false);
    // Total should remain at 100
    expect(internal.pending.size).toBe(100);
  });
});
