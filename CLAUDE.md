# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An MCP (Model Context Protocol) server that provides a unified interface for managing advertising campaigns across Meta (Facebook), Google Ads, and TikTok. It exposes ~40 tools for campaign/adset/ad CRUD, reporting, audiences, budgets, rules, tracking, and account management.

## Commands

```bash
npm run build          # TypeScript compile (tsc) to dist/
npm run dev            # Dev mode with --watch
npm run test           # vitest run (all tests)
npm run test:watch     # vitest in watch mode
npx vitest run src/safety/budget-guard.test.ts  # Run a single test file
npm start              # Run compiled server (stdio transport)
```

## Architecture

### Adapter Pattern (core abstraction)

All platform-specific logic goes through `BaseAdapter` (`src/adapters/base.ts`). Each platform implements this interface:

- `src/adapters/meta/client.ts` — MetaAdapter (Facebook Graph API v21.0)
- `src/adapters/google/client.ts` — GoogleAdapter (Google Ads API)
- `src/adapters/tiktok/client.ts` — TikTokAdapter (TikTok Marketing API)

Each adapter directory also contains:
- `auth.ts` — registers a refresh handler with TokenManager
- `mapper.ts` — converts between platform-native and unified model formats

Adapters are registered in `src/index.ts` based on which platforms have accounts configured. The adapter map (`Map<string, BaseAdapter>`) is injected into all tool handlers via `ToolContext`.

### Tool Layer

Tools live in `src/tools/`. Each file exports:
1. `*_TOOL_DEFINITIONS` — MCP tool schema array (name, description, inputSchema)
2. `*Tools(ctx)` — returns a `Record<string, handler>` mapping tool names to async handlers

Tool categories: campaigns, adsets, ads, creatives, audiences, reporting, budgets, rules, tracking, keywords, accounts, system.

`src/tools/register.ts` provides shared helpers: `getAdapter()`, `resolveAccount()`, `validatePlatformOptions()`, and the `ToolContext` type.

### Safety Guards

All mutation tools call `enforceWritable()` from `src/safety/read-only.ts`. Additional guards:

- **BudgetGuard** (`src/safety/budget-guard.ts`) — per-campaign and account-level spend limits
- **PathGuard** (`src/safety/path-guard.ts`) — validates file paths for creative/audience uploads (directory containment, no symlinks, extension whitelist)
- **DeleteGuard** (`src/safety/delete-guard.ts`) — two-step confirmation for destructive operations (UUID token, 60s TTL, single-use)

### Auth & Config

- `TokenManager` (`src/auth/token-manager.ts`) — OAuth token lifecycle with auto-refresh and mutex-style coalescing for concurrent requests
- `keychain.ts` — wraps `keytar` for OS keychain storage, falls back to in-memory provider
- Config loaded from `$ADS_MCP_HOME/config.json` (default `~/.ads-mcp/config.json`), validated with Zod. Schema version must be `1`.

### Unified Models

`src/models/` defines platform-agnostic types: `UnifiedCampaign`, `UnifiedAdSet`, `UnifiedAd`, `UnifiedAudience`, plus metrics, rules, tracking, and pagination types. Adapters map to/from these.

### Error Handling

`AdsError` (`src/utils/errors.ts`) carries a typed `ErrorCode`, platform identifier, and `retryable` flag. The MCP handler in `index.ts` catches these and returns structured JSON error responses.

## Key Conventions

- ESM throughout (`"type": "module"` in package.json). All local imports use `.js` extensions.
- Zod v4 for schema validation (config parsing, TikTok response schemas).
- Tests are colocated: `foo.ts` → `foo.test.ts`. Integration tests at `src/integration.test.ts` and `src/cross-platform.test.ts`.
- Vitest with `globals: true` — no need to import `describe`/`it`/`expect`.
- Read-only mode activated via `READ_ONLY=1` env var.
- Config home overridable via `ADS_MCP_HOME` env var.
- Budget safety defaults: $100/day per campaign, $5000 lifetime per campaign, $500/day account total.
