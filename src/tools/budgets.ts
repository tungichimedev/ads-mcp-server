import type { ToolContext } from './register.js';
import { getAdapter, resolveAccount } from './register.js';
import { enforceWritable } from '../safety/read-only.js';
import { checkCampaignBudget, checkAccountVelocity } from '../safety/budget-guard.js';

// ---------------------------------------------------------------------------
// Input shape helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
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
// Budget guard helper
// ---------------------------------------------------------------------------

async function runBudgetGuards(
  ctx: ToolContext,
  updates: Record<string, unknown>,
  platform: string,
  account: string,
): Promise<void> {
  const budget = updates['budget'];
  if (!budget || typeof budget !== 'object' || Array.isArray(budget)) return;

  const budgetObj = budget as { type?: string; amount?: number };
  const budgetType = budgetObj.type as 'daily' | 'lifetime' | undefined;
  const budgetAmount = budgetObj.amount;

  if (!budgetType || budgetAmount === undefined) return;

  checkCampaignBudget(budgetType, budgetAmount, ctx.config.safety);

  if (budgetType === 'daily') {
    const adapter = getAdapter(ctx, platform);
    const adapterCtx = buildAdapterCtx(ctx, platform, account);
    const existingBudgets = await adapter.getAllActiveCampaignBudgets(adapterCtx);
    checkAccountVelocity(budgetAmount, existingBudgets, ctx.config.safety);
  }
}

// ---------------------------------------------------------------------------
// budgetTools
// ---------------------------------------------------------------------------

export function budgetTools(ctx: ToolContext) {
  return {

    // ─── get_budget ────────────────────────────────────────────────────────

    async get_budget(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const campaignId = str(args['campaign_id']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getBudget(adapterCtx, campaignId);
      });
    },

    // ─── update_budget ─────────────────────────────────────────────────────

    async update_budget(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('update_budget');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const campaignId = str(args['campaign_id']);
      const dryRun = args['dry_run'] === true;
      const updates = asRecord(args['updates']);

      if (dryRun) {
        return { dry_run: true, campaign_id: campaignId, preview: updates };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        // Run budget guards inside queue slot (same as create_campaign)
        await runBudgetGuards(ctx, updates, platform, account);

        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.updateCampaign(adapterCtx, campaignId, updates);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'update_budget',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { campaign_id: campaignId, ...updates },
          result: 'ok',
        });

        return result;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const BUDGET_TOOL_DEFINITIONS = [
  {
    name: 'get_budget',
    description: 'Get the current budget for a campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Ad platform (meta, google, tiktok)' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
        campaign_id: { type: 'string', description: 'Campaign ID to get budget for' },
      },
      required: ['platform', 'campaign_id'],
    },
  },
  {
    name: 'update_budget',
    description: 'Update the budget for a campaign. Enforces safety limits. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        campaign_id: { type: 'string' },
        updates: {
          type: 'object',
          description: 'Budget update fields. Include a "budget" object with "type" (daily|lifetime) and "amount".',
        },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'campaign_id', 'updates'],
    },
  },
] as const;
