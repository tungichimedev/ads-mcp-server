# GCP Cloud Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy ads-mcp-server to GCP Cloud Run with Streamable HTTP transport, Secret Manager credentials, and Cloud Logging.

**Architecture:** Add an HTTP transport mode alongside the existing stdio transport. When `PORT` env var is set (Cloud Run), the server starts an Express HTTP server with the MCP SDK's `StreamableHTTPServerTransport` in stateless mode. Credentials come from GCP Secret Manager instead of OS keychain. Audit logs write to stdout (Cloud Logging) instead of files.

**Tech Stack:** Express, `@modelcontextprotocol/sdk` StreamableHTTPServerTransport, `@google-cloud/secret-manager`, Docker, `gcloud` CLI

**Spec:** `docs/superpowers/specs/2026-06-06-gcp-cloud-deployment-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/auth/secret-manager.ts` | `KeychainProvider` implementation backed by GCP Secret Manager |
| `src/auth/secret-manager.test.ts` | Tests for Secret Manager provider (mocked GCP client) |
| `src/utils/audit-log.ts` | Modified: add `stdout` output mode alongside existing `file` mode |
| `src/utils/audit-log.test.ts` | Existing test file — add tests for stdout mode |
| `src/utils/config.ts` | Modified: add Secret Manager config loading when `K_SERVICE` is set |
| `src/auth/keychain.ts` | Modified: auto-detect Cloud Run env and use Secret Manager provider |
| `src/index.ts` | Modified: extract `createServer()` factory, add HTTP transport mode |
| `package.json` | Modified: add deps, move keytar to optionalDependencies |
| `Dockerfile` | New: multi-stage build for Cloud Run |
| `.dockerignore` | New: exclude unnecessary files from Docker build |
| `scripts/gcp-setup.sh` | New: one-time GCP project + deploy script |
| `scripts/gcp-deploy.sh` | New: quick redeploy script |
| `scripts/rotate-token.sh` | New: manual token rotation for Meta/TikTok |
| `scripts/mcp-proxy.sh` | New: local auth proxy for Claude Code |
| `docs/DEPLOYMENT.md` | New: deployment guide |

---

### Task 1: Secret Manager KeychainProvider

**Files:**
- Create: `src/auth/secret-manager.ts`
- Create: `src/auth/secret-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/auth/secret-manager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecretManagerKeychainProvider, toSecretName } from './secret-manager.js';

describe('toSecretName', () => {
  it('converts colon-separated keys to double-dash', () => {
    expect(toSecretName('meta:my-account')).toBe('meta--my-account');
  });

  it('handles multiple colons', () => {
    expect(toSecretName('google:acct:expires')).toBe('google--acct--expires');
  });

  it('handles keys with no colons', () => {
    expect(toSecretName('simple')).toBe('simple');
  });
});

describe('SecretManagerKeychainProvider', () => {
  let mockClient: any;
  let provider: SecretManagerKeychainProvider;

  beforeEach(() => {
    mockClient = {
      getProjectId: vi.fn().mockResolvedValue('test-project'),
      accessSecretVersion: vi.fn(),
      addSecretVersion: vi.fn(),
      createSecret: vi.fn(),
    };
    provider = new SecretManagerKeychainProvider(mockClient);
  });

  it('getPassword returns secret value', async () => {
    mockClient.accessSecretVersion.mockResolvedValue([{
      payload: { data: Buffer.from('my-token') },
    }]);

    const result = await provider.getPassword('ads-mcp', 'meta:my-account');

    expect(result).toBe('my-token');
    expect(mockClient.accessSecretVersion).toHaveBeenCalledWith({
      name: 'projects/test-project/secrets/meta--my-account/versions/latest',
    });
  });

  it('getPassword returns null when secret not found', async () => {
    mockClient.accessSecretVersion.mockRejectedValue({ code: 5 }); // NOT_FOUND

    const result = await provider.getPassword('ads-mcp', 'meta:missing');
    expect(result).toBeNull();
  });

  it('setPassword creates or updates a secret version', async () => {
    mockClient.addSecretVersion.mockResolvedValue([{}]);

    await provider.setPassword('ads-mcp', 'meta:my-account', 'new-token');

    expect(mockClient.addSecretVersion).toHaveBeenCalledWith({
      parent: 'projects/test-project/secrets/meta--my-account',
      payload: { data: Buffer.from('new-token') },
    });
  });

  it('setPassword creates secret if addSecretVersion fails with NOT_FOUND', async () => {
    mockClient.addSecretVersion
      .mockRejectedValueOnce({ code: 5 }) // NOT_FOUND — secret doesn't exist
      .mockResolvedValueOnce([{}]); // retry succeeds
    mockClient.createSecret.mockResolvedValue([{}]);

    await provider.setPassword('ads-mcp', 'meta:new-account', 'token');

    expect(mockClient.createSecret).toHaveBeenCalledWith({
      parent: 'projects/test-project',
      secretId: 'meta--new-account',
      secret: { replication: { automatic: {} } },
    });
    expect(mockClient.addSecretVersion).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/auth/secret-manager.test.ts`
