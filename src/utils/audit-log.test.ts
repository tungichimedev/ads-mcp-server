import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuditLog } from './audit-log.js';

describe('AuditLog stdout mode', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('writes JSON to stdout instead of filesystem', () => {
    const log = new AuditLog('/unused', 'stdout');
    log.log({
      tool: 'list_campaigns',
      platform: 'meta',
      account: 'test',
      credential_fingerprint: 'sha256:abc',
      dry_run: false,
      params: {},
      result: 'ok',
    });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.tool).toBe('list_campaigns');
    expect(output.chain_hash).toBeDefined();
    expect(output.session_id).toBeDefined();
  });

  it('does not call mkdirSync in stdout mode', () => {
    const log = new AuditLog('/nonexistent/path/that/would/fail', 'stdout');
    expect(log).toBeDefined();
  });
});
