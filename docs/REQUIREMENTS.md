# Requirements Document: ads-mcp-server

## Overview

An MCP (Model Context Protocol) server providing a unified interface for managing advertising campaigns across Meta (Facebook), Google Ads, and TikTok. The server exposes ~45 tools over the MCP protocol, enabling AI assistants and automation clients to read, create, update, and delete ad entities across all three platforms through a single consistent API.

## Goals

1. **Unified interface** -- abstract away platform-specific APIs behind a single set of tools and data models.
2. **Safety by default** -- enforce budget limits, require two-step delete confirmation, support read-only mode, and validate all file paths.
3. **Auditability** -- log every tool invocation with tamper-evident chain hashing.
4. **Extensibility** -- adding a new platform requires implementing one adapter interface; adding a new tool requires one file.

## Non-Goals

- Real-time bid management or programmatic bidding algorithms.
- A web UI or dashboard.
- Direct user authentication flows (OAuth tokens are pre-provisioned via keychain).
- Multi-tenant or multi-user access control.

---

## Functional Requirements

### FR-1: Campaign Management

| ID | Requirement |
|----|-------------|
| FR-1.1 | List campaigns with optional status and date range filters, paginated. |
| FR-1.2 | Get a single campaign by ID. |
| FR-1.3 | Create a campaign with name, objective, budget (daily or lifetime), schedule, and optional channel. |
| FR-1.4 | Update campaign fields (name, budget, schedule, status). |
| FR-1.5 | Set campaign status (active, paused, archived, draft). |
| FR-1.6 | Delete a campaign (requires two-step confirmation via DeleteGuard). |
| FR-1.7 | Clone a campaign with optional new name. |

**Supported objectives**: awareness, traffic, engagement, leads, app_installs, conversions, sales, video_views.
**Supported channels** (optional): search, display, shopping, video, app, performance_max.

### FR-2: Ad Set / Ad Group Management

| ID | Requirement |
|----|-------------|
| FR-2.1 | List ad sets for a campaign, paginated. |
| FR-2.2 | Get a single ad set by ID. |
| FR-2.3 | Create an ad set with targeting, bid strategy, and optional budgets. |
| FR-2.4 | Update ad set fields (targeting, bid, budget, name, status). |
| FR-2.5 | Set ad set status. |
| FR-2.6 | Delete an ad set (two-step confirmation). |

**Targeting fields**: locations, age (13-65), gender, interests, behaviors, audiences, languages, devices, OS.
**Bid strategies**: lowest_cost, target_cost, bid_cap, cost_cap, manual_cpc, manual_cpm, target_cpa, target_roas, maximize_conversions, maximize_clicks.
**Optional**: frequency caps (impressions per day/week/month), dayparting (hour ranges per weekday).

### FR-3: Ad Management

| ID | Requirement |
|----|-------------|
| FR-3.1 | List ads for an ad set, paginated. |
| FR-3.2 | Get a single ad by ID. |
| FR-3.3 | Create an ad with creative content. |
| FR-3.4 | Update ad fields (name, status, creative). |
| FR-3.5 | Delete an ad (two-step confirmation). |

**Creative types**: image, video, carousel (2-10 cards), responsive_search (3-15 headlines, 2-4 descriptions), performance_max.
**Ad statuses**: active, paused, archived, draft, in_review.

### FR-4: Creative & File Uploads

| ID | Requirement |
|----|-------------|
| FR-4.1 | Upload a creative file (image or video) and receive a creative ID. |
| FR-4.2 | Upload an audience file (CSV) and receive a file ID. |
| FR-4.3 | Validate file paths: directory containment, no symlinks, extension whitelist. |

**Allowed creative extensions**: .jpg, .jpeg, .png, .gif, .mp4, .mov.
**Allowed audience extensions**: .csv.

### FR-5: Audience Management

| ID | Requirement |
|----|-------------|
| FR-5.1 | List audiences by type, paginated. |
| FR-5.2 | Create audiences of types: customer_list, website_visitor, app_user, engagement, lookalike. |
| FR-5.3 | Update audience metadata. |
| FR-5.4 | Estimate audience size for given targeting. |

**Lookalike**: seed audience + country + similarity percentage (1-10).
**Retention**: 1-180 days for pixel/app, 1-365 days for engagement.

### FR-6: Reporting & Insights

| ID | Requirement |
|----|-------------|
| FR-6.1 | Get performance metrics for any entity (campaign, adset, ad, account) over a date range with configurable granularity (hourly, daily, weekly, monthly). |
| FR-6.2 | Get insights with breakdowns (age, gender, country, device, placement, etc.). |
| FR-6.3 | Support configurable attribution windows (click_days, view_days). |

**Core metrics**: impressions, clicks, reach, frequency, spend, cpc, cpm, cpa, ctr, conversions, roas, video_views, video_completion_rate.

### FR-7: Budget Management

| ID | Requirement |
|----|-------------|
| FR-7.1 | Get budget details for a campaign. |
| FR-7.2 | Get all active campaign budgets for account-level velocity checks. |

### FR-8: Automated Rules

| ID | Requirement |
|----|-------------|
| FR-8.1 | List automation rules. |
| FR-8.2 | Create rules with conditions (metric thresholds), actions (pause, enable, adjust budget/bid, notify), and schedule (hourly/daily). |
| FR-8.3 | Update rule configuration. |
| FR-8.4 | Delete a rule. |
| FR-8.5 | Get rule execution history. |

