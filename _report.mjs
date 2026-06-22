// Meta Ads performance report — standalone, no MCP needed.
// Reads the long-lived Meta token straight from the OS keychain (service
// "ads-mcp", account "meta:<account>"), so it works even when the MCP server's
// keychain access fails in a sandbox and falsely reports the token "expired".
//
// Usage:  node _report.mjs [account] [date_preset]
//   account      keychain account label (default: themepack)
//   date_preset  Meta preset: today, yesterday, last_7d, last_14d, last_30d,
//                this_month, last_month, maximum  (default: last_7d)
//
// Requires the ad account id from ~/.ads-mcp/config.json.

import keytar from "keytar";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://graph.facebook.com/v21.0";
const account = process.argv[2] || "themepack";
const preset = process.argv[3] || "last_7d";

// ── Resolve ad account id from config ─────────────────────────────────────
const cfgPath = join(process.env.ADS_MCP_HOME || join(homedir(), ".ads-mcp"), "config.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const acctCfg = cfg.platforms?.meta?.accounts?.[account];
if (!acctCfg) { console.error(`No meta account '${account}' in ${cfgPath}`); process.exit(1); }
const ACT = acctCfg.account_id;
const cur = acctCfg.currency || "";

// ── Token from keychain ───────────────────────────────────────────────────
const token = await keytar.getPassword("ads-mcp", `meta:${account}`);
if (!token) { console.error(`No keychain token for meta:${account}.`); process.exit(1); }

const num = (v) => Number(v || 0);
const money = (v) => num(v).toLocaleString() + (cur ? " " + cur : "");

async function insights(level) {
  const fields = "campaign_name,spend,impressions,clicks,ctr,cpc,cpm,actions,cost_per_action_type";
  const lv = level ? `&level=${level}&limit=200` : "";
  const url = `${API}/${ACT}/insights?date_preset=${preset}&fields=${fields}${lv}&access_token=${token}`;
  const j = await (await fetch(url)).json();
  if (j.error) throw new Error(j.error.message);
  return j.data || [];
}
const installs = (r) => num((r.actions || []).find((a) => a.action_type === "mobile_app_install")?.value);
const cpi = (r) => {
  const c = (r.cost_per_action_type || []).find((a) => a.action_type === "mobile_app_install");
  if (c) return Math.round(num(c.value));
  const i = installs(r);                       // fallback: spend / installs
  return i ? Math.round(num(r.spend) / i) : null;
};

const [total] = await insights(null);
const rows = (await insights("campaign")).sort((a, b) => num(b.spend) - num(a.spend));

console.log(`\n=== Meta Ads | ${account} (${ACT}) | ${preset}${cur ? " | " + cur : ""} ===`);
if (total) {
  console.log(`Spend ${money(total.spend)} | Impr ${num(total.impressions).toLocaleString()} | Clicks ${total.clicks} | CTR ${num(total.ctr).toFixed(2)}% | CPC ${money(total.cpc)} | CPM ${money(total.cpm)} | Installs ${installs(total)}${cpi(total) ? " | CPI " + money(cpi(total)) : ""}`);
} else {
  console.log("No data in range.");
}

console.table(rows.map((r) => ({
  campaign: r.campaign_name,
  spend: money(r.spend),
  impr: num(r.impressions).toLocaleString(),
  clicks: r.clicks,
  ctr: num(r.ctr).toFixed(2) + "%",
  installs: installs(r),
  cpi: cpi(r) != null ? money(cpi(r)) : "—",
})));
