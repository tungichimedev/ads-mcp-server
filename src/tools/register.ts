import type { BaseAdapter } from '../adapters/base.js';
import type { RateLimiter } from '../utils/rate-limiter.js';
import type { AuditLog } from '../utils/audit-log.js';
import type { TokenManager } from '../auth/token-manager.js';
import type { DeleteGuard } from '../safety/delete-guard.js';
import type { AdsConfig } from '../utils/config.js';
import { AdsError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// ToolContext
// ---------------------------------------------------------------------------

export interface ToolContext {
  adapters: Map<string, BaseAdapter>;
  rateLimiter: RateLimiter;
  auditLog: AuditLog;
  tokenManager: TokenManager;
  deleteGuard: DeleteGuard;
  config: AdsConfig;
}

// ---------------------------------------------------------------------------
// getAdapter
// ---------------------------------------------------------------------------

/**
 * Retrieves the adapter for the given platform.
 * Throws AdsError(ACCOUNT_ISSUE) if no adapter is registered.
 */
export function getAdapter(ctx: ToolContext, platform: string): BaseAdapter {
  const adapter = ctx.adapters.get(platform);
  if (!adapter) {
    throw new AdsError(
      'ACCOUNT_ISSUE',
      platform,
      `No adapter registered for platform: ${platform}`,
      false,
    );
  }
  return adapter;
}

// ---------------------------------------------------------------------------
// resolveAccount
// ---------------------------------------------------------------------------

/**
 * Returns the account name to use, preferring the explicit `account` param,
 * then falling back to the platform's default_account from config.
 * Throws AdsError(ACCOUNT_ISSUE) if neither is available.
 */
export function resolveAccount(
  ctx: ToolContext,
  platform: string,
  account?: string,
): string {
  if (account) return account;

  const defaultAccount = ctx.config.platforms?.[platform]?.default_account;
  if (defaultAccount) return defaultAccount;

  throw new AdsError(
    'ACCOUNT_ISSUE',
    platform,
    `No account specified and no default_account configured for platform: ${platform}`,
    false,
  );
}

// ---------------------------------------------------------------------------
// validatePlatformOptions
// ---------------------------------------------------------------------------

/**
 * Validates that all keys in `options` are in the adapter's allowedPlatformOptions list.
 * Throws AdsError(ACCOUNT_ISSUE) listing the unknown keys if any are found.
 */
export function validatePlatformOptions(
  adapter: BaseAdapter,
  options?: Record<string, unknown>,
): void {
  if (!options) return;

  const unknown = Object.keys(options).filter(
    (k) => !adapter.allowedPlatformOptions.includes(k),
  );

  if (unknown.length > 0) {
    throw new AdsError(
      'ACCOUNT_ISSUE',
      adapter.platform,
      `Unknown platform_options: ${unknown.join(', ')}. Allowed: ${adapter.allowedPlatformOptions.join(', ')}`,
      false,
    );
  }
}
