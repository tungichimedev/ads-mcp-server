// One-off: StampScan campaign performance in [Diep] Account 5.
import keytar from "keytar";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GoogleAdsApi } from "google-ads-api";

const SERVICE = "ads-mcp";
const ACCT = "diep-account-5";
const FROM = process.argv[2] || "2026-01-01";
const TO = process.argv[3] || "2026-06-22";

const cfgPath = join(process.env.ADS_MCP_HOME || join(homedir(), ".ads-mcp"), "config.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const meta = cfg.platforms.google.accounts[ACCT];

const g = async (f) => (await keytar.getPassword(SERVICE, `google:_shared:${f}`)) || "";
const [developer_token, client_id, client_secret, refresh_token, sharedLogin] = await Promise.all([
  g("developer_token"), g("client_id"), g("client_secret"), g("refresh_token"), g("login_customer_id"),
]);

const api = new GoogleAdsApi({ client_id, client_secret, developer_token });
const customer_id = String(meta.customer_id ?? meta.account_id).replace(/-/g, "");
const login_customer_id = String(meta.login_customer_id ?? sharedLogin ?? "").replace(/-/g, "") || undefined;
const customer = api.Customer({ customer_id, refresh_token, ...(login_customer_id ? { login_customer_id } : {}) });

const usd = (n) => `$${n.toFixed(2)}`;

// Per-campaign aggregate over the window (no date segment = aggregated).
const agg = await customer.query(`
  SELECT campaign.id, campaign.name, campaign.status,
         metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr,
         metrics.average_cpc, metrics.conversions, metrics.conversions_value,
         metrics.cost_per_conversion
  FROM campaign
  WHERE campaign.name LIKE '%tampscan%' AND segments.date BETWEEN '${FROM}' AND '${TO}'
  ORDER BY metrics.cost_micros DESC`);

console.log(`\n══ StampScan — [Diep] Account 5 (${customer_id}) — ${FROM} → ${TO} ══\n`);
if (!agg.length) { console.log("  (no StampScan campaigns with data in window)"); process.exit(0); }

let T = { spend: 0, impr: 0, clk: 0, conv: 0, val: 0 };
for (const r of agg) {
  const spend = (r.metrics.cost_micros || 0) / 1e6;
  const impr = r.metrics.impressions || 0;
  const clk = r.metrics.clicks || 0;
  const conv = r.metrics.conversions || 0;
  const val = r.metrics.conversions_value || 0;
  const cpc = (r.metrics.average_cpc || 0) / 1e6;
  const cpa = conv > 0 ? spend / conv : 0;
  const ctr = (r.metrics.ctr || 0) * 100;
  T.spend += spend; T.impr += impr; T.clk += clk; T.conv += conv; T.val += val;
  console.log(`▸ ${r.campaign.name}   [${r.campaign.status}]`);
  console.log(`    spend ${usd(spend)} | impr ${impr} | clicks ${clk} | CTR ${ctr.toFixed(2)}% | avgCPC ${usd(cpc)}`);
  console.log(`    conv ${conv.toFixed(1)} | CPA ${conv > 0 ? usd(cpa) : "—"} | convValue ${usd(val)} | ROAS ${spend > 0 ? (val / spend).toFixed(2) : "—"}\n`);
}
const tCpa = T.conv > 0 ? T.spend / T.conv : 0;
const tCtr = T.impr > 0 ? (T.clk / T.impr) * 100 : 0;
console.log(`── TOTAL (${agg.length} campaigns) ──`);
console.log(`   spend ${usd(T.spend)} | impr ${T.impr} | clicks ${T.clk} | CTR ${tCtr.toFixed(2)}%`);
console.log(`   conv ${T.conv.toFixed(1)} | CPA ${T.conv > 0 ? usd(tCpa) : "—"} | convValue ${usd(T.val)} | ROAS ${T.spend > 0 ? (T.val / T.spend).toFixed(2) : "—"}`);

// Monthly breakdown to see when they ran.
const monthly = await customer.query(`
  SELECT segments.month, metrics.cost_micros, metrics.clicks, metrics.conversions
  FROM campaign
  WHERE campaign.name LIKE '%tampscan%' AND segments.date BETWEEN '${FROM}' AND '${TO}'
  ORDER BY segments.month`);
const byMonth = {};
for (const r of monthly) {
  const m = r.segments.month;
  byMonth[m] ??= { spend: 0, clk: 0, conv: 0 };
  byMonth[m].spend += (r.metrics.cost_micros || 0) / 1e6;
  byMonth[m].clk += r.metrics.clicks || 0;
  byMonth[m].conv += r.metrics.conversions || 0;
}
console.log(`\n── Monthly ──`);
for (const [m, v] of Object.entries(byMonth)) {
  console.log(`   ${m}: spend ${usd(v.spend)} | clicks ${v.clk} | conv ${v.conv.toFixed(1)}`);
}
