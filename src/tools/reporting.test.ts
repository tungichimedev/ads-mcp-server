import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseConfig } from '../utils/config.js';
import { reportingTools } from './reporting.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { AuditLog } from '../utils/audit-log.js';
import { TokenManager } from '../auth/token-manager.js';
import { DeleteGuard } from '../safety/delete-guard.js';
import type { ToolContext } from './register.js';
import type { BaseAdapter } from '../adapters/base.js';

// ---------------------------------------------------------------------------
// Minimal mocks
// ---------------------------------------------------------------------------

function makeMockKeychain() {
  return {
    getPassword: vi.fn().mockResolvedValue('mock-token'),
    setPassword: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCtx(adapter: Partial<BaseAdapter>): ToolContext {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ads-mcp-report-'));
  const config = parseConfig({ schema_version: 1 });
  const adapters = new Map<string, BaseAdapter>();
  adapters.set('meta', adapter as BaseAdapter);

  return {
    adapters,
    rateLimiter: new RateLimiter(),
    auditLog: new AuditLog(tmpDir),
    tokenManager: new TokenManager(makeMockKeychain()),
    deleteGuard: new DeleteGuard(),
    config,
  };
}

// ---------------------------------------------------------------------------
// Tests — date_range normalization (regression for "time_range must be non-empty")
// ---------------------------------------------------------------------------

describe('reportingTools date_range normalization', () => {
  let getPerformance: ReturnType<typeof vi.fn>;
  let getInsights: ReturnType<typeof vi.fn>;
  let tools: ReturnType<typeof reportingTools>;

  beforeEach(() => {
    getPerformance = vi.fn().mockResolvedValue([]);
    getInsights = vi.fn().mockResolvedValue([]);
    const adapter: Partial<BaseAdapter> = {
      platform: 'meta',
      getPerformance,
      getInsights,
    };
    tools = reportingTools(makeCtx(adapter));
  });

  it('maps schema fields {start,end} → {start_date,end_date} for get_performance', async () => {
    await tools.get_performance({
      platform: 'meta',
      account: 'acc1',
      entity_type: 'campaign',
      entity_id: '123',
      date_range: { start: '2026-03-01', end: '2026-03-31' },
    });

    expect(getPerformance).toHaveBeenCalledTimes(1);
    const dateRange = getPerformance.mock.calls[0][3];
    expect(dateRange).toMatchObject({ start_date: '2026-03-01', end_date: '2026-03-31' });
  });

  it('still accepts native {start_date,end_date} for get_performance', async () => {
    await tools.get_performance({
      platform: 'meta',
      account: 'acc1',
      entity_type: 'campaign',
      entity_id: '123',
      date_range: { start_date: '2026-03-01', end_date: '2026-03-31' },
    });

    const dateRange = getPerformance.mock.calls[0][3];
    expect(dateRange).toMatchObject({ start_date: '2026-03-01', end_date: '2026-03-31' });
  });

  it('maps {start,end} → {start_date,end_date} for get_insights', async () => {
    await tools.get_insights({
      platform: 'meta',
      account: 'acc1',
      entity_id: '123',
      breakdowns: ['age'],
      date_range: { start: '2026-03-01', end: '2026-03-31' },
    });

    expect(getInsights).toHaveBeenCalledTimes(1);
    const dateRange = getInsights.mock.calls[0][3];
    expect(dateRange).toMatchObject({ start_date: '2026-03-01', end_date: '2026-03-31' });
  });
});
