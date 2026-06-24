import type { ToolContext } from './register.js';
import { getAdapter, resolveAccount } from './register.js';
import { AdsError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// Input shape helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function buildAdapterCtx(
  ctx: ToolContext,
  platform: string,
  account: string,
): import('../adapters/base.js').AdapterContext {
  const accountMeta =
    (ctx.config.platforms?.[platform]?.accounts?.[account] as Record<string, unknown>) ?? {};
  return { account, accountMeta };
}

// Defense-in-depth: adapter stubs also reject non-Google.
function assertGoogle(platform: string): void {
  if (platform !== 'google') {
    throw new AdsError(
      'ACCOUNT_ISSUE',
      platform,
      `Policy tools are only available for the Google Ads platform. Got: "${platform}"`,
      false,
    );
  }
}

// ---------------------------------------------------------------------------
// policyTools
// ---------------------------------------------------------------------------

export function policyTools(ctx: ToolContext) {
  return {

    // ─── get_ad_policy ───────────────────────────────────────────────────────

    async get_ad_policy(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      assertGoogle(platform);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adId = str(args['ad_id']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getAdPolicy(adapterCtx, adId);
      });
    },

    // ─── get_policy_issues ───────────────────────────────────────────────────

    async get_policy_issues(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      assertGoogle(platform);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);

      const scope = {
        campaignId: args['campaign_id'] ? str(args['campaign_id']) : undefined,
        adGroupId: args['ad_group_id'] ? str(args['ad_group_id']) : undefined,
      };
      const options = {
        includeAssets: args['include_assets'] !== false, // default true
        includeApproved: args['include_approved'] === true, // default false
        limit: typeof args['limit'] === 'number' ? (args['limit'] as number) : 200,
      };

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const issues = await adapter.getPolicyIssues(adapterCtx, scope, options);
        return {
          scope,
          count: issues.length,
          issues,
        };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const POLICY_TOOL_DEFINITIONS = [
  {
    name: 'get_ad_policy',
    description:
      'Get the policy/approval status of a single ad, including approval status (APPROVED, APPROVED_LIMITED, DISAPPROVED), review status, and the specific policy topics flagged. Google Ads only.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Must be "google"' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
        ad_id: { type: 'string', description: 'Ad ID to check policy for' },
      },
      required: ['platform', 'ad_id'],
    },
  },
  {
    name: 'get_policy_issues',
    description:
      'Scan a campaign, ad group, or the whole account for ads and assets that are disapproved or limited by policy, returning the exact policy topics (the reason) for each so you know what to fix or appeal. Covers asset-level policy for App/UAC campaigns ("limited by policy"). Google Ads only.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Must be "google"' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
        campaign_id: { type: 'string', description: 'Limit the scan to this campaign (optional)' },
        ad_group_id: { type: 'string', description: 'Limit the scan to this ad group (optional)' },
        include_assets: {
          type: 'boolean',
          description: 'Include asset-level policy (App campaigns). Default true.',
        },
        include_approved: {
          type: 'boolean',
          description: 'Include fully-approved ads/assets too. Default false (issues only).',
        },
        limit: { type: 'number', description: 'Max rows per level (default 200)' },
      },
      required: ['platform'],
    },
  },
] as const;
