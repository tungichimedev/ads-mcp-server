import { z } from 'zod';

const AUTHORIZE_BASE = 'https://business-api.tiktok.com/portal/auth';
const TOKEN_URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/';

export interface TokenExchangeResult {
  accessToken: string;
  scope: (string | number)[];
  advertiserIds: string[];
}

const ExchangeResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z
    .object({
      access_token: z.string().optional(),
      scope: z.array(z.union([z.string(), z.number()])).optional(),
      advertiser_ids: z.array(z.string()).optional(),
    })
    .optional(),
});

/** Builds the TikTok portal authorize URL. Scopes are enabled on the app, not passed here. */
export function buildAuthorizeUrl(appId: string, state: string, redirectUri: string): string {
  const url = new URL(AUTHORIZE_BASE);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);
  return url.toString();
}

/** Exchanges an auth_code for an access token + the list of granted advertiser ids. */
export async function exchangeAuthCode(
  fetchFn: typeof globalThis.fetch,
  appId: string,
  secret: string,
  authCode: string,
): Promise<TokenExchangeResult> {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, secret, auth_code: authCode }),
  });

  const parsed = ExchangeResponseSchema.parse(await res.json());

  if (parsed.code !== 0) {
    throw new Error(`TikTok token exchange failed (code ${parsed.code}): ${parsed.message}`);
  }
  if (!parsed.data?.access_token) {
    throw new Error('TikTok token exchange returned no access_token (unexpected response shape).');
  }

  return {
    accessToken: parsed.data.access_token,
    scope: parsed.data.scope ?? [],
    advertiserIds: parsed.data.advertiser_ids ?? [],
  };
}
