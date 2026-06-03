import type { ToolContext } from './register.js';

// ---------------------------------------------------------------------------
// systemTools
// ---------------------------------------------------------------------------

export function systemTools(ctx: ToolContext) {
  return {

    // ─── list_platforms ────────────────────────────────────────────────────
    // Reads from config — returns platform names + account count + status.

    async list_platforms(_args: Record<string, unknown>): Promise<unknown> {
      const platforms = ctx.config.platforms ?? {};
      const result: Array<{
        platform: string;
        account_count: number;
        default_account: string | undefined;
        status: 'configured' | 'no_accounts';
      }> = [];

      for (const [platformName, platformConfig] of Object.entries(platforms)) {
        const accountCount = Object.keys(platformConfig.accounts ?? {}).length;
        result.push({
          platform: platformName,
          account_count: accountCount,
          default_account: platformConfig.default_account,
          status: accountCount > 0 ? 'configured' : 'no_accounts',
        });
      }

      return { platforms: result };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const SYSTEM_TOOL_DEFINITIONS = [
  {
    name: 'list_platforms',
    description: 'List all configured ad platforms with account count and status.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
] as const;
