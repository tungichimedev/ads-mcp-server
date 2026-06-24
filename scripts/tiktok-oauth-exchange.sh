#!/usr/bin/env bash
# Exchange a TikTok OAuth auth_code for a long-lived access token.
#
#   ./scripts/tiktok-oauth-exchange.sh
#
# You'll need: App ID, App Secret, and the auth_code from the redirect URL
# (https://<your-redirect>?auth_code=XXXX). The auth_code is single-use and
# expires quickly — run this right after authorizing.
set -euo pipefail

read -rp "App ID: " APP_ID
read -rsp "App Secret (hidden): " SECRET; echo
read -rp "auth_code (from redirect URL): " AUTH_CODE

echo "Exchanging..."
RESP=$(curl -s -X POST 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/' \
  -H 'Content-Type: application/json' \
  -d "{\"app_id\":\"${APP_ID}\",\"secret\":\"${SECRET}\",\"auth_code\":\"${AUTH_CODE}\"}")

echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"

echo
echo "If successful, copy data.access_token and the advertiser id from data.advertiser_ids,"
echo "then run:  ./scripts/setup-local-tiktok.sh"
