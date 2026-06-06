# Design Spec: GCP Cloud Deployment

**Date:** 2026-06-06
**Status:** Approved (rev 2 — addresses review feedback)
**Scope:** Deploy ads-mcp-server to GCP Cloud Run with Streamable HTTP transport

---

## Overview

Deploy the ads-mcp-server to Google Cloud Platform as a Cloud Run service, replacing the local stdio transport with Streamable HTTP for remote MCP access. Single-user deployment, credentials stored in GCP Secret Manager, access restricted via Cloud Run IAM.

## Architecture

```
Claude Code (Mac)
    |
    | HTTPS (Streamable HTTP transport)
    | Auth: local proxy injects identity token
    |
    v
+-------------------------------------+
|  Cloud Run Service                  |
|  ads-mcp-server                     |
|                                     |
|  HTTP server (:8080)                |
|    /mcp  - StreamableHTTPTransport  |
|    /health - health check           |
|                                     |
|  Stateless session mode             |
|  (single-user, IAM-protected)       |
|                                     |
|  Credentials: GCP Secret Manager    |
|  Audit logs: Cloud Logging (stdout) |
+-------------------------------------+
         |           |          |
         v           v          v
    Meta Graph    Google Ads   TikTok
    API v21.0     API          Marketing API
```

### Key Decisions

- **No database.** Config and tokens fit in Secret Manager. Audit logs go to Cloud Logging.
- **No custom auth middleware.** Cloud Run IAM restricts invocation to one Google account.
- **Stdio fallback preserved.** Local dev works unchanged (no `PORT` env = stdio mode).
- **Stateless MCP sessions.** No session ID validation — acceptable for single-user behind IAM. Eliminates scale-to-zero session loss.
- **No VPC, no pub/sub, no load balancer.** Minimal infrastructure.

## GCP Resources

| Resource | Name | Purpose |
|----------|------|---------|
| GCP Project | `ads-mcp-server` | Container for all resources |
| Cloud Run Service | `ads-mcp-server` | Runs the MCP server |
| Artifact Registry | `ads-mcp-server` | Docker image storage |
| Secret Manager | 10+ secrets | Config + platform credentials |
| Cloud Logging | automatic | Audit logs (stdout capture) |

### APIs to Enable

- Cloud Run (`run.googleapis.com`)
- Secret Manager (`secretmanager.googleapis.com`)
- Artifact Registry (`artifactregistry.googleapis.com`)

## Transport Layer

### Current (stdio)

