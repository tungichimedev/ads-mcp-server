# Architecture Document: ads-mcp-server

## System Overview

```
MCP Client (Claude Desktop, etc.)
        |
        | stdio (JSON-RPC)
        v
  ┌─────────────────────────────────────────────────────┐
  │  MCP Server  (src/index.ts)                         │
  │                                                     │
  │  ListToolsRequest  → tool definitions               │
  │  CallToolRequest   → handler dispatch               │
  │                                                     │
  │  ┌───────────────────────────────────────────────┐  │
  │  │  Tool Layer  (src/tools/*.ts)                 │  │
  │  │  campaigns | adsets | ads | creatives |       │  │
  │  │  audiences | reporting | budgets | rules |    │  │
  │  │  tracking | keywords | accounts | system      │  │
  │  └──────────────────┬────────────────────────────┘  │
  │                     │                               │
  │  ┌──────────────────v────────────────────────────┐  │
  │  │  Safety Guards                                │  │
  │  │  ReadOnly │ BudgetGuard │ DeleteGuard │ Path  │  │
  │  └──────────────────┬────────────────────────────┘  │
  │                     │                               │
  │  ┌──────────────────v────────────────────────────┐  │
  │  │  RateLimiter  (per-platform/account queue)    │  │
  │  └──────────────────┬────────────────────────────┘  │
  │                     │                               │
  │  ┌──────────────────v────────────────────────────┐  │
  │  │  Adapter Layer  (src/adapters/)               │  │
  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐      │  │
  │  │  │   Meta   │ │  Google  │ │  TikTok  │      │  │
  │  │  │ Graph API│ │ Ads API  │ │ Mktg API │      │  │
  │  │  └──────────┘ └──────────┘ └──────────┘      │  │
  │  └───────────────────────────────────────────────┘  │
  │                                                     │
  │  ┌───────────────────────────────────────────────┐  │
  │  │  Cross-Cutting                                │  │
  │  │  TokenManager │ AuditLog │ Config             │  │
  │  └───────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────┘
```

---

## Request Flow

A tool invocation follows this path from MCP request to platform API call:

```
1. MCP CallToolRequest arrives (tool name + arguments)
2. Handler lookup from merged tool map
3. resolveAccount()       — explicit account param or config default
4. getAdapter()           — retrieve platform adapter from map
5. enforceWritable()      — block if READ_ONLY=1 (mutations only)
6. Safety guards          — BudgetGuard / PathGuard / DeleteGuard (where applicable)
7. RateLimiter.execute()  — queued, concurrency=1 per (platform, account), 60s timeout
8. Adapter method call    — platform-specific API request
9. AuditLog.log()         — append JSONL entry with chain hash
10. Return unified model  — or AdsError → structured JSON error response
```

---

## Layer Details

### 1. Adapter Layer (`src/adapters/`)

The core abstraction. `BaseAdapter` (`src/adapters/base.ts`) defines the interface that all platforms implement:

```
BaseAdapter
├── Campaigns (7 methods)   — list, get, create, update, setStatus, delete, clone
├── Ad Sets (6 methods)     — list, get, create, update, setStatus, delete
├── Ads (5 methods)         — list, get, create, update, delete
├── Uploads (2 methods)     — uploadCreative, uploadAudienceFile
├── Audiences (4 methods)   — list, create, update, getAudienceSize
├── Reporting (2 methods)   — getPerformance, getInsights
├── Budget (2 methods)      — getBudget, getAllActiveCampaignBudgets
├── Rules (5 methods)       — list, create, update, delete, getRuleHistory
├── Tracking (5 methods)    — listPixels, getPixelStatus, listConversionEvents,
│                             getEventMatchQuality, validateTrackingUrls
├── Keywords (6 methods)    — listKeywords, addKeywords, removeKeywords,
│                             listNegativeKeywords, addNegativeKeywords, getSearchTerms
└── Account (1 method)      — getAccountHealth
```

**Total: 45 methods.**

Each platform adapter directory contains:

| File | Purpose |
|------|---------|
| `client.ts` | `BaseAdapter` implementation with platform API calls |
| `auth.ts` | Registers a token refresh handler with `TokenManager` |
| `mapper.ts` | Converts between platform-native formats and unified models |

