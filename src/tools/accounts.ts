import type { ToolContext } from './register.js';
import { getAdapter, resolveAccount } from './register.js';

// ---------------------------------------------------------------------------
// Input shape helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

// ---------------------------------------------------------------------------
// Build AdapterContext
// ---------------------------------------------------------------------------

function buildAdapterCtx(
  ctx: ToolContext,
  platform: string,
  account: string,
): import('../adapters/base.js').AdapterContext {
  const accountMeta =
    (ctx.config.platforms?.[platform]?.accounts?.[account] as Record<string, unknown>) ?? {};
  return { account, accountMeta };
}

// ---------------------------------------------------------------------------
// accountTools
// ---------------------------------------------------------------------------

export function accountTools(ctx: ToolContext) {
  return {

    // ─── list_accounts ─────────────────────────────────────────────────────
    // Reads from config — returns account metadata grouped by platform.

    async list_accounts(_args: Record<string, unknown>): Promise<unknown> {
      const platforms = ctx.config.platforms ?? {};
      const result: Record<string, { default_account?: string; accounts: Record<string, unknown> }> = {};

      for (const [platformName, platformConfig] of Object.entries(platforms)) {
        const accounts: Record<string, unknown> = {};

        for (const [accountName, accountMeta] of Object.entries(platformConfig.accounts ?? {})) {
          accounts[accountName] = {
            account_id: accountMeta.account_id,
            currency: accountMeta.currency,
            label: accountMeta.label,
          };
        }

        result[platformName] = {
          ...(platformConfig.default_account ? { default_account: platformConfig.default_account } : {}),
          accounts,
        };
      }

      return result;
    },

    // ─── get_account_health ────────────────────────────────────────────────

    async get_account_health(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getAccountHealth(adapterCtx);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const ACCOUNT_TOOL_DEFINITIONS = [
  {
    name: 'list_accounts',
    description: 'List all configured ad accounts grouped by platform.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_account_health',
    description: 'Get health status for an account (billing, policy, spend limits, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Ad platform (meta, google, tiktok)' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
      },
      required: ['platform'],
    },
  },
] as const;
