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
