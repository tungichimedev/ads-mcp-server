import { describe, it, expect, vi } from 'vitest';
import { registerGoogleRefreshHandler, getDeveloperToken } from './auth.js';
import type { TokenManager } from '../../auth/token-manager.js';
import type { KeychainProvider } from '../../auth/keychain.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockTokenManager(): {
  manager: TokenManager;
  setRefreshHandlerSpy: ReturnType<typeof vi.fn>;
  capturedHandler: ((account: string) => Promise<{ token: string; expiresAt: string }>) | null;
} {
  let capturedHandler: ((account: string) => Promise<{ token: string; expiresAt: string }>) | null = null;
  const setRefreshHandlerSpy = vi.fn((platform: string, handler: (account: string) => Promise<{ token: string; expiresAt: string }>) => {
    capturedHandler = handler;
  });

  const manager = {
    setRefreshHandler: setRefreshHandlerSpy,
  } as unknown as TokenManager;

  return { manager, setRefreshHandlerSpy, get capturedHandler() { return capturedHandler; } };
}

function makeMockKeychain(initial: Record<string, string> = {}): KeychainProvider {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getPassword: vi.fn(async (_service: string, account: string) => store.get(account) ?? null),
    setPassword: vi.fn(async (_service: string, account: string, password: string) => {
      store.set(account, password);
    }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('registerGoogleRefreshHandler', () => {
  it('calls setRefreshHandler with platform "google"', () => {
    const { manager, setRefreshHandlerSpy } = makeMockTokenManager();
    registerGoogleRefreshHandler(manager);
    expect(setRefreshHandlerSpy).toHaveBeenCalledOnce();
    expect(setRefreshHandlerSpy.mock.calls[0][0]).toBe('google');
  });

  it('registers a handler function (not null/undefined)', () => {
    const { manager, setRefreshHandlerSpy } = makeMockTokenManager();
    registerGoogleRefreshHandler(manager);
    const registeredHandler = setRefreshHandlerSpy.mock.calls[0][1];
    expect(typeof registeredHandler).toBe('function');
  });

  it('the registered handler returns a token and a future expiresAt', async () => {
    const { manager, setRefreshHandlerSpy } = makeMockTokenManager();
    registerGoogleRefreshHandler(manager);
    const handler = setRefreshHandlerSpy.mock.calls[0][1] as (account: string) => Promise<{ token: string; expiresAt: string }>;

    const before = Date.now();
    const result = await handler('test-account');
    const after = Date.now();

    expect(result.token).toBe('google-oauth-managed');
    expect(typeof result.expiresAt).toBe('string');
    // expiresAt should be ~1 hour in the future
    const expiresMs = new Date(result.expiresAt).getTime();
    expect(expiresMs).toBeGreaterThan(before + 3500 * 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + 3600 * 1000 + 100);
  });
});

describe('getDeveloperToken', () => {
  it('returns the developer token when present in keychain', async () => {
    const keychain = makeMockKeychain({
      'google:my-account:developer_token': 'dev-token-abc123',
    });
    const token = await getDeveloperToken(keychain, 'my-account');
    expect(token).toBe('dev-token-abc123');
  });

  it('throws a helpful error when developer token is missing', async () => {
    const keychain = makeMockKeychain({});
    await expect(getDeveloperToken(keychain, 'missing-account')).rejects.toThrow(
      "Google Ads developer token missing for account 'missing-account'. Run 'ads-mcp setup'.",
    );
  });

  it('looks up keychain with service "ads-mcp" and correct account key', async () => {
    const keychain = makeMockKeychain({
      'google:acct-x:developer_token': 'token-xyz',
    });
    const getPasswordSpy = keychain.getPassword as ReturnType<typeof vi.fn>;
    await getDeveloperToken(keychain, 'acct-x');
    expect(getPasswordSpy).toHaveBeenCalledWith('ads-mcp', 'google:acct-x:developer_token');
  });
});
