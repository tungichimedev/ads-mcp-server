#!/usr/bin/env bash
# Seed local config + macOS keychain for the TikTok platform.
# Run this yourself so the access token never leaves your machine.
#
#   ./scripts/setup-local-tiktok.sh
#
# You'll need (from TikTok Business / Marketing API):
#   - Advertiser ID            (numeric, e.g. 7012345678901234567)
#   - Long-lived access token   (from the TikTok OAuth authorization flow)
#
# TikTok access tokens cannot be refreshed programmatically — when one expires
# you must re-authorize and re-run this script (or scripts/rotate-token.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

ADS_MCP_HOME="${ADS_MCP_HOME:-$HOME/.ads-mcp}"
CONFIG="$ADS_MCP_HOME/config.json"

echo "== ads-mcp local TikTok setup =="
read -rp "Account label (a short name you choose, e.g. main-tiktok): " LABEL
read -rp "TikTok Advertiser ID (numeric): " ACCT
read -rp "Currency (e.g. USD): " CUR
read -rsp "Paste long-lived TikTok access token (hidden): " TOKEN; echo
read -rp "Token expiry ISO date (e.g. 2027-06-21T00:00:00Z): " EXPIRES

mkdir -p "$ADS_MCP_HOME"

# Merge/create config.json (schema_version 1) without clobbering other platforms.
ADS_LABEL="$LABEL" ADS_ACCT="$ACCT" ADS_CUR="$CUR" ADS_CONFIG="$CONFIG" \
node -e '
const fs=require("fs");
const p=process.env.ADS_CONFIG;
let c={};
try{c=JSON.parse(fs.readFileSync(p,"utf8"));}catch(e){}
c.schema_version=1;
c.safety=c.safety||{max_daily_budget_per_campaign_usd:100,max_lifetime_budget_per_campaign_usd:5000,max_account_daily_spend_usd:500};
c.platforms=c.platforms||{};
c.platforms.tiktok=c.platforms.tiktok||{accounts:{}};
c.platforms.tiktok.default_account=process.env.ADS_LABEL;
c.platforms.tiktok.accounts[process.env.ADS_LABEL]={account_id:process.env.ADS_ACCT,advertiser_id:process.env.ADS_ACCT,currency:process.env.ADS_CUR,label:process.env.ADS_LABEL};
fs.writeFileSync(p,JSON.stringify(c,null,2));
console.log("Wrote config:",p);
'

# Seed keychain: service "ads-mcp", keys "tiktok:<label>" and "tiktok:<label>:expires".
ADS_LABEL="$LABEL" ADS_TOKEN="$TOKEN" ADS_EXPIRES="$EXPIRES" \
node -e '
const keytar=require("keytar").default||require("keytar");
const S="ads-mcp", L=process.env.ADS_LABEL;
(async()=>{
  await keytar.setPassword(S,"tiktok:"+L,process.env.ADS_TOKEN);
  await keytar.setPassword(S,"tiktok:"+L+":expires",process.env.ADS_EXPIRES);
  console.log("Stored token in keychain under tiktok:"+L);
})();
'

echo "Done. Test with:  npm run build && npm start  (or restart Claude Code)."
