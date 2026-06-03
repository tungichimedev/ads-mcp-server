// ads-mcp-server — MCP entry point
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
import { AuditLog } from './utils/audit-log.js';
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
    adapters.set('google', new GoogleAdapter(async (_account) => {
      // Client creation deferred to runtime — google-ads-node will be configured
      // with credentials from keychain when actually called
      return {}; // Placeholder — actual client init happens in adapter
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
  const auditLog = new AuditLog(join(adsMcpHome, 'audit'));
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

  // ── Tool handlers ─────────────────────────────────────────────────────────
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

  // ── MCP Server ────────────────────────────────────────────────────────────
  const server = new Server(
    { name: 'ads-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allToolDefinitions,
  }));

  // Call tool
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
      // Unknown error — re-throw to let MCP SDK handle it
      throw err;
    }
  });

  // ── Connect transport ─────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${String(err)}\n`);
  process.exit(1);
});
