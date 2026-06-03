import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenManager } from './token-manager.js';
import type { KeychainProvider } from './keychain.js';

// ---------------------------------------------------------------------------
// Mock keychain factory
// ---------------------------------------------------------------------------

function makeMockKeychain(initial: Record<string, string> = {}): KeychainProvider {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getPassword: vi.fn(async (_service: string, account: string) => store.get(account) ?? null),
    setPassword: vi.fn(async (_service: string, account: string, password: string) => {
      store.set(account, password);
    }),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO string for N minutes from now */
function expiresInMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TokenManager', () => {
  describe('getToken — returns stored token when not expired', () => {
    it('returns the stored token directly without calling the refresh handler', async () => {
      const futureExpiry = expiresInMs(60 * 60 * 1000); // 1 hour from now

      // Pre-populate keychain with a valid token + expiry
      const keychain = makeMockKeychain({
        'meta:brand_a': 'stored-token-xyz',
        'meta:brand_a:expires': futureExpiry,
      });

      const manager = new TokenManager(keychain);
      const refreshHandler = vi.fn();
      manager.setRefreshHandler('meta', refreshHandler);

      const token = await manager.getToken('meta', 'brand_a');

      expect(token).toBe('stored-token-xyz');
      // Handler must NOT have been called
      expect(refreshHandler).not.toHaveBeenCalled();
    });

    it('calls the refresh handler when the token has expired', async () => {
      const pastExpiry = expiresInMs(-10 * 60 * 1000); // 10 minutes ago

      const keychain = makeMockKeychain({
        'meta:brand_a': 'old-token',
        'meta:brand_a:expires': pastExpiry,
      });

      const manager = new TokenManager(keychain);
      const newExpiry = expiresInMs(60 * 60 * 1000);
      const refreshHandler = vi.fn().mockResolvedValue({
        token: 'new-token-abc',
        expiresAt: newExpiry,
      });
      manager.setRefreshHandler('meta', refreshHandler);

      const token = await manager.getToken('meta', 'brand_a');

      expect(token).toBe('new-token-abc');
      expect(refreshHandler).toHaveBeenCalledOnce();
      expect(refreshHandler).toHaveBeenCalledWith('brand_a');
    });
  });

  describe('getToken — coalesces concurrent refresh calls', () => {
    it('triggers only one refresh when two parallel getToken calls race on an expired token', async () => {
      const pastExpiry = expiresInMs(-10 * 60 * 1000);

      const keychain = makeMockKeychain({
        'meta:brand_b': 'old-token',
        'meta:brand_b:expires': pastExpiry,
      });

      const manager = new TokenManager(keychain);

      let refreshCount = 0;
      const newExpiry = expiresInMs(60 * 60 * 1000);

      const refreshHandler = vi.fn(async (_account: string) => {
        refreshCount++;
        // Simulate async work
        await new Promise((r) => setTimeout(r, 20));
        return { token: `refreshed-token-${refreshCount}`, expiresAt: newExpiry };
      });

      manager.setRefreshHandler('meta', refreshHandler);

      // Fire two concurrent requests — they should share one refresh
      const [token1, token2] = await Promise.all([
        manager.getToken('meta', 'brand_b'),
        manager.getToken('meta', 'brand_b'),
      ]);

      // Both calls must have received a token
      expect(token1).toBeTruthy();
      expect(token2).toBeTruthy();

      // Both must return the SAME token (coalesced)
      expect(token1).toBe(token2);

      // Refresh handler invoked exactly once
      expect(refreshHandler).toHaveBeenCalledOnce();
      expect(refreshCount).toBe(1);
    });
  });

  describe('credentialFingerprint', () => {
    it('returns sha256: prefix with 8-char hex digest', async () => {
      const keychain = makeMockKeychain({ 'meta:acct1': 'super-secret-token' });
      const manager = new TokenManager(keychain);

      const fp = await manager.credentialFingerprint('meta', 'acct1');

      expect(fp).toMatch(/^sha256:[0-9a-f]{8}$/);
    });

    it('throws when no token is stored', async () => {
      const keychain = makeMockKeychain();
      const manager = new TokenManager(keychain);

      await expect(manager.credentialFingerprint('meta', 'missing')).rejects.toThrow(
        'No token stored',
      );
    });
  });
});
