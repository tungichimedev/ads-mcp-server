# ads-mcp-server

An [MCP](https://modelcontextprotocol.io) server that provides a unified interface for managing advertising campaigns across **Meta (Facebook)**, **Google Ads**, and **TikTok**.

## Features

- Unified campaign, ad set, and ad management across all three platforms
- Reporting and performance insights with configurable attribution windows
- Audience management and creative uploads
- Automated rules and tracking/pixel management
- Budget safety guards (per-campaign and account-level spend limits)
- Read-only mode for safe exploration
- Two-step confirmation for destructive operations (deletes)
- OAuth token management with OS keychain storage
- Rate limiting and audit logging

## Setup

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
git clone https://github.com/tungichimedev/ads-mcp-server.git
cd ads-mcp-server
npm install
npm run build
```

### Configure

Create `~/.ads-mcp/config.json`:

```json
{
  "schema_version": 1,
  "safety": {
    "max_daily_budget_per_campaign_usd": 100,
    "max_lifetime_budget_per_campaign_usd": 5000,
    "max_account_daily_spend_usd": 500
  },
  "platforms": {
    "meta": {
      "default_account": "my-meta-account",
      "accounts": {
        "my-meta-account": {
          "account_id": "act_123456789",
          "currency": "USD",
          "label": "Main Meta Account"
        }
      }
    },
    "google": {
      "default_account": "my-google-account",
      "accounts": {
        "my-google-account": {
          "account_id": "123-456-7890",
          "currency": "USD"
        }
      }
    },
    "tiktok": {
      "default_account": "my-tiktok-account",
      "accounts": {
        "my-tiktok-account": {
          "account_id": "1234567890",
          "currency": "USD"
        }
      }
    }
  }
}
```

Override the config directory with `ADS_MCP_HOME` env var. Safety limits are optional and fall back to the defaults shown above.

### Authentication

OAuth tokens are stored in the OS keychain via [keytar](https://github.com/niccolosoffritti/keytar). Each platform's auth handler manages token refresh automatically. Meta tokens (long-lived, ~60 days) must be manually refreshed when expired.

### MCP Client Configuration

Add to your MCP client config (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "ads": {
      "command": "node",
      "args": ["/path/to/ads-mcp-server/dist/index.js"],
      "env": {
        "READ_ONLY": "1"
      }
    }
  }
}
```

Set `READ_ONLY=1` to prevent any write operations (recommended when exploring).

## Tools

| Category | Tools |
|----------|-------|
| **Campaigns** | `list_campaigns`, `get_campaign`, `create_campaign`, `update_campaign`, `set_campaign_status`, `delete_campaign`, `clone_campaign` |
| **Ad Sets** | `list_adsets`, `get_adset`, `create_adset`, `update_adset`, `set_adset_status`, `delete_adset` |
| **Ads** | `list_ads`, `get_ad`, `create_ad`, `update_ad`, `delete_ad` |
| **Creatives** | `upload_creative` |
| **Audiences** | `list_audiences`, `create_audience`, `update_audience`, `get_audience_size`, `upload_audience_file` |
| **Reporting** | `get_performance`, `get_insights` |
| **Budgets** | `get_budget` |
| **Rules** | `list_rules`, `create_rule`, `update_rule`, `delete_rule`, `get_rule_history` |
| **Tracking** | `list_pixels`, `get_pixel_status`, `list_conversion_events`, `get_event_match_quality`, `validate_tracking_urls` |
| **Keywords** | `list_keywords`, `add_keywords`, `remove_keywords`, `list_negative_keywords`, `add_negative_keywords`, `get_search_terms` |
| **Accounts** | `list_accounts`, `get_account_health` |
| **System** | `list_platforms` |

All mutating tools accept a `dry_run` parameter to preview changes without applying them.

## Development

```bash
npm run dev            # Dev mode with file watching
npm run build          # Compile TypeScript
npm test               # Run all tests
npm run test:watch     # Watch mode
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ADS_MCP_HOME` | Config directory (default: `~/.ads-mcp`) |
| `READ_ONLY` | Set to `1` or `true` to disable all write operations |

## License

ISC
