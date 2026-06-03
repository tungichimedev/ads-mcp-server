import { describe, it, expect, vi } from 'vitest';
import { registerTikTokRefreshHandler, tiktokApiUrl } from './auth.js';
import type { TokenManager } from '../../auth/token-manager.js';

// ─── registerTikTokRefreshHandler ─────────────────────────────────────────────

describe('registerTikTokRefreshHandler', () => {
  it('registers a handler for the tiktok platform', () => {
    const setRefreshHandler = vi.fn();
    const tokenManager = { setRefreshHandler } as unknown as TokenManager;

    registerTikTokRefreshHandler(tokenManager);

    expect(setRefreshHandler).toHaveBeenCalledOnce();
    expect(setRefreshHandler).toHaveBeenCalledWith('tiktok', expect.any(Function));
  });

  it('registered handler throws with "manual re-authorization" in the message', async () => {
    let capturedHandler: ((account: string) => Promise<unknown>) | undefined;

    const setRefreshHandler = vi.fn((platform: string, handler: (account: string) => Promise<unknown>) => {
      capturedHandler = handler;
    });
    const tokenManager = { setRefreshHandler } as unknown as TokenManager;

    registerTikTokRefreshHandler(tokenManager);

    expect(capturedHandler).toBeDefined();
    await expect(capturedHandler!('test-account')).rejects.toThrow('manual re-authorization');
  });

  it('registered handler throws with the account name in the message', async () => {
    let capturedHandler: ((account: string) => Promise<unknown>) | undefined;

    const setRefreshHandler = vi.fn((platform: string, handler: (account: string) => Promise<unknown>) => {
      capturedHandler = handler;
    });
    const tokenManager = { setRefreshHandler } as unknown as TokenManager;

    registerTikTokRefreshHandler(tokenManager);

    await expect(capturedHandler!('my-tiktok-account')).rejects.toThrow("my-tiktok-account");
  });

  it('registered handler throws with "ads-mcp setup" guidance', async () => {
    let capturedHandler: ((account: string) => Promise<unknown>) | undefined;

    const setRefreshHandler = vi.fn((platform: string, handler: (account: string) => Promise<unknown>) => {
      capturedHandler = handler;
    });
    const tokenManager = { setRefreshHandler } as unknown as TokenManager;

    registerTikTokRefreshHandler(tokenManager);

    await expect(capturedHandler!('acct')).rejects.toThrow("ads-mcp setup");
  });
});

// ─── tiktokApiUrl ─────────────────────────────────────────────────────────────

describe('tiktokApiUrl', () => {
  it('prepends the TikTok Business API base URL', () => {
    const url = tiktokApiUrl('/campaign/get/');
    expect(url).toBe('https://business-api.tiktok.com/open_api/v1.3/campaign/get/');
  });

  it('handles paths without a leading slash gracefully (concatenates directly)', () => {
    const url = tiktokApiUrl('/advertiser/info/');
    expect(url).toContain('https://business-api.tiktok.com/open_api/v1.3');
    expect(url).toContain('/advertiser/info/');
  });

  it('returns a string starting with https://', () => {
    const url = tiktokApiUrl('/report/integrated/get/');
    expect(url.startsWith('https://')).toBe(true);
  });

  it('includes the v1.3 version segment', () => {
    const url = tiktokApiUrl('/ad/get/');
    expect(url).toContain('v1.3');
  });
});
