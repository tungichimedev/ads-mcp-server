#!/usr/bin/env bash
# Seed local config + macOS keychain for the Google Ads platform.
# Run this yourself so secrets never leave your machine.
#
#   ./scripts/setup-local-google.sh
#
# You'll need:
#   - Developer token        (Google Ads Manager/MCC → API Center)
#   - OAuth Client ID/Secret (Google Cloud Console → Credentials → Desktop app)
#   - Refresh token          (run: node scripts/google-get-refresh-token.mjs)
#   - login_customer_id      (your MCC / manager account id, digits only)
#   - One or more customer ids (the Google Ads accounts to manage, digits only)
set -euo pipefail
cd "$(dirname "$0")/.."

ADS_MCP_HOME="${ADS_MCP_HOME:-$HOME/.ads-mcp}"
CONFIG="$ADS_MCP_HOME/config.json"

echo "== ads-mcp local Google Ads setup =="
read -rsp "Developer token (hidden): " DEV_TOKEN; echo
read -rp  "OAuth Client ID: " CLIENT_ID
read -rsp "OAuth Client Secret (hidden): " CLIENT_SECRET; echo
read -rsp "Refresh token (hidden): " REFRESH_TOKEN; echo
read -rp  "login_customer_id / MCC id (digits only, no dashes): " LOGIN_CID

mkdir -p "$ADS_MCP_HOME"

# Store shared OAuth credentials in keychain under google:_shared:*
ADS_DEV="$DEV_TOKEN" ADS_CID="$CLIENT_ID" ADS_CSEC="$CLIENT_SECRET" ADS_RT="$REFRESH_TOKEN" ADS_LCID="$LOGIN_CID" \
node -e '
const keytar=require("keytar").default||require("keytar");
const S="ads-mcp";
(async()=>{
  await keytar.setPassword(S,"google:_shared:developer_token",process.env.ADS_DEV);
  await keytar.setPassword(S,"google:_shared:client_id",process.env.ADS_CID);
  await keytar.setPassword(S,"google:_shared:client_secret",process.env.ADS_CSEC);
  await keytar.setPassword(S,"google:_shared:refresh_token",process.env.ADS_RT);
  if(process.env.ADS_LCID) await keytar.setPassword(S,"google:_shared:login_customer_id",process.env.ADS_LCID);
  console.log("Stored Google credentials in keychain under google:_shared:*");
})();
'

# Collect one or more accounts.
echo
echo "Add Google Ads accounts (blank label to finish):"
DEFAULT_LABEL=""
while true; do
  read -rp "  Account label (e.g. main-google, blank to finish): " LABEL
  [ -z "$LABEL" ] && break
  read -rp "  Customer ID for '$LABEL' (digits only, no dashes): " CUST
  read -rp "  Currency (e.g. USD): " CUR
  [ -z "$DEFAULT_LABEL" ] && DEFAULT_LABEL="$LABEL"

  ADS_LABEL="$LABEL" ADS_CUST="$CUST" ADS_CUR="$CUR" ADS_LCID="$LOGIN_CID" ADS_CONFIG="$CONFIG" ADS_DEFAULT="$DEFAULT_LABEL" \
  node -e '
  const fs=require("fs");
  const p=process.env.ADS_CONFIG;
  let c={};
  try{c=JSON.parse(fs.readFileSync(p,"utf8"));}catch(e){}
  c.schema_version=1;
  c.safety=c.safety||{max_daily_budget_per_campaign_usd:100,max_lifetime_budget_per_campaign_usd:5000,max_account_daily_spend_usd:500};
  c.platforms=c.platforms||{};
  c.platforms.google=c.platforms.google||{accounts:{}};
  c.platforms.google.default_account=process.env.ADS_DEFAULT;
  c.platforms.google.accounts[process.env.ADS_LABEL]={
    account_id:process.env.ADS_CUST,
    customer_id:process.env.ADS_CUST,
    login_customer_id:process.env.ADS_LCID,
    currency:process.env.ADS_CUR,
    label:process.env.ADS_LABEL,
  };
  fs.writeFileSync(p,JSON.stringify(c,null,2));
  console.log("  + added google account:",process.env.ADS_LABEL,"->",process.env.ADS_CUST);
  '
done

echo
echo "Done. Test with:  npm run build && npm start  (or restart Claude Code)."