```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

### New (HTTP + stdio fallback)

```typescript
if (process.env.PORT) {
  // Cloud Run / remote mode
  const app = express();

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

  // Each POST /mcp creates a new stateless transport + server
  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createServer(ctx); // factory function, registers all tools
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  // SSE endpoint for server-initiated messages (GET /mcp)
  app.get('/mcp', async (req, res) => {
    // Handle SSE connections for server-to-client notifications
    res.status(405).end(); // Stateless mode: no server-initiated messages
  });

  app.delete('/mcp', async (req, res) => {
    res.status(405).end(); // Stateless mode: no session cleanup
  });

  app.listen(parseInt(process.env.PORT), '0.0.0.0');
} else {
  // Local dev mode (unchanged)
  const transport = new StdioServerTransport();
  const server = createServer(ctx);
  await server.connect(transport);
}
```

**Server factory:** Extract tool/handler registration into a `createServer(ctx)` function that returns a new `Server` instance. The `ToolContext` (adapters, rate limiter, etc.) is created once and shared — it's stateless.

**Stateless mode:** `sessionIdGenerator: undefined` disables session tracking. Each request is self-contained. This is safe because Cloud Run IAM ensures only one authenticated user can call the service.

**Binding:** Must bind to `0.0.0.0` (not localhost) — Cloud Run requires it.

No changes to tools, adapters, models, safety guards, or any business logic.

## Credentials & Secret Manager

### KeychainProvider Swap

A new `src/auth/secret-manager.ts` implements the existing `KeychainProvider` interface:

```typescript
interface KeychainProvider {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
}
```

At startup, if the `K_SERVICE` env var is set (Cloud Run injects this), the server uses the Secret Manager provider instead of keytar.

### Key Translation Algorithm

The `KeychainProvider` receives calls like `getPassword("ads-mcp", "meta:my-account")` and `getPassword("ads-mcp", "meta:my-account:expires")`. The Secret Manager provider translates these to secret names:

```typescript
// KeychainProvider account param → Secret Manager secret name
// "meta:my-account"          → "meta--my-account"
// "meta:my-account:expires"  → "meta--my-account--expires"
// "google:acct:developer_token" → "google--acct--developer_token"
function toSecretName(account: string): string {
  return account.replace(/:/g, '--');
}
```

The `service` parameter (`"ads-mcp"`) is ignored since all secrets belong to the same GCP project.

### Secret Naming

Secrets use `--` as separator (Secret Manager IDs allow hyphens and underscores but not colons):

| Secret Name | Content |
|-------------|---------|
| `ads-mcp-config` | Full config.json |
| `meta--{account}` | Meta access token |
| `meta--{account}--expires` | Token expiry ISO timestamp |
| `google--{account}` | Google OAuth refresh token |
| `google--{account}--expires` | Token expiry timestamp |
| `google--{account}--client_id` | OAuth client ID |
| `google--{account}--client_secret` | OAuth client secret |
| `google--{account}--developer_token` | Google Ads developer token |
| `tiktok--{account}` | TikTok access token |
| `tiktok--{account}--expires` | Token expiry timestamp |

### Config Loading

When on Cloud Run, config is loaded from the `ads-mcp-config` secret instead of the filesystem:

```typescript
// src/utils/config.ts — new code path
export async function loadConfig(basePath: string): Promise<AdsConfig> {
  if (process.env.K_SERVICE) {
    // Cloud Run: load from Secret Manager
    const client = new SecretManagerServiceClient();
    const projectId = await client.getProjectId();
    const [version] = await client.accessSecretVersion({
      name: `projects/${projectId}/secrets/ads-mcp-config/versions/latest`,
    });
    const payload = version.payload?.data?.toString() ?? '{}';
    return parseConfig(JSON.parse(payload));
  }
  // Local: load from filesystem (existing behavior)
  return loadConfigFromFile(basePath);
}
```

### Service Account Permissions

The Cloud Run service account needs both read and write access to Secret Manager (write is needed for token refresh):

```
roles/secretmanager.secretAccessor    — read secrets
roles/secretmanager.secretVersionManager — write new secret versions (token refresh)
```

## Authentication & Access Control

Cloud Run IAM handles authentication. No custom middleware.

```
IAM Policy:
  roles/run.invoker -> user:{your-email}@gmail.com
```

### Local Auth Proxy

Claude Code's MCP config is static JSON — it cannot run shell commands like `$(gcloud auth print-identity-token)`. Solution: a lightweight local proxy script that injects a fresh identity token into each request.

**`scripts/mcp-proxy.sh`:**
```bash
#!/bin/bash
# Local proxy: pipes stdio MCP messages over HTTP with auth
SERVICE_URL="${ADS_MCP_URL}"
TOKEN=$(gcloud auth print-identity-token)
# Forward stdin/stdout as HTTP requests to Cloud Run
exec npx @anthropic-ai/mcp-proxy --url "${SERVICE_URL}/mcp" \
  --header "Authorization: Bearer ${TOKEN}"
