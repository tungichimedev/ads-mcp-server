// ads-mcp-server — MCP entry point
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './utils/config.js';
import { AdsError } from './utils/errors.js';
import { setReadOnly } from './safety/read-only.js';
import { initKeychain, setKeychainProvider } from './auth/keychain.js';
import { TokenManager } from './auth/token-manager.js';
import { registerMetaRefreshHandler } from './adapters/meta/auth.js';
import { MetaAdapter } from './adapters/meta/client.js';
import { registerGoogleRefreshHandler } from './adapters/google/auth.js';
import { GoogleAdapter } from './adapters/google/client.js';
import { registerTikTokRefreshHandler } from './adapters/tiktok/auth.js';
import { TikTokAdapter } from './adapters/tiktok/client.js';
import { RateLimiter } from './utils/rate-limiter.js';
import { AuditLog, type AuditOutput } from './utils/audit-log.js';
import { DeleteGuard } from './safety/delete-guard.js';

import type { BaseAdapter } from './adapters/base.js';
import type { ToolContext } from './tools/register.js';
import { campaignTools, CAMPAIGN_TOOL_DEFINITIONS } from './tools/campaigns.js';
import { adsetTools, ADSET_TOOL_DEFINITIONS } from './tools/adsets.js';
import { adTools, AD_TOOL_DEFINITIONS } from './tools/ads.js';
import { creativeTools, CREATIVE_TOOL_DEFINITIONS } from './tools/creatives.js';
import { audienceTools, AUDIENCE_TOOL_DEFINITIONS } from './tools/audiences.js';
import { reportingTools, REPORTING_TOOL_DEFINITIONS } from './tools/reporting.js';
import { budgetTools, BUDGET_TOOL_DEFINITIONS } from './tools/budgets.js';
import { ruleTools, RULE_TOOL_DEFINITIONS } from './tools/rules.js';
import { trackingTools, TRACKING_TOOL_DEFINITIONS } from './tools/tracking.js';
import { keywordTools, KEYWORD_TOOL_DEFINITIONS } from './tools/keywords.js';
import { accountTools, ACCOUNT_TOOL_DEFINITIONS } from './tools/accounts.js';
import { systemTools, SYSTEM_TOOL_DEFINITIONS } from './tools/system.js';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // ── Config ──────────────────────────────────────────────────────────────
  const adsMcpHome = process.env['ADS_MCP_HOME'] ?? join(homedir(), '.ads-mcp');
  const config = await loadConfig(adsMcpHome);

  // ── Read-only mode ───────────────────────────────────────────────────────
  const readOnlyEnv = process.env['READ_ONLY'];
  const readOnly =
    readOnlyEnv === '1' || readOnlyEnv?.toLowerCase() === 'true';
  setReadOnly(readOnly);

  // ── Keychain ─────────────────────────────────────────────────────────────
  try {
    await initKeychain();
  } catch {
    // keytar unavailable (e.g. CI / test environments) — fall back to a
    // no-op in-memory provider so the server still starts.
    setKeychainProvider({
      async getPassword() { return null; },
      async setPassword() { /* no-op */ },
    });
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  const { getKeychainProvider } = await import('./auth/keychain.js');
  const tokenManager = new TokenManager(getKeychainProvider());
  registerMetaRefreshHandler(tokenManager);
  registerGoogleRefreshHandler(tokenManager);
  registerTikTokRefreshHandler(tokenManager);

  // ── Adapters ─────────────────────────────────────────────────────────────
  const adapters = new Map<string, BaseAdapter>();

  const metaConfig = config.platforms?.['meta'];
  if (metaConfig && metaConfig.accounts && Object.keys(metaConfig.accounts).length > 0) {
    const metaAdapter = new MetaAdapter((account) =>
      tokenManager.getToken('meta', account),
    );
    adapters.set('meta', metaAdapter);
  }

  const googleConfig = config.platforms?.['google'];
  if (googleConfig && googleConfig.accounts && Object.keys(googleConfig.accounts).length > 0) {
    // Shared OAuth credentials (one app + MCC + refresh token serves all
    // accounts) are read once from the keychain under `google:_shared:*`.
    // Per-account customer ids come from config (accountMeta).
    const kc = getKeychainProvider();
    type GoogleCreds = {
      developer_token: string;
      client_id: string;
      client_secret: string;
      refresh_token: string;
      login_customer_id?: string;
    };
    let googleCredsPromise: Promise<GoogleCreds> | undefined;
    const loadGoogleCreds = async (): Promise<GoogleCreds> => {
      const g = async (f: string): Promise<string> =>
        (await kc.getPassword('ads-mcp', `google:_shared:${f}`)) ?? '';
      const [developer_token, client_id, client_secret, refresh_token, login_customer_id] =
        await Promise.all([
          g('developer_token'),
          g('client_id'),
          g('client_secret'),
          g('refresh_token'),
          g('login_customer_id'),
        ]);
      const missing = Object.entries({ developer_token, client_id, client_secret, refresh_token })
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (missing.length > 0) {
        throw new AdsError(
          'ACCOUNT_ISSUE',
          'google',
          `Google Ads credentials missing from keychain: ${missing.join(', ')}. Run ./scripts/setup-local-google.sh`,
          false,
        );
      }
      return { developer_token, client_id, client_secret, refresh_token, login_customer_id: login_customer_id || undefined };
    };

    const customerCache = new Map<string, unknown>();
    adapters.set('google', new GoogleAdapter(async (account) => {
      if (customerCache.has(account)) return customerCache.get(account);
      googleCredsPromise ??= loadGoogleCreds();
      const creds = await googleCredsPromise;
      const meta = config.platforms?.['google']?.accounts?.[account];
      const rawCustomerId = (meta?.customer_id ?? meta?.account_id ?? account) as string;
      const customer_id = String(rawCustomerId).replace(/-/g, '');
      const login_customer_id = String(meta?.login_customer_id ?? creds.login_customer_id ?? '').replace(/-/g, '') || undefined;
      const { GoogleAdsApi } = await import('google-ads-api');
      const api = new GoogleAdsApi({
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        developer_token: creds.developer_token,
      });
      const customer = api.Customer({
        customer_id,
        refresh_token: creds.refresh_token,
        ...(login_customer_id ? { login_customer_id } : {}),
      });
      customerCache.set(account, customer);
      return customer;
    }));
  }

  const tiktokConfig = config.platforms?.['tiktok'];
  if (tiktokConfig && tiktokConfig.accounts && Object.keys(tiktokConfig.accounts).length > 0) {
    adapters.set('tiktok', new TikTokAdapter((account) =>
      tokenManager.getToken('tiktok', account),
    ));
  }

  // ── Infrastructure ────────────────────────────────────────────────────────
  const rateLimiter = new RateLimiter();
  const auditOutput: AuditOutput = process.env['K_SERVICE'] ? 'stdout' : 'file';
  const auditLog = new AuditLog(join(adsMcpHome, 'audit'), auditOutput);
  const deleteGuard = new DeleteGuard();

  // ── ToolContext ───────────────────────────────────────────────────────────
  const ctx: ToolContext = {
    adapters,
    rateLimiter,
    auditLog,
    tokenManager,
    deleteGuard,
    config,
  };

  // ── Transport ───────────────────────────────────────────────────────────
  const port = process.env['PORT'];
  if (port) {
    // ── HTTP mode (Cloud Run / container) ──────────────────────────────────
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());

    app.get('/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    app.post('/mcp', async (req, res) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = createServer(ctx);
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on('close', async () => {
          try { await transport.close(); } catch { /* cleanup best-effort */ }
          try { await server.close(); } catch { /* cleanup best-effort */ }
        });
      } catch (error) {
        try { await transport.close(); } catch { /* cleanup best-effort */ }
        try { await server.close(); } catch { /* cleanup best-effort */ }
        if (!res.headersSent) {
          res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
        }
      }
    });

    // Stateless mode — no SSE streams or session cleanup
    app.get('/mcp', (_req, res) => { res.status(405).json({ error: 'Method not allowed' }); });
    app.delete('/mcp', (_req, res) => { res.status(405).json({ error: 'Method not allowed' }); });

    app.listen(Number(port), '0.0.0.0', () => {
      process.stderr.write(`ads-mcp-server listening on 0.0.0.0:${port}\n`);
    });
  } else {
    // ── stdio mode (local / CLI) ───────────────────────────────────────────
    const server = createServer(ctx);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

// ---------------------------------------------------------------------------
// Server factory — creates a fully-configured MCP Server instance
// ---------------------------------------------------------------------------

function createServer(ctx: ToolContext): Server {
  const allToolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    ...campaignTools(ctx),
    ...adsetTools(ctx),
    ...adTools(ctx),
    ...creativeTools(ctx),
    ...audienceTools(ctx),
    ...reportingTools(ctx),
    ...budgetTools(ctx),
    ...ruleTools(ctx),
    ...trackingTools(ctx),
    ...keywordTools(ctx),
    ...accountTools(ctx),
    ...systemTools(ctx),
  };

  const allToolDefinitions = [
    ...CAMPAIGN_TOOL_DEFINITIONS,
    ...ADSET_TOOL_DEFINITIONS,
    ...AD_TOOL_DEFINITIONS,
    ...CREATIVE_TOOL_DEFINITIONS,
    ...AUDIENCE_TOOL_DEFINITIONS,
    ...REPORTING_TOOL_DEFINITIONS,
    ...BUDGET_TOOL_DEFINITIONS,
    ...RULE_TOOL_DEFINITIONS,
    ...TRACKING_TOOL_DEFINITIONS,
    ...KEYWORD_TOOL_DEFINITIONS,
    ...ACCOUNT_TOOL_DEFINITIONS,
    ...SYSTEM_TOOL_DEFINITIONS,
  ];

  const server = new Server(
    { name: 'ads-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allToolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    const handler = allToolHandlers[name];
    if (!handler) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: `Unknown tool: ${name}` }),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await handler(args);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      if (err instanceof AdsError) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(err.toJSON(), null, 2),
            },
          ],
          isError: true,
        };
      }
      throw err;
    }
  });

  return server;
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${String(err)}\n`);
  process.exit(1);
});