Platform-specific notes:
- **Meta** (`src/adapters/meta/`) — Facebook Graph API v21.0. Currencies in cents (mapper converts). Full rules support.
- **Google** (`src/adapters/google/`) — Google Ads API via GAQL queries. Currencies in micros (1M = $1). Full keyword support. Rules not available via API.
- **TikTok** (`src/adapters/tiktok/`) — TikTok Marketing API. Zod response schemas for validation (`schemas.ts`). Rules not available via API.

### 2. Tool Layer (`src/tools/`)

Each tool file exports two things:

```typescript
// Tool schema definitions (name, description, inputSchema)
export const CAMPAIGN_TOOL_DEFINITIONS = [...] as const;

// Tool handler factory (receives ToolContext, returns name→handler map)
export function campaignTools(ctx: ToolContext): Record<string, handler> { ... }
```

`src/index.ts` merges all definitions and handlers at startup.

**ToolContext** (injected into all handlers):
```
ToolContext {
  adapters:     Map<string, BaseAdapter>
  rateLimiter:  RateLimiter
  auditLog:     AuditLog
  tokenManager: TokenManager
  deleteGuard:  DeleteGuard
  config:       AdsConfig
}
```

Shared helpers in `src/tools/register.ts`:
- `getAdapter(ctx, platform)` — throws `ACCOUNT_ISSUE` if platform not configured
- `resolveAccount(ctx, platform, account?)` — explicit param or config default
- `validatePlatformOptions(adapter, options)` — checks against adapter's allowlist

### 3. Safety Layer (`src/safety/`)

Four independent guards, each enforced at the tool layer:

| Guard | File | Purpose | Trigger |
|-------|------|---------|---------|
| **ReadOnly** | `read-only.ts` | Blocks all mutations when `READ_ONLY=1` | `enforceWritable()` at top of every mutation handler |
| **BudgetGuard** | `budget-guard.ts` | Enforces per-campaign and account-level spend limits | Campaign create/update with budget changes |
| **DeleteGuard** | `delete-guard.ts` | Two-step confirmation (UUID token, 60s TTL, single-use) | All delete operations |
| **PathGuard** | `path-guard.ts` | Validates file paths (containment, no symlinks, extension whitelist) | Creative and audience file uploads |

### 4. Auth Layer (`src/auth/`)

```
TokenManager
├── setRefreshHandler(platform, handler)  — one per platform, registered at startup
├── getToken(platform, account)           — returns valid token, auto-refreshes if needed
│   ├── Checks in-flight mutex (coalesces concurrent requests)
│   ├── Checks keychain for stored token + expiry
│   └── Calls refresh handler if expired or within 5-min buffer
└── credentialFingerprint(platform, account)  — sha256 prefix for audit log

Keychain
├── initKeychain()        — imports keytar (OS keychain)
├── setKeychainProvider() — inject mock for CI/testing
├── getSecret(key)        — read from keychain
└── setSecret(key, value) — write to keychain
```

Token storage keys in keychain: `{platform}:{account}` for token, `{platform}:{account}:expires` for expiry timestamp.

### 5. Infrastructure

**RateLimiter** (`src/utils/rate-limiter.ts`):
- One `p-queue` per `{platform}:{account}` key
- Concurrency=1 (serializes API calls to same account)
- 60-second timeout per queued function
- Prevents rate limit violations and race conditions

**AuditLog** (`src/utils/audit-log.ts`):
- Append-only JSONL files: `{ADS_MCP_HOME}/audit/audit-YYYY-MM-DD.jsonl`
- Daily rotation
- Each entry: timestamp, session_id (UUID), tool, platform, account, credential_fingerprint, dry_run, params, result, chain_hash
- Chain hashing: `SHA256(previous_hash)` — tamper-evident linked entries

**Config** (`src/utils/config.ts`):
- Loaded from `{ADS_MCP_HOME}/config.json`
- Zod-validated, `schema_version: 1` required
- Safety limits merged with defaults if not specified
- Graceful fallback to empty config if file missing

---

## Unified Models (`src/models/`)

Platform-agnostic data types used across all tools and adapters:

