# Design Spec: GCP Cloud Deployment

**Date:** 2026-06-06
**Status:** Approved
**Scope:** Deploy ads-mcp-server to GCP Cloud Run with Streamable HTTP transport

---

## Overview

Deploy the ads-mcp-server to Google Cloud Platform as a Cloud Run service, replacing the local stdio transport with Streamable HTTP for remote MCP access. Single-user deployment, credentials stored in GCP Secret Manager, access restricted via Cloud Run IAM.

## Architecture

```
Claude Code (Mac)
    |
    | HTTPS (Streamable HTTP transport)
    | Authorization: Bearer <identity token>
    |
    v
+-------------------------------------+
|  Cloud Run Service                  |
|  ads-mcp-server                     |
|                                     |
|  Express HTTP server (:8080)        |
|    +- MCP StreamableHTTPTransport   |
|        +- Tool handlers            |
|            +- Adapters              |
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
- **No custom auth.** Cloud Run IAM restricts invocation to one Google account.
- **Stdio fallback preserved.** Local dev works unchanged (no PORT env = stdio mode).
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
  // Mount StreamableHTTPTransport at /mcp
  // Listen on PORT (Cloud Run provides 8080)
} else {
  // Local dev mode (unchanged)
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

The `@modelcontextprotocol/sdk` package provides `StreamableHTTPServerTransport`. An Express app mounts it at `/mcp` and handles the HTTP lifecycle.

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

### Secret Naming

Secrets use `--` as separator (Secret Manager IDs allow hyphens but not colons):

| Secret Name | Content |
|-------------|---------|
| `ads-mcp-config` | Full config.json |
| `meta--{account}--token` | Meta access token |
| `meta--{account}--expires` | Token expiry ISO timestamp |
| `google--{account}--token` | Google OAuth refresh token |
| `google--{account}--expires` | Token expiry timestamp |
| `google--{account}--client-id` | OAuth client ID |
| `google--{account}--client-secret` | OAuth client secret |
| `google--{account}--developer-token` | Google Ads developer token |
| `tiktok--{account}--token` | TikTok access token |
| `tiktok--{account}--expires` | Token expiry timestamp |

### Config Loading

When on Cloud Run, config is loaded from the `ads-mcp-config` secret instead of the filesystem. The existing `loadConfig()` function gets a new path: if `K_SERVICE` is set, fetch config from Secret Manager.

## Authentication & Access Control

Cloud Run IAM handles all authentication. No custom middleware.

```
IAM Policy:
  roles/run.invoker -> user:{your-email}@gmail.com
```

Claude Code sends an identity token with each request:
```
Authorization: Bearer <gcloud auth print-identity-token>
```

Cloud Run validates the token before the request reaches the server. Unauthorized requests receive 403.

## Cloud Run Service Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Min instances | 0 | Scale to zero when idle |
| Max instances | 1 | Single user |
| Memory | 256MB | Lightweight Node.js server |
| CPU | 1 | Sufficient for API proxying |
| Request timeout | 300s | Long enough for reporting queries |
| Concurrency | 1 | Matches existing rate limiter (concurrency=1 per account) |
| Region | us-central1 | Low latency, good pricing |

## Audit Logging

On Cloud Run, audit logs write to stdout instead of JSONL files. Cloud Run automatically captures stdout and sends it to Cloud Logging.

Detection: if `K_SERVICE` env var is set, `AuditLog` writes to `console.log` (JSON format) instead of the filesystem. The chain-hashing and entry format remain the same.

Cloud Logging benefits over JSONL files:
- Searchable in GCP Console
- Retention policies built-in
- No disk management
- Free tier covers single-user volume

## Dockerfile

Multi-stage build:

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
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

## Deployment Scripts

### `scripts/gcp-setup.sh` (one-time)

Interactive script that:

1. Creates GCP project (or uses existing)
2. Links billing account
3. Enables required APIs (Cloud Run, Secret Manager, Artifact Registry)
4. Creates Artifact Registry Docker repo
5. Prompts for platform credentials and stores in Secret Manager
6. Builds and pushes Docker image
7. Deploys Cloud Run service
8. Sets IAM policy (only your account can invoke)
9. Outputs the service URL and Claude Code MCP config

### `scripts/gcp-deploy.sh` (subsequent deploys)

Quick redeploy for code changes:

1. Builds Docker image
2. Pushes to Artifact Registry
3. Deploys new revision to Cloud Run

## Claude Code MCP Configuration

The setup script outputs this config for Claude Code:

```json
{
  "mcpServers": {
    "ads": {
      "type": "streamable-http",
      "url": "https://ads-mcp-server-xxxxx-uc.a.run.app/mcp",
      "headers": {
        "Authorization": "Bearer $(gcloud auth print-identity-token)"
      }
    }
  }
}
```

## Platform Credential Setup Order

1. **Google Ads** (first) — GCP project already exists, OAuth consent screen setup is straightforward
2. **Meta** (second) — requires Facebook Developer account + Business Manager
3. **TikTok** (third) — requires TikTok for Business developer account

Each platform's credentials are stored in Secret Manager via the setup script.

## File Changes

| File | Change | Type |
|------|--------|------|
| `src/index.ts` | Add HTTP server with StreamableHTTP transport, keep stdio fallback | Modify |
| `src/auth/secret-manager.ts` | KeychainProvider backed by GCP Secret Manager | New |
| `src/auth/keychain.ts` | Auto-detect GCP env, use Secret Manager provider | Modify |
| `src/utils/audit-log.ts` | Add stdout output mode for Cloud Logging | Modify |
| `Dockerfile` | Multi-stage build for Cloud Run | New |
| `.dockerignore` | Exclude node_modules, .git, tests, docs | New |
| `scripts/gcp-setup.sh` | One-time GCP project + credentials + deploy | New |
| `scripts/gcp-deploy.sh` | Quick redeploy script | New |
| `docs/DEPLOYMENT.md` | GCP deployment guide | New |

**Unchanged:** All adapters, tools, models, safety guards, and existing tests.

## New Dependencies

| Package | Purpose |
|---------|---------|
| `@google-cloud/secret-manager` | Access GCP Secret Manager |
| `express` | HTTP server for StreamableHTTP transport |

## Cost Estimate

| Resource | Estimated Monthly Cost |
|----------|----------------------|
| Cloud Run | $0 (free tier: 2M requests, 360K vCPU-seconds) |
| Secret Manager | $0 (free tier: 10K accesses) |
| Artifact Registry | $0-1 (storage for Docker images) |
| Cloud Logging | $0 (free tier: 50GB/month) |
| **Total** | **$0-2/month** |

## Testing Strategy

- Existing 379 tests remain unchanged (they test business logic, not transport)
- New unit tests for `secret-manager.ts` (mock GCP client)
- Integration test: start HTTP server locally, send MCP requests via HTTP
- Deployment verification: run setup script, verify Cloud Run service responds