**Condition operators**: gt, lt, gte, lte, eq, neq.
**Action types**: pause, enable, adjust_budget, adjust_bid, send_notification.
**Notification channels**: email, slack, webhook.

Note: Rules are only fully supported on Meta. Google and TikTok return empty/throw "not supported via API".

### FR-9: Tracking & Pixels

| ID | Requirement |
|----|-------------|
| FR-9.1 | List pixels/tags for an account. |
| FR-9.2 | Get pixel status (active, inactive, unverified) with last-fired timestamp. |
| FR-9.3 | List conversion events for an account. |
| FR-9.4 | Get event match quality for a pixel. |
| FR-9.5 | Validate tracking URLs for an entity. |

**Event types**: purchase, lead, add_to_cart, view_content, complete_registration, subscribe, contact, find_location, schedule, custom.

### FR-10: Keyword Management (Google Ads Only)

| ID | Requirement |
|----|-------------|
| FR-10.1 | List keywords for an ad group, paginated. |
| FR-10.2 | Add keywords to an ad group with match type (broad, phrase, exact). |
| FR-10.3 | Remove keywords by ID. |
| FR-10.4 | List negative keywords for a campaign or ad group. |
| FR-10.5 | Add negative keywords to a campaign or ad group. |
| FR-10.6 | Get search terms report for an ad group over a specified date range (required: start, end). |

### FR-11: Account Management

| ID | Requirement |
|----|-------------|
| FR-11.1 | List configured platform accounts. |
| FR-11.2 | Get account health (status, currency, timezone, spend summary). |

### FR-12: System

| ID | Requirement |
|----|-------------|
| FR-12.1 | List available platforms and their connection status. |

### FR-13: Cross-Cutting

| ID | Requirement |
|----|-------------|
| FR-13.1 | All mutating tools support a `dry_run` parameter to preview changes without applying them. |
| FR-13.2 | All list endpoints support cursor-based pagination (page_size 1-200, default 20). |
| FR-13.3 | All tools accept explicit `account` parameter or fall back to platform default from config. |

---

## Non-Functional Requirements

### NFR-1: Safety

| ID | Requirement | Default |
|----|-------------|---------|
| NFR-1.1 | Per-campaign daily budget limit. | $100 USD |
| NFR-1.2 | Per-campaign lifetime budget limit. | $5,000 USD |
| NFR-1.3 | Account-level daily spend velocity limit (sum of all active campaign daily budgets). | $500 USD |
| NFR-1.4 | Read-only mode via `READ_ONLY=1` env var disables all mutations. | Off |
| NFR-1.5 | Two-step delete confirmation: UUID token with 60s TTL, single-use, max 100 pending. | Enabled |
| NFR-1.6 | File path validation: directory containment, symlink rejection, extension whitelist. | Enabled |

### NFR-2: Rate Limiting

| ID | Requirement |
|----|-------------|
| NFR-2.1 | Per-(platform, account) sequential execution (concurrency=1). |
| NFR-2.2 | 60-second timeout per tool execution. |

### NFR-3: Audit

| ID | Requirement |
|----|-------------|
| NFR-3.1 | Every tool invocation logged to JSONL file with daily rotation. |
| NFR-3.2 | Chain-hashed entries (SHA256 of previous entry) for tamper detection. |
| NFR-3.3 | Each entry includes: tool name, platform, account, credential fingerprint, dry_run flag, parameters, result, timestamp, session ID. |

### NFR-4: Authentication

| ID | Requirement |
|----|-------------|
| NFR-4.1 | OAuth tokens stored in OS keychain (via keytar), with in-memory fallback for CI. |
| NFR-4.2 | Auto-refresh with 5-minute buffer before expiry. |
| NFR-4.3 | Mutex-style coalescing: concurrent token requests share a single in-flight refresh. |

### NFR-5: Configuration

| ID | Requirement |
|----|-------------|
| NFR-5.1 | Config loaded from `$ADS_MCP_HOME/config.json` (default `~/.ads-mcp/config.json`). |
| NFR-5.2 | Zod-validated with `schema_version: 1`. |
| NFR-5.3 | Safety limits configurable, with sensible defaults. |
| NFR-5.4 | Graceful fallback if config file missing (empty platform set). |

### NFR-6: Error Handling

| ID | Requirement |
|----|-------------|
| NFR-6.1 | Typed error codes: AUTH_EXPIRED, RATE_LIMITED, BUDGET_EXCEEDED, ACCOUNT_SPEND_LIMIT, CURRENCY_MISMATCH, INVALID_TARGETING, INVALID_BREAKDOWN, CREATIVE_REJECTED, ACCOUNT_ISSUE, NOT_FOUND, READ_ONLY_MODE, INVALID_PATH, CONFIRMATION_REQUIRED, INVALID_STATUS_TRANSITION. |
| NFR-6.2 | Each error includes: code, platform, message, retryable flag, optional platform error code. |
| NFR-6.3 | Structured JSON error responses over MCP. |

### NFR-7: Transport

| ID | Requirement |
|----|-------------|
| NFR-7.1 | MCP server using stdio transport. |
| NFR-7.2 | Compatible with Claude Desktop and any MCP-compliant client. |

### NFR-8: Compatibility

| ID | Requirement |
|----|-------------|
| NFR-8.1 | Node.js 18, 20, 22 (CI-tested matrix). |
| NFR-8.2 | ESM-only (`"type": "module"`). |
| NFR-8.3 | TypeScript strict mode. |