| Model | Key Types | Notes |
|-------|-----------|-------|
| `campaign.ts` | `UnifiedCampaign`, `CreateCampaignInput` | Budget (daily/lifetime), objective, channel |
| `adset.ts` | `UnifiedAdSet`, `Targeting`, `Bid` | Frequency caps, dayparting |
| `ad.ts` | `UnifiedAd`, `UnifiedCreative` (5 variants) | Discriminated union on creative `type` |
| `audience.ts` | `UnifiedAudience` (5 definition types) | Customer list, pixel, app, engagement, lookalike |
| `metrics.ts` | `UnifiedMetrics`, `MetricsTimeSeries` | All numeric fields non-negative |
| `pagination.ts` | `PaginatedResponse<T>`, `PaginationInput` | Cursor-based, page_size 1-200 |
| `platform.ts` | `Platform`, `Status`, `DateRange`, enums | Shared enums and value types |
| `rule.ts` | `UnifiedRule`, `RuleCondition`, `RuleAction` | 5 action types, AND/OR conditions |
| `tracking.ts` | `PixelStatus`, `ConversionEvent` | 10 event types |
| `keyword.ts` | `UnifiedKeyword`, `UnifiedSearchTerm`, `KeywordMutationResult` | Google Ads only |

All models use Zod schemas for validation.

---

## Error Handling

`AdsError` (`src/utils/errors.ts`) — typed errors with 14 error codes:

| Code | Retryable | Usage |
|------|-----------|-------|
| `AUTH_EXPIRED` | Yes | Token refresh failed |
| `RATE_LIMITED` | Yes | Platform rate limit hit |
| `BUDGET_EXCEEDED` | No | Campaign budget exceeds safety limit |
| `ACCOUNT_SPEND_LIMIT` | No | Account daily velocity exceeded |
| `CURRENCY_MISMATCH` | No | Cross-currency operation |
| `INVALID_TARGETING` | No | Bad targeting parameters |
| `INVALID_BREAKDOWN` | No | Unsupported breakdown dimension |
| `CREATIVE_REJECTED` | No | Platform rejected creative |
| `ACCOUNT_ISSUE` | No | Platform not configured or unavailable |
| `NOT_FOUND` | No | Entity not found |
| `READ_ONLY_MODE` | No | Mutation attempted in read-only mode |
| `INVALID_PATH` | No | File path validation failed |
| `CONFIRMATION_REQUIRED` | No | Delete needs two-step confirmation |
| `INVALID_STATUS_TRANSITION` | No | Invalid status change |

The MCP handler catches `AdsError` and returns structured JSON; other errors are re-thrown for the MCP SDK to handle.

---

## Extension Points

### Adding a New Platform

1. Create `src/adapters/<platform>/client.ts` implementing `BaseAdapter` (45 methods).
2. Create `auth.ts` with a refresh handler for `TokenManager`.
3. Create `mapper.ts` for platform-native to unified model conversion.
4. Register the adapter in `src/index.ts` (conditional on config presence).

### Adding a New Tool

1. Create `src/tools/<category>.ts` exporting `*_TOOL_DEFINITIONS` and `*Tools(ctx)`.
2. Import and merge both in `src/index.ts`.

### Adding a New Safety Guard

1. Create `src/safety/<guard>.ts` with the guard logic.
2. Call the guard from relevant tool handlers.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Adapter pattern with unified models** | Clients write platform-agnostic code; platform complexity is contained in adapters. |
| **Concurrency=1 per (platform, account)** | Prevents rate limit violations without requiring platform-specific rate limit knowledge. |
| **Chain-hashed audit log** | Tamper-evident: any modification to historical entries breaks the hash chain. |
| **Two-step delete with UUID tokens** | Prevents accidental deletions by AI assistants; 60s TTL limits exposure window. |
| **Budget guards at tool layer, not adapter** | Safety limits are cross-platform policy, not platform-specific logic. |
| **Keychain with in-memory fallback** | OS keychain for production security; in-memory for CI/test without native dependencies. |
| **Zod for all validation** | Single validation library for config, models, and API responses (TikTok). |
| **ESM-only with `.js` extensions** | Modern Node.js module system; `.js` extensions required by NodeNext module resolution. |
| **stdio transport** | Simplest MCP transport; works with Claude Desktop and all MCP clients. |

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server framework |
| `googleapis` | Google APIs client |
| `google-ads-node` | Google Ads API (GAQL queries) |
| `keytar` | OS keychain access (optional native dep) |
| `node-fetch` | HTTP client for Meta and TikTok APIs |
| `p-queue` | Concurrency-limited promise queues |
| `zod` | Schema validation (v4) |

Dev: `typescript`, `vitest`, `@types/node`.
