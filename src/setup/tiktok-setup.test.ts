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
          data: { access_token: 'tok_new', scope: [4], advertiser_ids: ['600'], access_token_expire_in: 86400 },
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
  it('happy path stores the token and expiry for the matched account', async () => {
    const before = Date.now();
    const { deps, setSecret, saveConfig } = makeDeps();
    await runTikTokSetup(deps, opts);
    expect(setSecret).toHaveBeenCalledWith('tiktok:themepack', 'tok_new');
    // :expires key must also be written with a valid future ISO string
    const expiresCall = (setSecret as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'tiktok:themepack:expires',
    );
    expect(expiresCall).toBeDefined();
    const expiresAtMs = new Date(expiresCall![1] as string).getTime();
    expect(expiresAtMs).toBeGreaterThan(before);
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

  it('unknown advertiser: prompts for new key, writes both secrets, and saves config with new account stanza', async () => {
    const before = Date.now();
    // Exchange returns an advertiser id (999) NOT in config
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('oauth2/access_token')) {
        return new Response(JSON.stringify({
          code: 0, message: 'OK',
          data: { access_token: 'tok_new', scope: [4], advertiser_ids: ['999'], access_token_expire_in: 86400 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 0, message: 'OK', data: { list: [] } }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    // prompt answers: app_id, app_secret, auth_code, then new short key for unknown advertiser
    const answers = ['app123', 'secretXYZ', 'authABC', 'newacct'];
    const { deps, setSecret, saveConfig } = makeDeps({
      fetch: fetchMock,
      prompt: vi.fn(async () => answers.shift() ?? ''),
    });

    await runTikTokSetup(deps, opts);

    // Both secrets written for the new account key
    expect(setSecret).toHaveBeenCalledWith('tiktok:newacct', 'tok_new');
    const expiresCall = (setSecret as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'tiktok:newacct:expires',
    );
    expect(expiresCall).toBeDefined();
    const expiresAtMs = new Date(expiresCall![1] as string).getTime();
    expect(expiresAtMs).toBeGreaterThan(before);

    // saveConfig called with config containing the new account stanza
    expect(saveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = (saveConfig as ReturnType<typeof vi.fn>).mock.calls[0][1] as AdsConfig;
    const tiktokAccounts = savedConfig.platforms?.['tiktok']?.accounts as Record<string, unknown> | undefined;
    expect(tiktokAccounts).toBeDefined();
    expect(tiktokAccounts!['newacct']).toBeDefined();
    expect((tiktokAccounts!['newacct'] as Record<string, unknown>)['advertiser_id']).toBe('999');
  });
});