```

**Claude Code MCP config** (uses stdio to local proxy):
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

This approach:
- Generates a fresh identity token on each session start
- Works with Claude Code's existing stdio-based MCP config
- No custom code needed — uses the official `@anthropic-ai/mcp-proxy` package
- Identity tokens are valid for 1 hour — sufficient for a working session

## Cloud Run Service Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Min instances | 0 | Scale to zero when idle |
| Max instances | 1 | Single user |
| Memory | 256MB | Lightweight Node.js server |
| CPU | 1 | Sufficient for API proxying |
| Request timeout | 300s | Long enough for reporting queries |
| Concurrency | 10 | MCP transport needs concurrent HTTP requests (SSE + POST). The app's internal RateLimiter handles per-account API serialization separately. |
| Region | us-central1 | Low latency, good pricing |

### Known Limitations

- **DeleteGuard tokens lost on scale-to-zero:** The two-step delete confirmation stores UUID tokens in memory. If the container scales down between step 1 (request confirmation) and step 2 (confirm), the token is lost. Mitigation: Cloud Run keeps containers warm for a few minutes after the last request. In practice, the user confirms within seconds. If the token is lost, the user simply retries the delete.

- **Chain-hash tamper evidence weakened:** When writing to Cloud Logging (stdout), the chain-hash still detects log gaps and ordering issues, but a GCP project admin could theoretically delete log entries. This is acceptable for single-user.

## Audit Logging

On Cloud Run, audit logs write to stdout instead of JSONL files. Cloud Run captures stdout and sends it to Cloud Logging automatically.

**Implementation:** Add an `output` parameter to `AuditLog` constructor:

```typescript
type AuditOutput = 'file' | 'stdout';

class AuditLog {
  constructor(basePath: string, output: AuditOutput = 'file') {
    this.output = output;
    if (output === 'file') {
      mkdirSync(basePath, { recursive: true });
    }
    // ...
  }

  log(entry: AuditEntry): void {
    const line = { ...entry, timestamp, session_id, chain_hash };
    if (this.output === 'stdout') {
      console.log(JSON.stringify(line));
    } else {
      appendFileSync(this.logPath(), JSON.stringify(line) + '\n');
    }
  }
}
```

In `index.ts`:
```typescript
const auditOutput = process.env.K_SERVICE ? 'stdout' : 'file';
const auditLog = new AuditLog(join(adsMcpHome, 'audit'), auditOutput);
```

## Dockerfile

Multi-stage build. `keytar` is moved to `optionalDependencies` so it doesn't block the build on Alpine (no `libsecret-dev`):

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=optional
COPY . .
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

**keytar handling:** Move `keytar` from `dependencies` to `optionalDependencies` in `package.json`. The existing `initKeychain()` already catches import failures and falls back gracefully. On Cloud Run, the Secret Manager provider is used instead — keytar is never loaded.

### `.dockerignore`

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

## Token Rotation

### Google Ads
Automatic. The `TokenManager` refresh handler uses the OAuth refresh token to get new access tokens. New tokens are written back to Secret Manager via `setPassword()`.

### Meta (manual, ~every 60 days)
Meta long-lived tokens cannot be refreshed programmatically. When expired:

```bash
# scripts/rotate-token.sh
#!/bin/bash
PLATFORM=$1  # meta, tiktok
ACCOUNT=$2
echo "Enter new access token for ${PLATFORM}/${ACCOUNT}:"
read -s TOKEN
echo "$TOKEN" | gcloud secrets versions add "${PLATFORM}--${ACCOUNT}" --data-file=-
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | gcloud secrets versions add "${PLATFORM}--${ACCOUNT}--expires" --data-file=-
echo "Token rotated. Redeploy not needed — server reads latest secret version."
```

### TikTok (manual, variable expiry)
Same procedure as Meta — use `scripts/rotate-token.sh`.

## Deployment Scripts

### `scripts/gcp-setup.sh` (one-time, idempotent)

All commands use `--quiet` and existence checks so the script is safe to re-run:

1. Creates GCP project (or detects existing): `gcloud projects describe $PROJECT 2>/dev/null || gcloud projects create $PROJECT`
2. Links billing account
3. Enables required APIs
4. Creates Artifact Registry Docker repo (if not exists)
5. Prompts for platform credentials and stores in Secret Manager
6. Builds and pushes Docker image
7. Deploys Cloud Run service with correct IAM and service account roles
8. Sets `run.invoker` IAM policy (only your account)
9. Grants service account `secretmanager.secretAccessor` + `secretmanager.secretVersionManager`
10. Outputs the service URL and Claude Code MCP config

### `scripts/gcp-deploy.sh` (subsequent deploys)

Quick redeploy for code changes:

1. Builds Docker image
2. Pushes to Artifact Registry
3. Deploys new revision to Cloud Run

### Rollback

Cloud Run keeps previous revisions. To rollback:
```bash
gcloud run services update-traffic ads-mcp-server \
  --to-revisions=REVISION_NAME=100 --region=us-central1
