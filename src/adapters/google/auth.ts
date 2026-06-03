import type { TokenManager } from '../../auth/token-manager.js';
import type { KeychainProvider } from '../../auth/keychain.js';

const SERVICE = 'ads-mcp';

/**
 * Registers the Google token refresh handler.
 * Google uses refresh tokens to get short-lived access tokens (~1 hour).
 * googleapis handles this automatically via OAuth2 client.
 */
export function registerGoogleRefreshHandler(tokenManager: TokenManager): void {
  tokenManager.setRefreshHandler('google', async (account: string) => {
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    return { token: 'google-oauth-managed', expiresAt };
  });
}

/**
 * Gets the developer token for Google Ads API access.
 */
export async function getDeveloperToken(
  keychain: KeychainProvider,
  account: string,
): Promise<string> {
  const devToken = await keychain.getPassword(SERVICE, `google:${account}:developer_token`);
  if (!devToken) {
    throw new Error(`Google Ads developer token missing for account '${account}'. Run 'ads-mcp setup'.`);
  }
  return devToken;
}
