import type { TokenManager } from '../../auth/token-manager.js';

const META_GRAPH_API = 'https://graph.facebook.com/v21.0';

/**
 * Registers a Meta refresh handler on the TokenManager.
 *
 * Meta issues long-lived tokens that last ~60 days and cannot be refreshed
 * programmatically. When a token has expired the user must re-run
 * `ads-mcp setup` to supply a new long-lived token.
 */
export function registerMetaRefreshHandler(tokenManager: TokenManager): void {
  tokenManager.setRefreshHandler('meta', async (account) => {
    throw new Error(
      `Meta token for account '${account}' has expired. Run 'ads-mcp setup' to provide a new long-lived token.`
    );
  });
}

/**
 * Builds a fully-qualified Meta Graph API URL for the given path.
 *
 * @example metaApiUrl('/me/adaccounts') // 'https://graph.facebook.com/v21.0/me/adaccounts'
 */
export function metaApiUrl(path: string): string {
  return `${META_GRAPH_API}${path}`;
}
