import type { ToolContext } from './register.js';
import { getAdapter, resolveAccount } from './register.js';
import { enforceWritable } from '../safety/read-only.js';
import {
  validatePath,
  CREATIVE_EXTENSIONS,
  AUDIENCE_FILE_EXTENSIONS,
} from '../safety/path-guard.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
// Allowed uploads directory
// ---------------------------------------------------------------------------

function uploadsDir(): string {
  return join(homedir(), 'ads-mcp-uploads');
}

// ---------------------------------------------------------------------------
// creativeTools
// ---------------------------------------------------------------------------

export function creativeTools(ctx: ToolContext) {
  return {

    // ─── upload_creative ───────────────────────────────────────────────────

    async upload_creative(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('upload_creative');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const sourceType = str(args['source_type'] ?? 'local_path');
      const mediaType = str(args['media_type'] ?? 'image');
      let filePath = str(args['file_path']);

      if (sourceType === 'local_path') {
        filePath = validatePath(filePath, uploadsDir(), CREATIVE_EXTENSIONS);
      }
      // If source_type === 'url', pass through without path validation

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.uploadCreative(adapterCtx, filePath, mediaType);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'upload_creative',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { source_type: sourceType, media_type: mediaType, file_path: filePath },
          result: 'ok',
        });

        return result;
      });
    },

    // ─── upload_audience_file ──────────────────────────────────────────────

    async upload_audience_file(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('upload_audience_file');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const sourceType = str(args['source_type'] ?? 'local_path');
      let filePath = str(args['file_path']);

      if (sourceType === 'local_path') {
        filePath = validatePath(filePath, uploadsDir(), AUDIENCE_FILE_EXTENSIONS);
      }
      // If source_type === 'url', pass through without path validation

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.uploadAudienceFile(adapterCtx, filePath);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'upload_audience_file',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { source_type: sourceType, file_path: filePath },
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

export const CREATIVE_TOOL_DEFINITIONS = [
  {
    name: 'upload_creative',
    description: 'Upload a creative asset (image or video) from a local path or URL.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Ad platform (meta, google, tiktok)' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
        source_type: {
          type: 'string',
          enum: ['local_path', 'url'],
          description: 'Whether file_path is a local filesystem path or a URL',
        },
        file_path: { type: 'string', description: 'Local file path or URL to the creative asset' },
        media_type: {
          type: 'string',
          enum: ['image', 'video'],
          description: 'Media type of the creative',
        },
      },
      required: ['platform', 'file_path'],
    },
  },
  {
    name: 'upload_audience_file',
    description: 'Upload a CSV audience file for custom audience creation.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Ad platform (meta, google, tiktok)' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
        source_type: {
          type: 'string',
          enum: ['local_path', 'url'],
          description: 'Whether file_path is a local filesystem path or a URL',
        },
        file_path: { type: 'string', description: 'Local path or URL to the CSV audience file' },
      },
      required: ['platform', 'file_path'],
    },
  },
] as const;