Expected: FAIL — module `./secret-manager.js` not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/auth/secret-manager.ts
import type { KeychainProvider } from './keychain.js';

/** Converts keychain account keys (colon-separated) to Secret Manager IDs (double-dash). */
export function toSecretName(account: string): string {
  return account.replace(/:/g, '--');
}

export class SecretManagerKeychainProvider implements KeychainProvider {
  private projectId: string | null = null;

  constructor(private readonly client: any) {}

  private async getProjectId(): Promise<string> {
    if (!this.projectId) {
      this.projectId = await this.client.getProjectId();
    }
    return this.projectId;
  }

  async getPassword(_service: string, account: string): Promise<string | null> {
    const projectId = await this.getProjectId();
    const secretName = toSecretName(account);

    try {
      const [version] = await this.client.accessSecretVersion({
        name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
      });
      return version.payload?.data?.toString() ?? null;
    } catch (err: any) {
      if (err.code === 5) return null; // NOT_FOUND
      throw err;
    }
  }

  async setPassword(_service: string, account: string, password: string): Promise<void> {
    const projectId = await this.getProjectId();
    const secretName = toSecretName(account);

    try {
      await this.client.addSecretVersion({
        parent: `projects/${projectId}/secrets/${secretName}`,
        payload: { data: Buffer.from(password) },
      });
    } catch (err: any) {
      if (err.code === 5) {
        // Secret doesn't exist yet — create it, then add version
        await this.client.createSecret({
          parent: `projects/${projectId}`,
          secretId: secretName,
          secret: { replication: { automatic: {} } },
        });
        await this.client.addSecretVersion({
          parent: `projects/${projectId}/secrets/${secretName}`,
          payload: { data: Buffer.from(password) },
        });
        return;
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/auth/secret-manager.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/auth/secret-manager.ts src/auth/secret-manager.test.ts
git commit -m "feat: add Secret Manager KeychainProvider for Cloud Run"
```

---

### Task 2: AuditLog stdout mode

**Files:**
- Modify: `src/utils/audit-log.ts`
- Existing tests: `src/utils/audit-log.test.ts` (if exists, otherwise create)

- [ ] **Step 1: Write the failing test**

Create or append to `src/utils/audit-log.test.ts`:

```typescript
// src/utils/audit-log.test.ts
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
    // If mkdirSync were called with an invalid path, it would throw
    const log = new AuditLog('/nonexistent/path/that/would/fail', 'stdout');
    expect(log).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/audit-log.test.ts`
Expected: FAIL — AuditLog constructor doesn't accept second argument

- [ ] **Step 3: Update AuditLog implementation**

Replace `src/utils/audit-log.ts`:

```typescript
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

export type AuditOutput = 'file' | 'stdout';

export class AuditLog {
  private readonly sessionId: string;
  private lastHash: string;
  private readonly output: AuditOutput;

  constructor(private readonly basePath: string, output: AuditOutput = 'file') {
    this.output = output;
    if (output === 'file') {
      mkdirSync(basePath, { recursive: true });
    }
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

    if (this.output === 'stdout') {
      console.log(JSON.stringify(line));
    } else {
      appendFileSync(this.currentLogPath(), JSON.stringify(line) + '\n', 'utf-8');
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/audit-log.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `npm test`
Expected: All 379+ tests pass

- [ ] **Step 6: Commit**

```bash
git add src/utils/audit-log.ts src/utils/audit-log.test.ts
git commit -m "feat: add stdout output mode to AuditLog for Cloud Logging"
```

---

### Task 3: Config loading from Secret Manager

**Files:**
- Modify: `src/utils/config.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/utils/config.test.ts` (or create it):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { parseConfig } from './config.js';

describe('parseConfig', () => {
  it('parses valid config with safety defaults', () => {
    const config = parseConfig({
      schema_version: 1,
      platforms: {
        google: {
          default_account: 'test',
          accounts: { test: { account_id: '123' } },
        },
      },
    });

    expect(config.safety.max_daily_budget_per_campaign_usd).toBe(100);
    expect(config.platforms?.['google']?.default_account).toBe('test');
  });

  it('throws on missing schema_version', () => {
    expect(() => parseConfig({})).toThrow(/schema_version/);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (existing logic)**

Run: `npx vitest run src/utils/config.test.ts`
Expected: PASS (this validates the existing `parseConfig` function)

- [ ] **Step 3: Add `loadConfigFromSecret` function**

Add to `src/utils/config.ts` before the `loadConfig` function:

```typescript
/**
 * Loads config from GCP Secret Manager (used on Cloud Run).
 * Requires `@google-cloud/secret-manager` to be installed.
 */
async function loadConfigFromSecret(): Promise<AdsConfig> {
  const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
  const client = new SecretManagerServiceClient();
  const projectId = await client.getProjectId();

  try {
    const [version] = await client.accessSecretVersion({
      name: `projects/${projectId}/secrets/ads-mcp-config/versions/latest`,
    });
    const payload = version.payload?.data?.toString();
    if (!payload) return FALLBACK_CONFIG;
    return parseConfig(JSON.parse(payload));
  } catch {
    return FALLBACK_CONFIG;
  }
}
```

- [ ] **Step 4: Modify `loadConfig` to detect Cloud Run**

Replace the `loadConfig` function:

```typescript
/**
 * Reads config from Secret Manager (Cloud Run) or filesystem (local).
 * Falls back to FALLBACK_CONFIG if not available.
 */
export async function loadConfig(basePath: string): Promise<AdsConfig> {
  // Cloud Run: load from Secret Manager
  if (process.env['K_SERVICE']) {
    return loadConfigFromSecret();
  }

  // Local: load from filesystem
  const configPath = join(basePath, 'config.json');
  let raw: unknown;

  try {
    const text = await readFile(configPath, 'utf-8');
    raw = JSON.parse(text);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return FALLBACK_CONFIG;
    }
    throw err;
  }

  return parseConfig(raw);
}
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass (the Cloud Run path won't execute in tests since `K_SERVICE` is not set)

- [ ] **Step 6: Commit**

```bash
git add src/utils/config.ts src/utils/config.test.ts
git commit -m "feat: load config from Secret Manager on Cloud Run"
```

---

### Task 4: Auto-detect Cloud Run in keychain init

**Files:**
- Modify: `src/auth/keychain.ts`

- [ ] **Step 1: Update keychain.ts to detect Cloud Run**

Add the Cloud Run detection to `initKeychain()`. Insert before the keytar import:

```typescript
/**
 * Dynamically imports keytar and stores it as the active provider.
 * On Cloud Run (K_SERVICE env var set), uses Secret Manager instead.
 */
export async function initKeychain(): Promise<void> {
  if (process.env['K_SERVICE']) {
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
    const { SecretManagerKeychainProvider } = await import('./secret-manager.js');
    const client = new SecretManagerServiceClient();
    provider = new SecretManagerKeychainProvider(client);
    return;
  }

  const keytar = await import('keytar');
  provider = {
    getPassword: (service, account) => keytar.default.getPassword(service, account),
    setPassword: (service, account, password) =>
      keytar.default.setPassword(service, account, password),
  };
}
```

- [ ] **Step 2: Build and test**

Run: `npm run build && npm test`
Expected: Clean build, all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/auth/keychain.ts
git commit -m "feat: auto-detect Cloud Run and use Secret Manager for keychain"
```

---

### Task 5: HTTP transport + server factory in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add new imports at top of index.ts**

Add after the existing imports (line 6):

```typescript
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
```

- [ ] **Step 2: Extract `createServer` factory function**

Add after the `ToolContext` type import (around line 27). This function encapsulates all tool handler and server setup:

```typescript
function createServer(ctx: ToolContext): Server {
  const allToolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    ...campaignTools(ctx),
    ...adsetTools(ctx),
    ...adTools(ctx),
    ...creativeTools(ctx),
    ...audienceTools(ctx),
    ...reportingTools(ctx),
    ...budgetTools(ctx),
    ...ruleTools(ctx),
    ...trackingTools(ctx),
    ...keywordTools(ctx),
    ...accountTools(ctx),
    ...systemTools(ctx),
  };

  const allToolDefinitions = [
    ...CAMPAIGN_TOOL_DEFINITIONS,
    ...ADSET_TOOL_DEFINITIONS,
    ...AD_TOOL_DEFINITIONS,
    ...CREATIVE_TOOL_DEFINITIONS,
    ...AUDIENCE_TOOL_DEFINITIONS,
    ...REPORTING_TOOL_DEFINITIONS,
    ...BUDGET_TOOL_DEFINITIONS,
    ...RULE_TOOL_DEFINITIONS,
    ...TRACKING_TOOL_DEFINITIONS,
    ...KEYWORD_TOOL_DEFINITIONS,
    ...ACCOUNT_TOOL_DEFINITIONS,
    ...SYSTEM_TOOL_DEFINITIONS,
  ];

  const server = new Server(
    { name: 'ads-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allToolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    const handler = allToolHandlers[name];
    if (!handler) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    try {
      const result = await handler(args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      if (err instanceof AdsError) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(err.toJSON(), null, 2) }],
          isError: true,
        };
      }
      throw err;
    }
  });

  return server;
}
```

- [ ] **Step 3: Replace the transport section in `main()`**

Replace the current code from `// ── Tool handlers` through the end of `main()` with:

```typescript
  // ── AuditLog (stdout on Cloud Run, file locally) ────────────────────────
  const auditOutput = process.env['K_SERVICE'] ? 'stdout' as const : 'file' as const;
  const auditLog = new AuditLog(join(adsMcpHome, 'audit'), auditOutput);
  const deleteGuard = new DeleteGuard();

  const ctx: ToolContext = {
    adapters,
    rateLimiter,
    auditLog,
    tokenManager,
    deleteGuard,
    config,
  };

  // ── Transport ──────────────────────────────────────────────────────────
  if (process.env['PORT']) {
    // Cloud Run / HTTP mode
    const app = createMcpExpressApp({ host: '0.0.0.0' });

    app.get('/health', (_req, res) => {
      res.status(200).json({ status: 'ok' });
    });

    app.post('/mcp', async (req, res) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = createServer(ctx);
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on('close', () => {
          transport.close();
          server.close();
        });
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

    app.get('/mcp', (_req, res) => {
      res.writeHead(405).end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      }));
    });

    app.delete('/mcp', (_req, res) => {
      res.writeHead(405).end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      }));
    });

    const port = parseInt(process.env['PORT'], 10);
    app.listen(port, '0.0.0.0', () => {
      process.stderr.write(`MCP HTTP server listening on port ${port}\n`);
    });
  } else {
    // Local stdio mode (unchanged)
    const server = createServer(ctx);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
```

- [ ] **Step 4: Remove the old inline tool handler + server code**

Remove the old `allToolHandlers`, `allToolDefinitions`, `server`, `server.setRequestHandler`, and transport code that was in `main()` — it's now in `createServer()` and the transport block above.

- [ ] **Step 5: Build and test**

Run: `npm run build && npm test`
Expected: Clean build, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: add HTTP transport mode with stateless StreamableHTTP for Cloud Run"
```

---

### Task 6: Package.json dependency changes

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Move keytar to optionalDependencies and add new deps**

```bash
# Remove keytar from dependencies
npm uninstall keytar

# Add it as optional
npm pkg set optionalDependencies.keytar="^7.9.0"

# Add new dependencies
npm install @google-cloud/secret-manager express
npm install -D @types/express
```

- [ ] **Step 2: Build and test**

Run: `npm run build && npm test`
Expected: Clean build, all tests pass

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add cloud deps, move keytar to optionalDependencies"
```

---

### Task 7: Dockerfile and .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

```
node_modules
.git
*.test.ts
dist
docs
scripts
.env*
.github
```

- [ ] **Step 2: Create Dockerfile**

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=optional
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Runtime
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: Test Docker build locally**

Run: `docker build -t ads-mcp-server .`
Expected: Build succeeds without keytar compilation errors

- [ ] **Step 4: Verify the image runs**

Run: `docker run -e PORT=8080 -p 8080:8080 ads-mcp-server &`
Then: `curl http://localhost:8080/health`
Expected: `{"status":"ok"}`
Cleanup: `docker stop $(docker ps -q --filter ancestor=ads-mcp-server)`

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add Dockerfile for Cloud Run deployment"
```

---

### Task 8: Deployment scripts

**Files:**
- Create: `scripts/gcp-setup.sh`
- Create: `scripts/gcp-deploy.sh`
- Create: `scripts/rotate-token.sh`
- Create: `scripts/mcp-proxy.sh`

- [ ] **Step 1: Create gcp-setup.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:-ads-mcp-server}"
REGION="${GCP_REGION:-us-central1}"
REPO_NAME="ads-mcp-server"
SERVICE_NAME="ads-mcp-server"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"

echo "=== GCP Setup for ads-mcp-server ==="
echo "Project: ${PROJECT_ID}"
echo "Region:  ${REGION}"
echo ""

# ── 1. Project ────────────────────────────────────────────────────────────
echo "1/8 Checking GCP project..."
if ! gcloud projects describe "${PROJECT_ID}" &>/dev/null; then
  echo "Creating project ${PROJECT_ID}..."
  gcloud projects create "${PROJECT_ID}" --quiet
fi
gcloud config set project "${PROJECT_ID}"

# ── 2. Billing ────────────────────────────────────────────────────────────
echo "2/8 Checking billing..."
BILLING_ACCOUNT=$(gcloud billing accounts list --format='value(name)' --limit=1)
if [ -n "${BILLING_ACCOUNT}" ]; then
  gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT}" --quiet 2>/dev/null || true
fi

# ── 3. APIs ───────────────────────────────────────────────────────────────
echo "3/8 Enabling APIs..."
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  --quiet

# ── 4. Artifact Registry ─────────────────────────────────────────────────
echo "4/8 Setting up Artifact Registry..."
if ! gcloud artifacts repositories describe "${REPO_NAME}" --location="${REGION}" &>/dev/null; then
  gcloud artifacts repositories create "${REPO_NAME}" \
    --repository-format=docker \
    --location="${REGION}" \
    --quiet
fi
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── 5. Secrets ────────────────────────────────────────────────────────────
echo "5/8 Setting up secrets..."
echo "Enter your config.json (paste and press Ctrl-D):"
CONFIG_JSON=$(cat)
echo "${CONFIG_JSON}" | gcloud secrets create ads-mcp-config --data-file=- --quiet 2>/dev/null \
  || echo "${CONFIG_JSON}" | gcloud secrets versions add ads-mcp-config --data-file=- --quiet

echo ""
echo "For each platform, enter credentials when prompted (or press Enter to skip)."

for PLATFORM in meta google tiktok; do
  read -rp "  ${PLATFORM} account name (or Enter to skip): " ACCT
  [ -z "${ACCT}" ] && continue

  read -rsp "  ${PLATFORM} access token: " TOKEN; echo
  echo -n "${TOKEN}" | gcloud secrets create "${PLATFORM}--${ACCT}" --data-file=- --quiet 2>/dev/null \
    || echo -n "${TOKEN}" | gcloud secrets versions add "${PLATFORM}--${ACCT}" --data-file=- --quiet

  read -rp "  ${PLATFORM} token expiry (ISO, e.g. 2026-08-01T00:00:00Z): " EXPIRES
  [ -n "${EXPIRES}" ] && (echo -n "${EXPIRES}" | gcloud secrets create "${PLATFORM}--${ACCT}--expires" --data-file=- --quiet 2>/dev/null \
    || echo -n "${EXPIRES}" | gcloud secrets versions add "${PLATFORM}--${ACCT}--expires" --data-file=- --quiet)

  if [ "${PLATFORM}" = "google" ]; then
    read -rsp "  Google client_id: " CID; echo
    [ -n "${CID}" ] && (echo -n "${CID}" | gcloud secrets create "google--${ACCT}--client_id" --data-file=- --quiet 2>/dev/null \
      || echo -n "${CID}" | gcloud secrets versions add "google--${ACCT}--client_id" --data-file=- --quiet)
    read -rsp "  Google client_secret: " CSEC; echo
    [ -n "${CSEC}" ] && (echo -n "${CSEC}" | gcloud secrets create "google--${ACCT}--client_secret" --data-file=- --quiet 2>/dev/null \
      || echo -n "${CSEC}" | gcloud secrets versions add "google--${ACCT}--client_secret" --data-file=- --quiet)
    read -rsp "  Google developer_token: " DTOK; echo
    [ -n "${DTOK}" ] && (echo -n "${DTOK}" | gcloud secrets create "google--${ACCT}--developer_token" --data-file=- --quiet 2>/dev/null \
      || echo -n "${DTOK}" | gcloud secrets versions add "google--${ACCT}--developer_token" --data-file=- --quiet)
  fi
done

# ── 6. Build & Push ───────────────────────────────────────────────────────
echo "6/8 Building and pushing Docker image..."
docker build -t "${IMAGE}:latest" .
docker push "${IMAGE}:latest"

# ── 7. Deploy ─────────────────────────────────────────────────────────────
echo "7/8 Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE}:latest" \
  --region="${REGION}" \
  --platform=managed \
  --port=8080 \
  --memory=256Mi \
  --cpu=1 \
  --timeout=300 \
  --concurrency=10 \
  --min-instances=0 \
  --max-instances=1 \
  --no-allow-unauthenticated \
  --quiet

# Grant service account access to secrets
SA=$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format='value(spec.template.spec.serviceAccountName)')
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretAccessor" --quiet
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretVersionManager" --quiet

# ── 8. IAM ────────────────────────────────────────────────────────────────
echo "8/8 Setting up IAM..."
CURRENT_USER=$(gcloud config get-value account)
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --region="${REGION}" \
  --member="user:${CURRENT_USER}" \
  --role="roles/run.invoker" --quiet

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format='value(status.url)')

echo ""
echo "=== Setup Complete ==="
echo "Service URL: ${SERVICE_URL}"
echo ""
echo "Claude Code MCP config (~/.claude.json):"
echo '{'
echo '  "mcpServers": {'
echo '    "ads": {'
echo '      "command": "bash",'
echo "      \"args\": [\"$(pwd)/scripts/mcp-proxy.sh\"],"
echo '      "env": {'
echo "        \"ADS_MCP_URL\": \"${SERVICE_URL}\""
echo '      }'
echo '    }'
echo '  }'
echo '}'
```

- [ ] **Step 2: Create gcp-deploy.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-ads-mcp-server}"
REGION="${GCP_REGION:-us-central1}"
REPO_NAME="ads-mcp-server"
SERVICE_NAME="ads-mcp-server"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"

echo "Building..."
docker build -t "${IMAGE}:latest" .

echo "Pushing..."
docker push "${IMAGE}:latest"

echo "Deploying..."
gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE}:latest" \
  --region="${REGION}" \
  --platform=managed \
  --quiet

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format='value(status.url)')
echo "Deployed: ${SERVICE_URL}"
```

- [ ] **Step 3: Create rotate-token.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

PLATFORM="${1:?Usage: rotate-token.sh <platform> <account>}"
ACCOUNT="${2:?Usage: rotate-token.sh <platform> <account>}"

echo "Rotating token for ${PLATFORM}/${ACCOUNT}"
read -rsp "Enter new access token: " TOKEN; echo

echo -n "${TOKEN}" | gcloud secrets versions add "${PLATFORM}--${ACCOUNT}" --data-file=-
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | gcloud secrets versions add "${PLATFORM}--${ACCOUNT}--expires" --data-file=-

echo "Token rotated. No redeploy needed."
```

- [ ] **Step 4: Create mcp-proxy.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Local proxy for Claude Code → Cloud Run MCP server
# Injects a fresh GCP identity token into each session.
# Identity tokens are valid for 1 hour — restart the MCP session if it expires.

SERVICE_URL="${ADS_MCP_URL:?Set ADS_MCP_URL to your Cloud Run service URL}"
TOKEN=$(gcloud auth print-identity-token 2>/dev/null)

if [ -z "${TOKEN}" ]; then
  echo "Error: Could not get identity token. Run 'gcloud auth login' first." >&2
  exit 1
fi

exec npx -y @anthropic-ai/mcp-proxy \
  --url "${SERVICE_URL}/mcp" \
  --header "Authorization: Bearer ${TOKEN}"
```

- [ ] **Step 5: Make scripts executable**

```bash
chmod +x scripts/gcp-setup.sh scripts/gcp-deploy.sh scripts/rotate-token.sh scripts/mcp-proxy.sh
```

- [ ] **Step 6: Commit**

```bash
git add scripts/
git commit -m "feat: add GCP deployment and token rotation scripts"
```

---

### Task 9: Deployment documentation

**Files:**
- Create: `docs/DEPLOYMENT.md`

- [ ] **Step 1: Create DEPLOYMENT.md**

```markdown
# GCP Cloud Run Deployment

## Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk/install) (`gcloud` CLI)
- [Docker](https://docs.docker.com/get-docker/)
- Node.js 22+
- Ad platform accounts (Google Ads, Meta, TikTok)

## First-Time Setup

```bash
# 1. Authenticate with GCP
gcloud auth login

# 2. Run the setup script (creates project, deploys service)
./scripts/gcp-setup.sh
```

The script will:
- Create a GCP project with billing
- Enable Cloud Run, Secret Manager, and Artifact Registry APIs
- Prompt for your ad platform credentials and store them securely
- Build and deploy the Docker image
- Restrict access to your Google account only
- Output the Claude Code MCP configuration

## Claude Code Configuration

Add the output from the setup script to `~/.claude.json`:

```json
{
  "mcpServers": {
    "ads": {
      "command": "bash",
      "args": ["/path/to/ads-mcp-server/scripts/mcp-proxy.sh"],
      "env": {
        "ADS_MCP_URL": "https://ads-mcp-server-xxxxx-uc.a.run.app"
      }
    }
  }
}
```

The proxy script injects a fresh GCP identity token on each session start. Tokens are valid for 1 hour — restart the MCP connection for longer sessions.

## Redeploying (Code Changes)

```bash
./scripts/gcp-deploy.sh
```

## Rotating Expired Tokens

Meta and TikTok tokens expire and must be rotated manually:

```bash
# Rotate a Meta token
./scripts/rotate-token.sh meta my-meta-account

# Rotate a TikTok token
./scripts/rotate-token.sh tiktok my-tiktok-account
```

Google Ads tokens refresh automatically via OAuth.

## Rollback

Cloud Run keeps previous revisions:

```bash
# List revisions
gcloud run revisions list --service=ads-mcp-server --region=us-central1

# Rollback to a specific revision
gcloud run services update-traffic ads-mcp-server \
  --to-revisions=REVISION_NAME=100 --region=us-central1
```

## Environment Variables

| Variable | Set By | Purpose |
|----------|--------|---------|
| `PORT` | Cloud Run | HTTP server port (8080) |
| `K_SERVICE` | Cloud Run | Detects cloud environment |
| `READ_ONLY` | You (optional) | Enable read-only mode |

## Cost

Estimated $0-2/month for single-user usage (Cloud Run and Secret Manager free tiers).

## Troubleshooting

**Auth error (401/403):**
```bash
gcloud auth login
gcloud auth print-identity-token  # verify token works
```

**Service not responding:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://YOUR-SERVICE-URL/health
```

**View logs:**
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ads-mcp-server" --limit=50
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEPLOYMENT.md
git commit -m "docs: add GCP Cloud Run deployment guide"
```

---

### Task 10: Final verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Clean compile with zero errors

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Docker build**

Run: `docker build -t ads-mcp-server .`
Expected: Build succeeds

- [ ] **Step 4: Verify HTTP mode locally**

```bash
PORT=8080 node dist/index.js &
curl http://localhost:8080/health
# Expected: {"status":"ok"}
kill %1
```

- [ ] **Step 5: Verify stdio mode still works**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js 2>/dev/null | head -c 200
# Expected: JSON response with tool list
```

- [ ] **Step 6: Final commit with all remaining changes**

```bash
git add -A
git status  # verify only expected files
git commit -m "feat: GCP Cloud Run deployment complete"
```
