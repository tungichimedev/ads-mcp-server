import { describe, it, expect, vi, beforeEach } from 'vitest';
import { keywordTools } from './keywords.js';
import { AdsError } from '../utils/errors.js';
import { setReadOnly } from '../safety/read-only.js';
import type { ToolContext } from './register.js';
import type { BaseAdapter } from '../adapters/base.js';

// ---------------------------------------------------------------------------
// Mock adapter and context
// ---------------------------------------------------------------------------

function createMockAdapter(overrides: Partial<BaseAdapter> = {}): BaseAdapter {
  return {
    platform: 'google',
    allowedPlatformOptions: [],
    listKeywords: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, page_size: 20, has_next_page: false } }),
    addKeywords: vi.fn().mockResolvedValue({ ad_group_id: '123', keywords_added: 2 }),
    removeKeywords: vi.fn().mockResolvedValue(undefined),
    listNegativeKeywords: vi.fn().mockResolvedValue([]),
    addNegativeKeywords: vi.fn().mockResolvedValue({ entity_id: '456', entity_type: 'campaign', keywords_added: 1 }),
    getSearchTerms: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as BaseAdapter;
}

function createMockContext(adapter?: BaseAdapter): ToolContext {
  const a = adapter ?? createMockAdapter();
  const adapters = new Map<string, BaseAdapter>([['google', a]]);

  return {
    adapters,
    rateLimiter: { execute: (_p: string, _a: string, fn: () => Promise<any>) => fn() } as any,
    auditLog: { log: vi.fn() } as any,
    tokenManager: { credentialFingerprint: vi.fn().mockResolvedValue('sha256:abc12345') } as any,
    deleteGuard: {} as any,
    config: {
      schema_version: 1,
      safety: { max_daily_budget_per_campaign_usd: 100, max_lifetime_budget_per_campaign_usd: 5000, max_account_daily_spend_usd: 500 },
      platforms: { google: { default_account: 'test-acct', accounts: { 'test-acct': { account_id: '1234567890' } } } },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('keywordTools', () => {
  beforeEach(() => {
    setReadOnly(false);
  });

  describe('assertGoogle guard', () => {
    it('rejects non-Google platforms', async () => {
      const ctx = createMockContext();
      const tools = keywordTools(ctx);

      try {
        await tools.list_keywords({ platform: 'meta', ad_group_id: '123' });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AdsError);
        expect((err as AdsError).code).toBe('ACCOUNT_ISSUE');
        expect((err as AdsError).message).toMatch(/Google Ads/);
      }
    });

    it('rejects TikTok platform', async () => {
      const ctx = createMockContext();
      const tools = keywordTools(ctx);

      try {
        await tools.add_keywords({ platform: 'tiktok', ad_group_id: '123', keywords: ['test'] });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AdsError);
        expect((err as AdsError).code).toBe('ACCOUNT_ISSUE');
      }
    });
  });

  describe('entityType validation', () => {
    it('rejects invalid entity_type', async () => {
      const ctx = createMockContext();
      const tools = keywordTools(ctx);

      try {
        await tools.list_negative_keywords({ platform: 'google', entity_id: '123', entity_type: 'account' });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AdsError);
        expect((err as AdsError).message).toMatch(/entity_type/);
      }
    });

    it('accepts campaign entity_type', async () => {
      const ctx = createMockContext();
      const tools = keywordTools(ctx);
      const result = await tools.list_negative_keywords({ platform: 'google', entity_id: '123', entity_type: 'campaign' });
      expect(result).toEqual([]);
    });

    it('accepts ad_group entity_type', async () => {
      const ctx = createMockContext();
      const tools = keywordTools(ctx);
      const result = await tools.list_negative_keywords({ platform: 'google', entity_id: '123', entity_type: 'ad_group' });
      expect(result).toEqual([]);
    });
  });

  describe('read-only mode', () => {
    it('blocks add_keywords in read-only mode', async () => {
      setReadOnly(true);
      const ctx = createMockContext();
      const tools = keywordTools(ctx);

      try {
        await tools.add_keywords({ platform: 'google', ad_group_id: '123', keywords: ['test'] });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AdsError);
        expect((err as AdsError).code).toBe('READ_ONLY_MODE');
      }
    });

    it('blocks remove_keywords in read-only mode', async () => {
      setReadOnly(true);
      const ctx = createMockContext();
      const tools = keywordTools(ctx);

      try {
        await tools.remove_keywords({ platform: 'google', ad_group_id: '123', keyword_ids: ['1'] });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AdsError);
        expect((err as AdsError).code).toBe('READ_ONLY_MODE');
      }
    });

    it('blocks add_negative_keywords in read-only mode', async () => {
      setReadOnly(true);
      const ctx = createMockContext();
      const tools = keywordTools(ctx);

      try {
        await tools.add_negative_keywords({ platform: 'google', entity_id: '123', keywords: ['test'] });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AdsError);
        expect((err as AdsError).code).toBe('READ_ONLY_MODE');
      }
    });

    it('allows list_keywords in read-only mode', async () => {
      setReadOnly(true);
      const ctx = createMockContext();
      const tools = keywordTools(ctx);
      const result = await tools.list_keywords({ platform: 'google', ad_group_id: '123' });
      expect(result).toBeDefined();
    });
  });

  describe('dry_run', () => {
    it('returns preview for add_keywords without calling adapter', async () => {
      const adapter = createMockAdapter();
      const ctx = createMockContext(adapter);
      const tools = keywordTools(ctx);

      const result = await tools.add_keywords({
        platform: 'google',
        ad_group_id: '123',
        keywords: ['buy shoes', 'running shoes'],
        match_type: 'exact',
        dry_run: true,
      });

      expect(result).toEqual({
        dry_run: true,
        ad_group_id: '123',
        keywords: ['buy shoes', 'running shoes'],
        match_type: 'exact',
      });
      expect(adapter.addKeywords).not.toHaveBeenCalled();
    });

    it('returns preview for remove_keywords without calling adapter', async () => {
      const adapter = createMockAdapter();
      const ctx = createMockContext(adapter);
      const tools = keywordTools(ctx);

      const result = await tools.remove_keywords({
        platform: 'google',
        ad_group_id: '123',
        keyword_ids: ['kw1', 'kw2'],
        dry_run: true,
      });

      expect(result).toEqual({
        dry_run: true,
        ad_group_id: '123',
        keyword_ids: ['kw1', 'kw2'],
      });
      expect(adapter.removeKeywords).not.toHaveBeenCalled();
    });
  });

  describe('adapter calls', () => {
    it('list_keywords calls adapter.listKeywords with correct args', async () => {
      const adapter = createMockAdapter();
      const ctx = createMockContext(adapter);
      const tools = keywordTools(ctx);

      await tools.list_keywords({ platform: 'google', ad_group_id: '456', limit: 10 });

      expect(adapter.listKeywords).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'test-acct' }),
        '456',
        10,
        undefined,
      );
    });

    it('add_keywords calls adapter.addKeywords', async () => {
      const adapter = createMockAdapter();
      const ctx = createMockContext(adapter);
      const tools = keywordTools(ctx);

      await tools.add_keywords({
        platform: 'google',
        ad_group_id: '789',
        keywords: ['test keyword'],
        match_type: 'phrase',
      });

      expect(adapter.addKeywords).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'test-acct' }),
        '789',
        ['test keyword'],
        'phrase',
      );
    });

    it('remove_keywords calls adapter.removeKeywords', async () => {
      const adapter = createMockAdapter();
      const ctx = createMockContext(adapter);
      const tools = keywordTools(ctx);

      await tools.remove_keywords({
        platform: 'google',
        ad_group_id: '789',
        keyword_ids: ['kw1'],
      });

      expect(adapter.removeKeywords).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'test-acct' }),
        '789',
        ['kw1'],
      );
    });

    it('get_search_terms calls adapter.getSearchTerms', async () => {
      const adapter = createMockAdapter();
      const ctx = createMockContext(adapter);
      const tools = keywordTools(ctx);

      await tools.get_search_terms({
        platform: 'google',
        ad_group_id: '123',
        date_range: { start_date: '2024-01-01', end_date: '2024-01-31' },
      });

      expect(adapter.getSearchTerms).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'test-acct' }),
        '123',
        { start_date: '2024-01-01', end_date: '2024-01-31' },
      );
    });
  });

  describe('audit logging', () => {
    it('logs mutations to audit log', async () => {
      const ctx = createMockContext();
      const tools = keywordTools(ctx);

      await tools.add_keywords({
        platform: 'google',
        ad_group_id: '123',
        keywords: ['test'],
        match_type: 'broad',
      });

      expect(ctx.auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'add_keywords',
          platform: 'google',
          account: 'test-acct',
          dry_run: false,
          result: 'ok',
        }),
      );
    });

    it('logs read operations to audit log', async () => {
      const ctx = createMockContext();
      const tools = keywordTools(ctx);

      await tools.list_keywords({ platform: 'google', ad_group_id: '123' });

      expect(ctx.auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'list_keywords',
          platform: 'google',
          account: 'test-acct',
        }),
      );
    });

    it('does not log on dry_run', async () => {
      const ctx = createMockContext();
      const tools = keywordTools(ctx);

      await tools.add_keywords({
        platform: 'google',
        ad_group_id: '123',
        keywords: ['test'],
        dry_run: true,
      });

      expect(ctx.auditLog.log).not.toHaveBeenCalled();
    });
  });

  describe('date_range compatibility', () => {
    it('accepts start/end as aliases for start_date/end_date', async () => {
      const adapter = createMockAdapter();
      const ctx = createMockContext(adapter);
      const tools = keywordTools(ctx);

      await tools.get_search_terms({
        platform: 'google',
        ad_group_id: '123',
        date_range: { start: '2024-01-01', end: '2024-01-31' },
      });

      expect(adapter.getSearchTerms).toHaveBeenCalledWith(
        expect.anything(),
        '123',
        { start_date: '2024-01-01', end_date: '2024-01-31' },
      );
    });
  });

  describe('default limit', () => {
    it('uses default limit of 20 when not specified', async () => {
      const adapter = createMockAdapter();
      const ctx = createMockContext(adapter);
      const tools = keywordTools(ctx);

      await tools.list_keywords({ platform: 'google', ad_group_id: '123' });

      expect(adapter.listKeywords).toHaveBeenCalledWith(
        expect.anything(),
        '123',
        20,
        undefined,
      );
    });
  });
});
