import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AuditLog } from './audit-log.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'audit-log-test-'));
}

function readLines(dir: string): LogLine[] {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const logPath = join(dir, `audit-${yyyy}-${mm}-${dd}.jsonl`);
  return readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogLine);
}

interface LogLine {
  timestamp: string;
  session_id: string;
  chain_hash: string;
  tool: string;
  platform: string;
  account: string;
  credential_fingerprint: string;
  dry_run: boolean;
  params: Record<string, unknown>;
  result: string;
}

describe('AuditLog', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a log entry with all required fields', () => {
    const log = new AuditLog(tmpDir);

    log.log({
      tool: 'create_campaign',
      platform: 'meta',
      account: 'brand_a',
      credential_fingerprint: 'fp_abc123',
      dry_run: false,
      params: { name: 'Summer Sale', budget: 100 },
      result: 'ok',
    });

    const lines = readLines(tmpDir);
    expect(lines).toHaveLength(1);

    const entry = lines[0];
    expect(entry.tool).toBe('create_campaign');
    expect(entry.platform).toBe('meta');
    expect(entry.account).toBe('brand_a');
    expect(entry.credential_fingerprint).toBe('fp_abc123');
    expect(entry.dry_run).toBe(false);
    expect(entry.params).toEqual({ name: 'Summer Sale', budget: 100 });
    expect(entry.result).toBe('ok');
    expect(typeof entry.timestamp).toBe('string');
    expect(typeof entry.session_id).toBe('string');
    expect(typeof entry.chain_hash).toBe('string');
    expect(entry.chain_hash).toHaveLength(64); // SHA-256 hex
  });

  it('chains hashes across entries (each entry hashes the previous chain_hash)', () => {
    const log = new AuditLog(tmpDir);

    const baseEntry = {
      tool: 'update_budget',
      platform: 'google',
      account: 'acct1',
      credential_fingerprint: 'fp_xyz',
      dry_run: true,
      params: {},
      result: 'ok',
    };

    log.log(baseEntry);
    log.log(baseEntry);

    const lines = readLines(tmpDir);
    expect(lines).toHaveLength(2);

    const first = lines[0];
    const second = lines[1];

    // First entry's chain_hash is SHA-256 of 'genesis'
    const expectedFirstHash = createHash('sha256').update('genesis').digest('hex');
    expect(first.chain_hash).toBe(expectedFirstHash);

    // Second entry's chain_hash is SHA-256 of the first entry's chain_hash
    const expectedSecondHash = createHash('sha256').update(first.chain_hash).digest('hex');
    expect(second.chain_hash).toBe(expectedSecondHash);

    // The two hashes must be different
    expect(first.chain_hash).not.toBe(second.chain_hash);
  });

  it('creates the base directory if it does not exist', () => {
    const nestedDir = join(tmpDir, 'nested', 'deep', 'audit');
    const log = new AuditLog(nestedDir);

    log.log({
      tool: 'list_campaigns',
      platform: 'tiktok',
      account: 'acct2',
      credential_fingerprint: 'fp_000',
      dry_run: false,
      params: {},
      result: 'ok',
    });

    const lines = readLines(nestedDir);
    expect(lines).toHaveLength(1);
    expect(lines[0].tool).toBe('list_campaigns');
  });
});
