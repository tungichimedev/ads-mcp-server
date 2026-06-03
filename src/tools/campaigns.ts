import type { ToolContext } from './register.js';
import { getAdapter, resolveAccount, validatePlatformOptions } from './register.js';
import { enforceWritable } from '../safety/read-only.js';
import { checkCampaignBudget, checkAccountVelocity } from '../safety/budget-guard.js';
import { AdsError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// Input shape helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Budget guard helper (used in create + update)
// ---------------------------------------------------------------------------

async function runBudgetGuards(
  ctx: ToolContext,
  input: Record<string, unknown>,
  platform: string,
  account: string,
): Promise<void> {
  const budget = input['budget'];
  if (!budget || typeof budget !== 'object' || Array.isArray(budget)) return;

  const budgetObj = budget as { type?: string; amount?: number };
  const budgetType = budgetObj.type as 'daily' | 'lifetime' | undefined;
  const budgetAmount = budgetObj.amount;

  if (!budgetType || budgetAmount === undefined) return;

  // Per-campaign limit
  checkCampaignBudget(budgetType, budgetAmount, ctx.config.safety);

  // Account-level velocity check (daily budgets only)
  if (budgetType === 'daily') {
    const adapter = getAdapter(ctx, platform);
    const adapterCtx = buildAdapterCtx(ctx, platform, account);
    const existingBudgets = await adapter.getAllActiveCampaignBudgets(adapterCtx);
    checkAccountVelocity(budgetAmount, existingBudgets, ctx.config.safety);
  }
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
// campaignTools
// ---------------------------------------------------------------------------

export function campaignTools(ctx: ToolContext) {
  return {

    // ─── list_campaigns ────────────────────────────────────────────────────

    async list_campaigns(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);

        return adapter.listCampaigns(
          adapterCtx,
          {
            status: args['status'] as string | undefined,
          },
          typeof args['limit'] === 'number' ? args['limit'] : 20,
          args['cursor'] as string | undefined,
        );
      });
    },

    // ─── get_campaign ──────────────────────────────────────────────────────

    async get_campaign(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const campaignId = str(args['campaign_id']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getCampaign(adapterCtx, campaignId);
      });
    },

    // ─── create_campaign ───────────────────────────────────────────────────

    async create_campaign(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('create_campaign');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adapter = getAdapter(ctx, platform);
      const platformOptions = args['platform_options'] as Record<string, unknown> | undefined;
      validatePlatformOptions(adapter, platformOptions);

      const dryRun = args['dry_run'] === true;
      const input: Record<string, unknown> = {
        ...(asRecord(args['input'])),
        ...(platformOptions ? { platform_options: platformOptions } : {}),
      };

      if (dryRun) {
        return { dry_run: true, preview: input };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        await runBudgetGuards(ctx, input, platform, account);

        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.createCampaign(adapterCtx, input);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'create_campaign',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: input,
          result: 'ok',
        });

        return result;
      });
    },

    // ─── update_campaign ───────────────────────────────────────────────────

    async update_campaign(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('update_campaign');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const campaignId = str(args['campaign_id']);
      const adapter = getAdapter(ctx, platform);
      const platformOptions = args['platform_options'] as Record<string, unknown> | undefined;
      validatePlatformOptions(adapter, platformOptions);

      const dryRun = args['dry_run'] === true;
      const updates = asRecord(args['updates']);

      if (dryRun) {
        return { dry_run: true, campaign_id: campaignId, preview: updates };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        await runBudgetGuards(ctx, updates, platform, account);

        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.updateCampaign(adapterCtx, campaignId, updates);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'update_campaign',
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

    // ─── set_campaign_status ───────────────────────────────────────────────

    async set_campaign_status(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('set_campaign_status');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const campaignId = str(args['campaign_id']);
      const status = str(args['status']);
      const dryRun = args['dry_run'] === true;

      if (dryRun) {
        return { dry_run: true, campaign_id: campaignId, status };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.setCampaignStatus(adapterCtx, campaignId, status);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'set_campaign_status',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { campaign_id: campaignId, status },
          result: 'ok',
        });

        return result;
      });
    },

    // ─── delete_campaign ───────────────────────────────────────────────────

    async delete_campaign(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('delete_campaign');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const campaignId = str(args['campaign_id']);

      // Step 1: if no confirmation_token provided, issue one
      const confirmationToken = args['confirmation_token'] as string | undefined;
      if (!confirmationToken) {
        return ctx.deleteGuard.requestConfirmation(
          'campaign',
          campaignId,
          `Delete campaign ${campaignId} on platform ${platform} / account ${account}`,
        );
      }

      // Step 2: validate the token
      const confirmed = ctx.deleteGuard.confirm(confirmationToken);
      if (!confirmed) {
        throw new AdsError(
          'CONFIRMATION_REQUIRED',
          platform,
          `Invalid or expired confirmation_token. Request a new one by calling delete_campaign without confirmation_token.`,
          false,
        );
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        await adapter.deleteCampaign(adapterCtx, campaignId);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'delete_campaign',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { campaign_id: campaignId },
          result: 'ok',
        });

        return { deleted: true, campaign_id: campaignId };
      });
    },

    // ─── clone_campaign ────────────────────────────────────────────────────

    async clone_campaign(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('clone_campaign');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const campaignId = str(args['campaign_id']);
      const name = args['name'] as string | undefined;
      const dryRun = args['dry_run'] === true;

      if (dryRun) {
        return {
          dry_run: true,
          campaign_id: campaignId,
          new_name: name ?? `<original name> (copy)`,
        };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.cloneCampaign(adapterCtx, campaignId, name);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'clone_campaign',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { campaign_id: campaignId, ...(name ? { name } : {}) },
          result: 'ok',
        });

        return result;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions (JSON Schema for MCP ListTools)
