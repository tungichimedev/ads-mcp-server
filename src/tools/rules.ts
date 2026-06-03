import type { ToolContext } from './register.js';
import { getAdapter, resolveAccount } from './register.js';
import { enforceWritable } from '../safety/read-only.js';
import { AdsError } from '../utils/errors.js';
import type { DateRange } from '../models/platform.js';

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
// ruleTools
// ---------------------------------------------------------------------------

export function ruleTools(ctx: ToolContext) {
  return {

    // ─── list_rules ────────────────────────────────────────────────────────

    async list_rules(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.listRules(adapterCtx);
      });
    },

    // ─── create_rule ───────────────────────────────────────────────────────

    async create_rule(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('create_rule');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const dryRun = args['dry_run'] === true;
      const input = asRecord(args['input']);

      if (dryRun) {
        return { dry_run: true, preview: input };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.createRule(adapterCtx, input);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'create_rule',
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

    // ─── update_rule ───────────────────────────────────────────────────────

    async update_rule(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('update_rule');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const ruleId = str(args['rule_id']);
      const dryRun = args['dry_run'] === true;
      const updates = asRecord(args['updates']);

      if (dryRun) {
        return { dry_run: true, rule_id: ruleId, preview: updates };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.updateRule(adapterCtx, ruleId, updates);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'update_rule',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { rule_id: ruleId, ...updates },
          result: 'ok',
        });

        return result;
      });
    },

    // ─── delete_rule ───────────────────────────────────────────────────────

    async delete_rule(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('delete_rule');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const ruleId = str(args['rule_id']);

      // Step 1: if no confirmation_token provided, issue one
      const confirmationToken = args['confirmation_token'] as string | undefined;
      if (!confirmationToken) {
        return ctx.deleteGuard.requestConfirmation(
          'rule',
          ruleId,
          `Delete rule ${ruleId} on platform ${platform} / account ${account}`,
        );
      }

      // Step 2: validate the token
      const confirmed = ctx.deleteGuard.confirm(confirmationToken);
      if (!confirmed) {
        throw new AdsError(
          'CONFIRMATION_REQUIRED',
          platform,
          `Invalid or expired confirmation_token. Request a new one by calling delete_rule without confirmation_token.`,
          false,
        );
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        await adapter.deleteRule(adapterCtx, ruleId);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'delete_rule',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { rule_id: ruleId },
          result: 'ok',
        });

        return { deleted: true, rule_id: ruleId };
      });
    },

    // ─── get_rule_history ──────────────────────────────────────────────────

    async get_rule_history(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const ruleId = str(args['rule_id']);
      const dateRange = args['date_range'] as DateRange | undefined;

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getRuleHistory(adapterCtx, ruleId, dateRange);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const RULE_TOOL_DEFINITIONS = [
  {
    name: 'list_rules',
    description: 'List automated rules for a given platform and account.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Ad platform (meta, google, tiktok)' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'create_rule',
    description: 'Create a new automated rule. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        input: {
          type: 'object',
          description: 'Rule definition (name, conditions, actions, schedule, etc.)',
        },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'input'],
    },
  },
  {
    name: 'update_rule',
    description: 'Update an existing automated rule. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        rule_id: { type: 'string' },
        updates: { type: 'object', description: 'Fields to update' },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'rule_id', 'updates'],
    },
  },
  {
    name: 'delete_rule',
    description:
      'Delete an automated rule. First call returns a confirmation_token. Second call with that token executes the delete.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        rule_id: { type: 'string' },
        confirmation_token: { type: 'string', description: 'Token from first call. Omit on first call to get token.' },
      },
      required: ['platform', 'rule_id'],
    },
  },
  {
    name: 'get_rule_history',
    description: 'Get the execution history for an automated rule.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        rule_id: { type: 'string' },
        date_range: {
          type: 'object',
          description: 'Optional date range (start, end as YYYY-MM-DD)',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
        },
      },
      required: ['platform', 'rule_id'],
    },
  },
] as const;
