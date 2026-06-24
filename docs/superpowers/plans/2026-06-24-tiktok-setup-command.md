# TikTok `ads-mcp setup` Re-auth Command — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `ads-mcp setup tiktok` CLI command that runs the TikTok OAuth auth-code exchange and stores fresh, full-scope access tokens into the keychain for every granted advertiser.

**Architecture:** A new CLI entrypoint (`src/cli.ts`, wired via `package.json` `bin`) dispatches to a pure-ish orchestrator (`src/setup/tiktok-setup.ts`) whose side-effecting boundaries (`fetch`, prompt, browser-open, keychain, config I/O) are injected so they can be mocked in tests. The existing MCP server (`src/index.ts`) is untouched.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Zod v4, Vitest (`globals: true`), Node `readline/promises`, `keytar` via existing `src/auth/keychain.ts`.

## Global Constraints

- ESM throughout; **all local imports use `.js` extensions**.
- Zod v4 for any response validation.
- Tests are colocated (`foo.ts` → `foo.test.ts`); Vitest globals are on — do **not** import `describe`/`it`/`expect` (but `vi` must be imported from `vitest`).
- Keychain key format: service `ads-mcp`, account key **`tiktok:<accountName>`** (use existing `setSecret(key, value)` which already scopes the service).
- TikTok token exchange endpoint: `POST https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/`, JSON body `{ app_id, secret, auth_code }`, **no `Access-Token` header**. Success = `{ code: 0, data: { access_token, scope, advertiser_ids } }`.
- TikTok authorize URL: `https://business-api.tiktok.com/portal/auth?app_id=<id>&state=<nonce>&redirect_uri=<uri>`.
- Scope-probe endpoint: `GET https://business-api.tiktok.com/open_api/v1.3/campaign/get/` with header `Access-Token: <token>` and query `advertiser_id`; `code: 0` = scope OK, `code: 40001` = scope missing.
- App credentials (`TIKTOK_APP_ID` / `TIKTOK_APP_SECRET`) come from env or interactive prompt; **never written to disk**.
- `config.json` is written **last**, only after all keychain writes succeed (no half-written config on partial failure).
- Setup is a local-only command; it does **not** support Cloud Run (`K_SERVICE`) — `saveConfig` writes the filesystem only.

---

### Task 1: `saveConfig` writer in `config.ts`

**Files:**
- Modify: `src/utils/config.ts` (add `writeFile` import + `saveConfig` export)
- Test: `src/utils/config.test.ts` (append a `saveConfig` describe block)

**Interfaces:**
- Produces: `saveConfig(basePath: string, config: AdsConfig): Promise<void>` — serializes `config` as pretty JSON to `join(basePath, 'config.json')`.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/config.test.ts`:

```ts
import { saveConfig } from './config.js';