// ---------------------------------------------------------------------------

export const CAMPAIGN_TOOL_DEFINITIONS = [
  {
    name: 'list_campaigns',
    description: 'List campaigns for a given platform and account.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Ad platform (meta, google, tiktok)' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
        status: { type: 'string', description: 'Filter by status (active, paused, archived)' },
        limit: { type: 'number', description: 'Max results per page (default 20)' },
        cursor: { type: 'string', description: 'Pagination cursor from previous response' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'get_campaign',
    description: 'Get a single campaign by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        campaign_id: { type: 'string' },
      },
      required: ['platform', 'campaign_id'],
    },
  },
  {
    name: 'create_campaign',
    description: 'Create a new campaign. Supports dry_run to preview without creating.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        input: {
          type: 'object',
          description: 'Campaign fields (name, objective, budget, schedule, status, etc.)',
        },
        platform_options: {
          type: 'object',
          description: 'Platform-specific options (e.g. special_ad_categories for Meta)',
        },
        dry_run: { type: 'boolean', description: 'Preview the operation without executing it' },
      },
      required: ['platform', 'input'],
    },
  },
  {
    name: 'update_campaign',
    description: 'Update an existing campaign. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        campaign_id: { type: 'string' },
        updates: { type: 'object', description: 'Fields to update' },
        platform_options: { type: 'object' },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'campaign_id', 'updates'],
    },
  },
  {
    name: 'set_campaign_status',
    description: 'Set the status of a campaign (active, paused, archived). Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        campaign_id: { type: 'string' },
        status: { type: 'string', enum: ['active', 'paused', 'archived'] },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'campaign_id', 'status'],
    },
  },
  {
    name: 'delete_campaign',
    description:
      'Delete a campaign. First call returns a confirmation_token. Second call with that token executes the delete.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        campaign_id: { type: 'string' },
        confirmation_token: {
          type: 'string',
          description: 'Token from first call. Omit on first call to get token.',
        },
      },
      required: ['platform', 'campaign_id'],
    },
  },
  {
    name: 'clone_campaign',
    description: 'Clone an existing campaign. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        campaign_id: { type: 'string' },
        name: { type: 'string', description: 'Name for the cloned campaign (optional)' },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'campaign_id'],
    },
  },
] as const;
