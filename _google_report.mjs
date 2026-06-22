// Google Ads performance report — standalone, no MCP needed.
// Reads the shared Google OAuth creds from the OS keychain (service "ads-mcp",
// accounts "google:_shared:<field>") and runs ONE GAQL query per account that
// returns every campaign's metrics over a date range. Campaigns with no
// activity in the window are simply absent from the result.
//
// Usage:  node _google_report.mjs [account] [date_range]
//   account     config account label (default: all google accounts)
//   date_range  GAQL preset: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS,
//               THIS_MONTH, LAST_MONTH, ALL_TIME  (default: LAST_30_DAYS)

import keytar from "keytar";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GoogleAdsApi } from "google-ads-api";

const SERVICE = "ads-mcp";
const arg1 = process.argv[2];
const preset = (process.argv[3] || "LAST_30_DAYS").toUpperCase();

// ── Config ─────────────────────────────────────────────────────────────────
const cfgPath = join(process.env.ADS_MCP_HOME || join(homedir(), ".ads-mcp"), "config.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const accounts = cfg.platforms?.google?.accounts || {};
const wanted = arg1 && accounts[arg1] ? [arg1] : Object.keys(accounts);
if (wanted.length === 0) { console.error("No google accounts configured."); process.exit(1); }

// ── Shared creds from keychain ───────────────────────────────────────────────
const g = async (f) => (await keytar.getPassword(SERVICE, `google:_shared:${f}`)) || "";
const [developer_token, client_id, client_secret, refresh_token, sharedLogin] = await Promise.all([
  g("developer_token"), g("client_id"), g("client_secret"), g("refresh_token"), g("login_customer_id"),
]);
const missing = Object.entries({ developer_token, client_id, client_secret, refresh_token })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.error(`Missing Google creds in keychain: ${missing.join(", ")}`); process.exit(1); }

const api = new GoogleAdsApi({ client_id, client_secret, developer_token });

const GAQL = `
  SELECT campaign.id, campaign.name, campaign.status,
         metrics.cost_micros, metrics.impressions, metrics.clicks,
         metrics.conversions, metrics.conversions_value
  FROM campaign
  WHERE segments.date DURING ${preset}
  ORDER BY metrics.cost_micros DESC`;

const usd = (n) => `$${n.toFixed(2)}`;

for (const acct of wanted) {
  const meta = accounts[acct];
  const customer_id = String(meta.customer_id ?? meta.account_id ?? acct).replace(/-/g, "");
  const login_customer_id = String(meta.login_customer_id ?? sharedLogin ?? "").replace(/-/g, "") || undefined;
  const customer = api.Customer({ customer_id, refresh_token, ...(login_customer_id ? { login_customer_id } : {}) });

  console.log(`\n══ ${meta.label || acct}  (${customer_id})  —  ${preset} ══`);
  let rows;
  try {
    rows = await customer.query(GAQL);
  } catch (e) {
    console.error(`  ERROR: ${e?.message || e}`);
    continue;
  }

  if (!rows.length) { console.log("  (no campaigns with activity in this window)"); continue; }

  let tSpend = 0, tImpr = 0, tClicks = 0, tConv = 0, tVal = 0;
  for (const r of rows) {
    const spend = (r.metrics.cost_micros || 0) / 1e6;
    const impr = r.metrics.impressions || 0;
    const clicks = r.metrics.clicks || 0;
    const conv = r.metrics.conversions || 0;
    const val = r.metrics.conversions_value || 0;
    tSpend += spend; tImpr += impr; tClicks += clicks; tConv += conv; tVal += val;
    const roas = spend > 0 ? (val / spend).toFixed(2) : "—";
    console.log(
      `  ${usd(spend).padStart(10)} | ${String(impr).padStart(7)} impr | ${String(clicks).padStart(5)} clk | ` +
      `${conv.toFixed(1).padStart(6)} conv | ROAS ${String(roas).padStart(5)} | ${r.campaign.name}`
    );
  }
  console.log(
    `  ${"─".repeat(60)}\n  ${usd(tSpend).padStart(10)} | ${String(tImpr).padStart(7)} impr | ${String(tClicks).padStart(5)} clk | ` +
    `${tConv.toFixed(1).padStart(6)} conv | total value ${usd(tVal)}  (${rows.length} campaigns active)`
  );
}
