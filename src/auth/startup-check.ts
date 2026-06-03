import type { AdsConfig } from '../utils/config.js';
import { getKeychainProvider } from './keychain.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlatformStatus {
  platform: string;
  status: 'available' | 'unavailable';
  accounts: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// checkPlatforms
// ---------------------------------------------------------------------------

/**
 * Iterates all platforms declared in config and checks whether credentials
 * exist in the keychain for each declared account.
 *
 * A platform is reported as 'available' when at least one account has a
 * stored token.  Individual missing-account errors are surfaced in `error`.
 */
export async function checkPlatforms(config: AdsConfig): Promise<PlatformStatus[]> {
  const results: PlatformStatus[] = [];

  const platforms = config.platforms ?? {};

  for (const [platform, platformCfg] of Object.entries(platforms)) {
    const accountNames = Object.keys(platformCfg.accounts ?? {});
    const availableAccounts: string[] = [];
    const errors: string[] = [];

    for (const account of accountNames) {
      try {
        const keychain = getKeychainProvider();
        const token = await keychain.getPassword('ads-mcp', `${platform}:${account}`);
        if (token) {
          availableAccounts.push(account);
        } else {
          errors.push(`No token found for account '${account}'`);
        }
      } catch (err: unknown) {
        errors.push(
          `Error checking account '${account}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    results.push({
      platform,
      status: availableAccounts.length > 0 ? 'available' : 'unavailable',
      accounts: availableAccounts,
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    });
  }

  return results;
}