```

## Platform Credential Setup Order

1. **Google Ads** (first) — GCP project already exists, OAuth consent screen setup is straightforward
2. **Meta** (second) — requires Facebook Developer account + Business Manager
3. **TikTok** (third) — requires TikTok for Business developer account

Each platform's credentials are stored in Secret Manager via the setup script.

## File Changes

| File | Change | Type |
|------|--------|------|
| `src/index.ts` | Add HTTP server with StreamableHTTP transport (stateless), keep stdio fallback, extract `createServer()` factory | Modify |
| `src/auth/secret-manager.ts` | `KeychainProvider` backed by GCP Secret Manager with key translation (`:`→`--`) | New |
| `src/auth/keychain.ts` | Auto-detect GCP env (`K_SERVICE`), use Secret Manager provider | Modify |
| `src/utils/config.ts` | Add Secret Manager config loading when `K_SERVICE` is set | Modify |
| `src/utils/audit-log.ts` | Add `output` param (`'file'` or `'stdout'`), skip `mkdirSync` for stdout mode | Modify |
| `package.json` | Move `keytar` to `optionalDependencies`, add `@google-cloud/secret-manager` and `express` | Modify |
| `Dockerfile` | Multi-stage build with `--omit=optional` | New |
| `.dockerignore` | Exclude node_modules, .git, tests, docs, scripts | New |
| `scripts/gcp-setup.sh` | One-time GCP project + credentials + deploy (idempotent) | New |
| `scripts/gcp-deploy.sh` | Quick redeploy script | New |
| `scripts/rotate-token.sh` | Manual token rotation for Meta/TikTok | New |
| `scripts/mcp-proxy.sh` | Local proxy for Claude Code auth token injection | New |
| `docs/DEPLOYMENT.md` | GCP deployment guide with setup, deploy, rotate, rollback | New |

**Unchanged:** All adapters, tools, models, safety guards, and existing tests.

## New Dependencies

| Package | Purpose |
|---------|---------|
| `@google-cloud/secret-manager` | Access GCP Secret Manager |
| `express` | HTTP server for Streamable HTTP transport |
| `@types/express` | TypeScript types (dev dependency) |

**Changed:**
- `keytar` moved from `dependencies` to `optionalDependencies`

## Cost Estimate

| Resource | Estimated Monthly Cost |
|----------|----------------------|
| Cloud Run | $0 (free tier: 2M requests, 360K vCPU-seconds) |
| Secret Manager | $0 (free tier: 10K accesses/month) |
| Artifact Registry | $0-1 (storage; periodically clean old images) |
| Cloud Logging | $0 (free tier: 50GB/month) |
| **Total** | **$0-2/month** |

Note: Secret Manager charges $0.03/10K access operations. Token refreshes create new secret versions — periodically clean old versions via `gcloud secrets versions list/destroy`.

## Testing Strategy

- Existing 379 tests remain unchanged (they test business logic, not transport)
- New unit tests for `secret-manager.ts` (mock GCP client, test key translation)
- New unit tests for `AuditLog` stdout mode
- Integration test: start HTTP server locally, send MCP requests via HTTP
- Deployment verification: run setup script, verify Cloud Run service responds at `/health`
