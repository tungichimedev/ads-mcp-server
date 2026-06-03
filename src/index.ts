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
import { RateLimiter } from './utils/rate-limiter.js';
import { AuditLog } from './utils/audit-log.js';
import { DeleteGuard } from './safety/delete-guard.js';

import type { BaseAdapter } from './adapters/base.js';
import type { ToolContext } from './tools/register.js';
import { campaignTools, CAMPAIGN_TOOL_DEFINITIONS } from './tools/campaigns.js';

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

  // ── Adapters ─────────────────────────────────────────────────────────────
  const adapters = new Map<string, BaseAdapter>();

  const metaConfig = config.platforms?.['meta'];
  if (metaConfig && metaConfig.accounts && Object.keys(metaConfig.accounts).length > 0) {
    const metaAdapter = new MetaAdapter((account) =>
      tokenManager.getToken('meta', account),
    );
    adapters.set('meta', metaAdapter);
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
  const campaigns = campaignTools(ctx);

  const allToolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    list_campaigns: campaigns.list_campaigns,
    get_campaign: campaigns.get_campaign,
    create_campaign: campaigns.create_campaign,
    update_campaign: campaigns.update_campaign,
    set_campaign_status: campaigns.set_campaign_status,
    delete_campaign: campaigns.delete_campaign,
    clone_campaign: campaigns.clone_campaign,
  };

  const allToolDefinitions = [...CAMPAIGN_TOOL_DEFINITIONS];

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
