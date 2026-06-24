import type { AdsConfig } from '../utils/config.js';
import { loadConfig as realLoadConfig, saveConfig as realSaveConfig } from '../utils/config.js';
import { setSecret as realSetSecret } from '../auth/keychain.js';
import { buildAuthorizeUrl, exchangeAuthCode } from './tiktok-oauth.js';
import { mapAdvertisers, probeCampaignScope } from './tiktok-mapping.js';

export interface TikTokSetupDeps {
  fetch: typeof globalThis.fetch;
  prompt: (question: string) => Promise<string>;
  openBrowser: (url: string) => Promise<void>;
  log: (message: string) => void;
  env: Record<string, string | undefined>;
  loadConfig: (basePath: string) => Promise<AdsConfig>;
  saveConfig: (basePath: string, config: AdsConfig) => Promise<void>;
  setSecret: (key: string, value: string) => Promise<void>;
}

export interface TikTokSetupOptions {
  basePath: string;
  dryRun: boolean;
  redirectUri: string;
  state: string;
}

/** Default deps wired to real fetch/keychain/config; overridable in tests. */
export function defaultDeps(
  prompt: (q: string) => Promise<string>,
  openBrowser: (url: string) => Promise<void>,
): TikTokSetupDeps {
  return {
    fetch: globalThis.fetch,
    prompt,
    openBrowser,
    log: (m) => console.log(m),
    env: process.env,
    loadConfig: realLoadConfig,
    saveConfig: realSaveConfig,
    setSecret: realSetSecret,
  };
}

export async function runTikTokSetup(deps: TikTokSetupDeps, opts: TikTokSetupOptions): Promise<void> {
  const { fetch: fetchFn, prompt, openBrowser, log, env } = deps;

  // 1. App credentials (env or prompt; never persisted)
  const appId = env['TIKTOK_APP_ID'] ?? (await prompt('TikTok app_id: ')).trim();
  const appSecret = env['TIKTOK_APP_SECRET'] ?? (await prompt('TikTok app_secret: ')).trim();
  if (!appId || !appSecret) throw new Error('app_id and app_secret are required.');

  // 2. Authorize URL
  const authorizeUrl = buildAuthorizeUrl(appId, opts.state, opts.redirectUri);
  log('\nFirst, ensure all ad-management scopes are enabled on this app in the TikTok developer portal.');
  log('Opening the authorize URL (copy it if your browser does not open):');
  log(authorizeUrl + '\n');
  await openBrowser(authorizeUrl);

  // 3. Capture auth_code
  const authCode = (await prompt('Paste the auth_code from the redirect URL: ')).trim();
  if (!authCode) throw new Error('auth_code is required.');

  // 4. Exchange
  const { accessToken, advertiserIds } = await exchangeAuthCode(fetchFn, appId, appSecret, authCode);
  log(`\nExchange OK. Granted ${advertiserIds.length} advertiser(s).`);

  // 5. Map to configured accounts
  const config = await deps.loadConfig(opts.basePath);
  const { matched, unknown } = mapAdvertisers(config, advertiserIds);

  if (opts.dryRun) {
    log('\n[dry-run] Would store the token for:');
    for (const m of matched) log(`  - tiktok:${m.accountName} (${m.advertiserId})`);
    if (unknown.length) log(`[dry-run] Unmapped advertiser ids (would prompt to add): ${unknown.join(', ')}`);
    log('[dry-run] No keychain or config writes performed.');
    return;
  }

  // 6. Handle unknown advertisers (prompt to add) — collect config additions, apply after keychain writes
  const additions: { name: string; advertiserId: string }[] = [];
  for (const id of unknown) {
    const ans = (await prompt(`Advertiser ${id} is not in config. Add it? Enter a short key (or blank to skip): `)).trim();
    if (ans) {
      matched.push({ advertiserId: id, accountName: ans });
      additions.push({ name: ans, advertiserId: id });
    }
  }

  // 7. Store tokens (config written only after ALL keychain writes succeed)
  for (const m of matched) {
    await deps.setSecret(`tiktok:${m.accountName}`, accessToken);
    log(`Stored token: tiktok:${m.accountName}`);
  }

  if (additions.length) {
    const platform = config.platforms?.['tiktok'] ?? { accounts: {} };
    const accounts = { ...(platform.accounts ?? {}) };
    for (const a of additions) {
      accounts[a.name] = { account_id: a.advertiserId, advertiser_id: a.advertiserId, currency: 'USD', label: a.name };
    }
    const nextConfig: AdsConfig = {
      ...config,
      platforms: { ...config.platforms, tiktok: { ...platform, accounts } },
    };
    await deps.saveConfig(opts.basePath, nextConfig);
    log(`Updated config.json with ${additions.length} new account(s).`);
  }

  // 8. Verify scope per account
  log('\nVerifying campaign-management scope:');
  for (const m of matched) {
    const ok = await probeCampaignScope(fetchFn, accessToken, m.advertiserId);
    if (ok) {
      log(`  ✓ ${m.accountName} — campaign scope OK`);
    } else {
      log(`  ✗ ${m.accountName} — campaign scope still missing (40001). Enable Campaign Management on the app in the portal, then re-run.`);
    }
  }
}