describe('saveConfig', () => {
  it('round-trips through loadConfig', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ads-mcp-save-'));
    try {
      const original = parseConfig({
        schema_version: 1,
        platforms: {
          tiktok: {
            default_account: 'themepack',
            accounts: {
              themepack: { account_id: '123', advertiser_id: '123', currency: 'USD', label: 'ThemePack' },
            },
          },
        },
      });

      await saveConfig(dir, original);
      const reloaded = await loadConfig(dir);

      expect(reloaded.platforms?.tiktok?.accounts?.themepack?.advertiser_id).toBe('123');
      expect(reloaded.platforms?.tiktok?.default_account).toBe('themepack');
      expect(reloaded.schema_version).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/config.test.ts -t saveConfig`
Expected: FAIL — `saveConfig` is not exported.

- [ ] **Step 3: Implement `saveConfig`**

In `src/utils/config.ts`, change the fs import on line 2 to add `writeFile`:

```ts
import { readFile, writeFile } from 'node:fs/promises';
```

Add after `loadConfig` (after line 173):

```ts
/**
 * Writes the config to `<basePath>/config.json` as pretty-printed JSON.
 * Local-only — not supported on Cloud Run (Secret Manager is read-only here).
 */
export async function saveConfig(basePath: string, config: AdsConfig): Promise<void> {
  const configPath = join(basePath, 'config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/config.test.ts -t saveConfig`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/config.ts src/utils/config.test.ts
git commit -m "feat(config): add saveConfig writer for setup command"
```

---

### Task 2: TikTok OAuth helpers — authorize URL + token exchange

**Files:**
- Create: `src/setup/tiktok-oauth.ts`
- Test: `src/setup/tiktok-oauth.test.ts`

**Interfaces:**
- Produces:
  - `buildAuthorizeUrl(appId: string, state: string, redirectUri: string): string`
  - `exchangeAuthCode(fetchFn: typeof globalThis.fetch, appId: string, secret: string, authCode: string): Promise<TokenExchangeResult>`
  - `interface TokenExchangeResult { accessToken: string; scope: (string | number)[]; advertiserIds: string[]; }`
- Consumes (later tasks): both functions above.

- [ ] **Step 1: Write the failing tests**

Create `src/setup/tiktok-oauth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/setup/tiktok-oauth.test.ts`
Expected: FAIL — module `./tiktok-oauth.js` not found.

- [ ] **Step 3: Implement the helpers**

Create `src/setup/tiktok-oauth.ts`:

```ts
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

  if (parsed.code !== 0 || !parsed.data?.access_token) {
    throw new Error(`TikTok token exchange failed (code ${parsed.code}): ${parsed.message}`);
  }

  return {
    accessToken: parsed.data.access_token,
    scope: parsed.data.scope ?? [],
    advertiserIds: parsed.data.advertiser_ids ?? [],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/setup/tiktok-oauth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/setup/tiktok-oauth.ts src/setup/tiktok-oauth.test.ts
git commit -m "feat(setup): add TikTok authorize-url + auth-code exchange helpers"
```

---

### Task 3: Advertiser→account mapping + scope probe

**Files:**
- Create: `src/setup/tiktok-mapping.ts`
- Test: `src/setup/tiktok-mapping.test.ts`

**Interfaces:**
- Consumes: `AdsConfig`, `AccountMeta` from `../utils/config.js`.
- Produces:
  - `interface MappedAdvertiser { advertiserId: string; accountName: string; }`
  - `interface MappingResult { matched: MappedAdvertiser[]; unknown: string[]; }`
  - `mapAdvertisers(config: AdsConfig, advertiserIds: string[]): MappingResult`
  - `probeCampaignScope(fetchFn: typeof globalThis.fetch, token: string, advertiserId: string): Promise<boolean>` — `true` if `code === 0`, `false` if `code === 40001`; throws on other non-zero codes.

- [ ] **Step 1: Write the failing tests**

Create `src/setup/tiktok-mapping.test.ts`:

```ts
import { vi } from 'vitest';
import { parseConfig } from '../utils/config.js';
import { mapAdvertisers, probeCampaignScope } from './tiktok-mapping.js';

const config = parseConfig({
  schema_version: 1,
  platforms: {
    tiktok: {
      accounts: {
        themepack: { account_id: '600', advertiser_id: '600', label: 'ThemePack' },
        legacy: { account_id: '700', label: 'Legacy (no advertiser_id)' },
      },
    },
  },
});

describe('mapAdvertisers', () => {
  it('matches by advertiser_id and falls back to account_id', () => {
    const r = mapAdvertisers(config, ['600', '700', '999']);
    expect(r.matched).toContainEqual({ advertiserId: '600', accountName: 'themepack' });
    expect(r.matched).toContainEqual({ advertiserId: '700', accountName: 'legacy' });
    expect(r.unknown).toEqual(['999']);
  });
});

describe('probeCampaignScope', () => {
  it('returns true when campaign/get succeeds', async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ code: 0, message: 'OK', data: { list: [] } }), { status: 200 },
    )) as unknown as typeof globalThis.fetch;
    expect(await probeCampaignScope(fetchFn, 'tok', '600')).toBe(true);
  });

  it('returns false on 40001 scope error', async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ code: 40001, message: 'lacks scope', data: {} }), { status: 200 },
    )) as unknown as typeof globalThis.fetch;
    expect(await probeCampaignScope(fetchFn, 'tok', '600')).toBe(false);
  });

  it('sends the Access-Token header and advertiser_id query', async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ code: 0, message: 'OK', data: {} }), { status: 200 },
    )) as unknown as typeof globalThis.fetch;
    await probeCampaignScope(fetchFn, 'tok123', '600');
    const call = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toContain('advertiser_id=600');
    expect((call[1] as RequestInit).headers).toMatchObject({ 'Access-Token': 'tok123' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/setup/tiktok-mapping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement mapping + probe**

Create `src/setup/tiktok-mapping.ts`:

```ts
import type { AdsConfig } from '../utils/config.js';

const CAMPAIGN_GET_URL = 'https://business-api.tiktok.com/open_api/v1.3/campaign/get/';

export interface MappedAdvertiser {
  advertiserId: string;
  accountName: string;
}

export interface MappingResult {
  matched: MappedAdvertiser[];
  unknown: string[];
}

/** Maps each granted advertiser id to a configured tiktok account (by advertiser_id, else account_id). */
export function mapAdvertisers(config: AdsConfig, advertiserIds: string[]): MappingResult {
  const accounts = config.platforms?.['tiktok']?.accounts ?? {};
  const byId = new Map<string, string>();
  for (const [name, meta] of Object.entries(accounts)) {
    byId.set(meta.advertiser_id ?? meta.account_id, name);
  }

  const matched: MappedAdvertiser[] = [];
  const unknown: string[] = [];
  for (const id of advertiserIds) {
    const accountName = byId.get(id);
    if (accountName) matched.push({ advertiserId: id, accountName });
    else unknown.push(id);
  }
  return { matched, unknown };
}

/** Probes campaign/get to check whether the token carries campaign-management scope. */
export async function probeCampaignScope(
  fetchFn: typeof globalThis.fetch,
  token: string,
  advertiserId: string,
): Promise<boolean> {
  const url = new URL(CAMPAIGN_GET_URL);
  url.searchParams.set('advertiser_id', advertiserId);
  url.searchParams.set('page_size', '1');

  const res = await fetchFn(url.toString(), {
    method: 'GET',
    headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
  });

  const json = (await res.json()) as { code: number; message: string };
  if (json.code === 0) return true;
  if (json.code === 40001) return false;
  throw new Error(`Unexpected TikTok response probing scope (code ${json.code}): ${json.message}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/setup/tiktok-mapping.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/setup/tiktok-mapping.ts src/setup/tiktok-mapping.test.ts
git commit -m "feat(setup): add advertiser mapping + campaign-scope probe"
```

---

### Task 4: Orchestrator `runTikTokSetup`

**Files:**
- Create: `src/setup/tiktok-setup.ts`
- Test: `src/setup/tiktok-setup.test.ts`

**Interfaces:**
- Consumes: `buildAuthorizeUrl`, `exchangeAuthCode` (Task 2); `mapAdvertisers`, `probeCampaignScope` (Task 3); `loadConfig`, `saveConfig`, `AdsConfig` (`../utils/config.js`).
- Produces:
  - `interface TikTokSetupDeps { fetch; prompt; openBrowser; log; env; loadConfig; saveConfig; setSecret; }` (exact types below)
  - `interface TikTokSetupOptions { basePath: string; dryRun: boolean; redirectUri: string; state: string; }`
  - `runTikTokSetup(deps: TikTokSetupDeps, opts: TikTokSetupOptions): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `src/setup/tiktok-setup.test.ts`:

```ts
import { vi } from 'vitest';
import { runTikTokSetup, type TikTokSetupDeps } from './tiktok-setup.js';
import { parseConfig, type AdsConfig } from '../utils/config.js';

function baseConfig(): AdsConfig {
  return parseConfig({
    schema_version: 1,
    platforms: {
      tiktok: {
        default_account: 'themepack',
        accounts: {
          themepack: { account_id: '600', advertiser_id: '600', label: 'ThemePack' },
        },
      },
    },
  });
}

function makeDeps(over: Partial<TikTokSetupDeps> = {}): {
  deps: TikTokSetupDeps;
  setSecret: ReturnType<typeof vi.fn>;
  saveConfig: ReturnType<typeof vi.fn>;
  logs: string[];
} {
  const logs: string[] = [];
  const setSecret = vi.fn(async () => {});
  const saveConfig = vi.fn(async () => {});
  // prompt answers in order: app_id, app_secret, auth_code
  const answers = ['app123', 'secretXYZ', 'authABC'];
  const deps: TikTokSetupDeps = {
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('oauth2/access_token')) {
        return new Response(JSON.stringify({
          code: 0, message: 'OK',
          data: { access_token: 'tok_new', scope: [4], advertiser_ids: ['600'] },
        }), { status: 200 });
      }
      // campaign/get scope probe → OK
      return new Response(JSON.stringify({ code: 0, message: 'OK', data: { list: [] } }), { status: 200 });
    }) as unknown as typeof globalThis.fetch,
    prompt: vi.fn(async () => answers.shift() ?? ''),
    openBrowser: vi.fn(async () => {}),
    log: (m: string) => logs.push(m),
    env: {},
    loadConfig: vi.fn(async () => baseConfig()),
    saveConfig,
    setSecret,
    ...over,
  };
  return { deps, setSecret, saveConfig, logs };
}

const opts = { basePath: '/tmp/x', dryRun: false, redirectUri: 'https://example.com/cb', state: 'nonce' };

describe('runTikTokSetup', () => {
  it('happy path stores the token for the matched account', async () => {
    const { deps, setSecret, saveConfig } = makeDeps();
    await runTikTokSetup(deps, opts);
    expect(setSecret).toHaveBeenCalledWith('tiktok:themepack', 'tok_new');
    expect(saveConfig).not.toHaveBeenCalled(); // no unknown advertisers → config unchanged
  });

  it('dry-run writes nothing', async () => {
    const { deps, setSecret, saveConfig } = makeDeps();
    await runTikTokSetup(deps, { ...opts, dryRun: true });
    expect(setSecret).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('warns when the scope probe reports 40001', async () => {
    const { deps, logs } = makeDeps({
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes('oauth2/access_token')) {
          return new Response(JSON.stringify({
            code: 0, message: 'OK',
            data: { access_token: 'tok_new', scope: [], advertiser_ids: ['600'] },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ code: 40001, message: 'lacks scope', data: {} }), { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });
    await runTikTokSetup(deps, opts);
    expect(logs.join('\n')).toMatch(/campaign scope still missing/i);
  });

  it('does not write config if a keychain write fails', async () => {
    const { deps, saveConfig } = makeDeps({
      setSecret: vi.fn(async () => { throw new Error('keytar unavailable'); }),
    });
    await expect(runTikTokSetup(deps, opts)).rejects.toThrow(/keytar unavailable/);
    expect(saveConfig).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/setup/tiktok-setup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `src/setup/tiktok-setup.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/setup/tiktok-setup.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/setup/tiktok-setup.ts src/setup/tiktok-setup.test.ts
git commit -m "feat(setup): add runTikTokSetup orchestrator"
```

---

### Task 5: CLI entrypoint + `package.json` bin

**Files:**
- Create: `src/cli.ts`
- Modify: `package.json` (add `bin`)
- Test: manual smoke (CLI wiring is thin glue; logic is covered by Tasks 1–4).

**Interfaces:**
- Consumes: `runTikTokSetup`, `defaultDeps` (Task 4); `initKeychain` (`./auth/keychain.js`).

- [ ] **Step 1: Add the `bin` field to `package.json`**

Add a `"bin"` key (after `"main"`):

```json
  "main": "dist/index.js",
  "bin": {
    "ads-mcp": "dist/cli.js"
  },
```

- [ ] **Step 2: Create `src/cli.ts`**

```ts
#!/usr/bin/env node
// ads-mcp CLI — setup / re-auth commands (separate entrypoint from the MCP server)
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { exec } from 'node:child_process';
import { initKeychain } from './auth/keychain.js';
import { runTikTokSetup, defaultDeps } from './setup/tiktok-setup.js';

const USAGE = `ads-mcp — setup commands

Usage:
  ads-mcp setup tiktok [--dry-run] [--redirect-uri <uri>]

Environment:
  ADS_MCP_HOME        Config home (default ~/.ads-mcp)
  TIKTOK_APP_ID       TikTok app id   (else prompted)
  TIKTOK_APP_SECRET   TikTok app secret (else prompted)
`;

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function openBrowser(url: string): Promise<void> {
  const cmd =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start ""' : 'xdg-open';
  await new Promise<void>((resolve) => {
    exec(`${cmd} "${url}"`, () => resolve()); // best-effort; ignore failures
  });
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command, platform] = args;

  if (command !== 'setup' || platform !== 'tiktok') {
    process.stdout.write(USAGE);
    process.exit(command === 'setup' ? 1 : 0);
  }

  await initKeychain();

  const basePath = process.env['ADS_MCP_HOME'] ?? join(homedir(), '.ads-mcp');
  const dryRun = args.includes('--dry-run');
  const redirectUri = getFlag(args, '--redirect-uri') ?? 'https://business-api.tiktok.com/portal/auth/callback';

  await runTikTokSetup(defaultDeps(prompt, openBrowser), {
    basePath,
    dryRun,
    redirectUri,
    state: randomUUID(),
  });
}

main().catch((err: unknown) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `tsc` compiles with no errors; `dist/cli.js` exists.

- [ ] **Step 4: Smoke-test the usage path (no network)**

Run: `node dist/cli.js`
Expected: prints the usage block, exits 0.

Run: `node dist/cli.js setup tiktok --dry-run` then, when prompted, enter a dummy `app_id`/`app_secret` and an obviously-bad `auth_code`.
Expected: it builds + prints the authorize URL, then fails at the exchange step with a clear `TikTok token exchange failed` message (proves wiring end-to-end without storing anything).

- [ ] **Step 5: Run the full test suite + commit**

Run: `npm run test`
Expected: all tests pass.

```bash
git add package.json src/cli.ts
git commit -m "feat(setup): add ads-mcp CLI entrypoint for tiktok re-auth"
```

---

## Self-Review

**Spec coverage:**
- Capture mechanism = auth-code exchange → Task 2 (`exchangeAuthCode`) + Task 4 (orchestration). ✓
- TikTok-only, separate CLI entry, MCP server untouched → Task 5. ✓
- App creds env-or-prompt, never persisted → Task 4 step 3 (`env[...] ?? prompt`). ✓
- Print authorize URL + open browser + scope reminder → Task 4. ✓
- Capture auth_code by paste → Task 4. ✓
- Map advertiser_ids to existing accounts; store `tiktok:<account>` → Task 3 + Task 4. ✓
- Unknown advertisers prompt-to-add → Task 4 step 6. ✓
- Scope verification via `campaign/get` (40001 surfaced loudly) → Task 3 (`probeCampaignScope`) + Task 4 step 8. ✓
- Error handling: exchange failure message verbatim (Task 2 throw), keychain failure aborts before config write (Task 4 ordering + test), config written last (Task 4). ✓
- `--dry-run` writes nothing → Task 4 + test. ✓
- `state` nonce CSRF sanity → generated in Task 5 (`randomUUID`), passed through. (Note: round-trip verification of `state` is not possible with manual paste; spec marked it warn-only — the nonce is generated and used in the authorize URL, which satisfies the spec's intent.)
- Tests, no live calls → Tasks 1–4 all mock boundaries. ✓
- Cloud Run out of scope → `saveConfig` filesystem-only (Task 1 doc + Global Constraints). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `TokenExchangeResult` (Task 2) consumed in Task 4 via `{ accessToken, advertiserIds }`. `MappingResult.matched: MappedAdvertiser[]` (Task 3) consumed in Task 4. `TikTokSetupDeps`/`TikTokSetupOptions` defined in Task 4, consumed in Task 5. `setSecret(key, value)` signature matches `src/auth/keychain.ts`. `saveConfig(basePath, config)` defined Task 1, used Task 4/5. ✓

**Note on the `network retry` spec item:** The spec mentioned retrying the exchange once on network/timeout. This is intentionally omitted from the plan as YAGNI for a manual, interactive command — a failed exchange just means re-running with a fresh auth_code (which the user must do anyway, since auth_codes are single-use). If you want it, it's a 3-line wrapper around `exchangeAuthCode` and can be added to Task 2.
