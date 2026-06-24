import { vi } from 'vitest';
import { buildAuthorizeUrl, exchangeAuthCode } from './tiktok-oauth.js';

describe('buildAuthorizeUrl', () => {
  it('includes app_id, state, and redirect_uri', () => {
    const url = buildAuthorizeUrl('app123', 'nonce456', 'https://example.com/cb');
    expect(url).toContain('https://business-api.tiktok.com/portal/auth?');
    expect(url).toContain('app_id=app123');
    expect(url).toContain('state=nonce456');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcb');
  });
});

describe('exchangeAuthCode', () => {
  it('posts credentials and returns parsed token + advertiser ids', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      message: 'OK',
      data: { access_token: 'tok_new', scope: [4, 5], advertiser_ids: ['111', '222'] },
    }), { status: 200 })) as unknown as typeof globalThis.fetch;

    const result = await exchangeAuthCode(fetchFn, 'app123', 'secretXYZ', 'authABC');

    expect(result.accessToken).toBe('tok_new');
    expect(result.advertiserIds).toEqual(['111', '222']);
    expect(result.scope).toEqual([4, 5]);

    const call = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/');
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({ app_id: 'app123', secret: 'secretXYZ', auth_code: 'authABC' });
  });

  it('throws with the TikTok message when code is non-zero', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      code: 40105, message: 'Auth code is invalid or expired', data: {},
    }), { status: 200 })) as unknown as typeof globalThis.fetch;

    await expect(exchangeAuthCode(fetchFn, 'a', 's', 'bad'))
      .rejects.toThrow(/Auth code is invalid or expired/);
  });
});
