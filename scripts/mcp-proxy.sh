#!/usr/bin/env bash
set -euo pipefail
# Local proxy for Claude Code -> Cloud Run MCP server
# Injects a fresh GCP identity token into each session.
# Identity tokens are valid for 1 hour -- restart the MCP session if it expires.
SERVICE_URL="${ADS_MCP_URL:?Set ADS_MCP_URL to your Cloud Run service URL}"
TOKEN=$(gcloud auth print-identity-token 2>/dev/null)
if [ -z "${TOKEN}" ]; then
  echo "Error: Could not get identity token. Run 'gcloud auth login' first." >&2
  exit 1
fi
exec npx -y @anthropic-ai/mcp-proxy \
  --url "${SERVICE_URL}/mcp" \
  --header "Authorization: Bearer ${TOKEN}"
