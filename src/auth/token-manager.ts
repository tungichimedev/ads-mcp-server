import { createHash } from 'node:crypto';
import type { KeychainProvider } from './keychain.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUFFER_MS = 5 * 60 * 1000; // 5-minute refresh buffer
const SERVICE = 'ads-mcp';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RefreshResult = { token: string; expiresAt: string };
type RefreshHandler = (account: string) => Promise<RefreshResult>;

// ---------------------------------------------------------------------------
// TokenManager
// ---------------------------------------------------------------------------

/**
 * Manages OAuth tokens with:
 *  - Automatic refresh when a token is within BUFFER_MS of expiry
 *  - Mutex-style coalescing: concurrent getToken() calls for the same key
 *    share a single in-flight refresh promise
 */
export class TokenManager {
  private refreshMutex = new Map<string, Promise<string>>();
  private refreshHandlers = new Map<string, RefreshHandler>();

  constructor(private keychain: KeychainProvider) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  setRefreshHandler(platform: string, handler: RefreshHandler): void {
    this.refreshHandlers.set(platform, handler);
  }

  async getToken(platform: string, account: string): Promise<string> {
    const key = `${platform}:${account}`;

    // If a resolve-or-refresh promise is already in flight for this key,
    // coalesce onto it — this prevents concurrent refresh storms.
    const inflight = this.refreshMutex.get(key);
    if (inflight) {
      return inflight;
    }

    // Create the full check-and-maybe-refresh promise and register it
    // synchronously (before any await) so that the very next concurrent
    // call will see it in the map.
    const work = this._resolveToken(platform, account, key);
    this.refreshMutex.set(key, work);

    try {
      return await work;
    } finally {
      this.refreshMutex.delete(key);
    }
  }

  private async _resolveToken(platform: string, account: string, key: string): Promise<string> {
    const expired = await this.isExpired(platform, account);
    if (!expired) {
      const stored = await this.keychain.getPassword(SERVICE, key);
      if (stored) {
        return stored;
      }
    }
    return this._doRefresh(platform, account, key);
  }

  /**
   * Returns a short fingerprint of the stored token for logging.
   * Format: 'sha256:<first-8-hex-chars>'
   */
  async credentialFingerprint(platform: string, account: string): Promise<string> {
    const key = `${platform}:${account}`;
    const token = await this.keychain.getPassword(SERVICE, key);
    if (!token) {
      throw new Error(`No token stored for ${key}`);
    }
    const hash = createHash('sha256').update(token).digest('hex');
    return `sha256:${hash.slice(0, 8)}`;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async isExpired(platform: string, account: string): Promise<boolean> {
    const expiresKey = `${platform}:${account}:expires`;
    const raw = await this.keychain.getPassword(SERVICE, expiresKey);
    if (!raw) {
      // No expiry record → treat as expired so we trigger a refresh
      return true;
    }
    const expiresAt = new Date(raw).getTime();
    return Date.now() >= expiresAt - BUFFER_MS;
  }

  private async _doRefresh(platform: string, account: string, key: string): Promise<string> {
    const handler = this.refreshHandlers.get(platform);
    if (!handler) {
      throw new Error(`No refresh handler registered for platform: ${platform}`);
    }

    const { token, expiresAt } = await handler(account);

    // Persist new token and expiry
    await this.keychain.setPassword(SERVICE, key, token);
    await this.keychain.setPassword(SERVICE, `${key}:expires`, expiresAt);

    return token;
  }
}
