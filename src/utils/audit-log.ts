import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface AuditEntry {
  tool: string;
  platform: string;
  account: string;
  credential_fingerprint: string;
  dry_run: boolean;
  params: Record<string, unknown>;
  result: 'ok' | 'error' | string;
}

interface LogLine extends AuditEntry {
  timestamp: string;
  session_id: string;
  chain_hash: string;
}

export class AuditLog {
  private readonly sessionId: string;
  private lastHash: string;

  constructor(private readonly basePath: string) {
    mkdirSync(basePath, { recursive: true });
    this.sessionId = randomUUID();
    this.lastHash = 'genesis';
  }

  private currentLogPath(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return join(this.basePath, `audit-${yyyy}-${mm}-${dd}.jsonl`);
  }

  log(entry: AuditEntry): void {
    const chainHash = createHash('sha256').update(this.lastHash).digest('hex');
    this.lastHash = chainHash;

    const line: LogLine = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      chain_hash: chainHash,
      ...entry,
    };

    appendFileSync(this.currentLogPath(), JSON.stringify(line) + '\n', 'utf-8');
  }
}
