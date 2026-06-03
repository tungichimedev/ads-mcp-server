import type { TokenManager } from '../../auth/token-manager.js';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

/**
 * Registers a TikTok refresh handler on the TokenManager.
 *
 * TikTok access tokens cannot be refreshed programmatically — they expire
 * and require the user to re-authorize via the TikTok Business API OAuth flow.
 * When a token has expired the user must re-run `ads-mcp setup` to supply a
 * new access token.
 */
export function registerTikTokRefreshHandler(tokenManager: TokenManager): void {
  tokenManager.setRefreshHandler('tiktok', async (account: string) => {
    throw new Error(
      `TikTok token for account '${account}' has expired. ` +
      `TikTok requires manual re-authorization. Run 'ads-mcp setup' to provide a new access token.`
    );
  });
}

/**
 * Builds a fully-qualified TikTok Business API URL for the given path.
 *
 * @example tiktokApiUrl('/campaign/get/') // 'https://business-api.tiktok.com/open_api/v1.3/campaign/get/'
 */
export function tiktokApiUrl(path: string): string {
  return `${TIKTOK_API_BASE}${path}`;
}
