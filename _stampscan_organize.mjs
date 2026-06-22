// (1) Reorganize downloaded StampScan images into per-aspect-ratio subfolders.
// (2) Generate Google Ads Editor import CSVs from the two source campaigns.
import keytar from "keytar";
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { GoogleAdsApi } from "google-ads-api";

const BASE = "/Users/admin/Documents/GitHub/_tools/ads-mcp-server";
const DIR = `${BASE}/docs/stampscan-creatives`;
const IMG = `${DIR}/images`;

// ── (1) Bucket images by aspect ratio ───────────────────────────────────────
const ratioBucket = (w, h) => {
  const r = w / h;
  if (Math.abs(r - 1) < 0.03) return "square_1x1";
  if (Math.abs(r - 0.8) < 0.04) return "portrait_4x5";
  if (Math.abs(r - 1.91) < 0.08) return "landscape_1.91x1";
  return `other_${w}x${h}`;
};
const counts = {};
for (const f of readdirSync(IMG)) {
  if (!/\.(jpg|png)$/i.test(f)) continue;
  const m = f.match(/_(\d+)x(\d+)\./);
  if (!m) continue;
  const bucket = ratioBucket(+m[1], +m[2]);
  mkdirSync(`${IMG}/${bucket}`, { recursive: true });
  renameSync(`${IMG}/${f}`, `${IMG}/${bucket}/${f}`);
  counts[bucket] = (counts[bucket] || 0) + 1;
}
console.log("Images reorganized:", JSON.stringify(counts));

// ── (2) Pull source structure + emit Editor CSVs ────────────────────────────
const g = async (f) => (await keytar.getPassword("ads-mcp", `google:_shared:${f}`)) || "";
const [developer_token, client_id, client_secret, refresh_token] = await Promise.all([
  g("developer_token"), g("client_id"), g("client_secret"), g("refresh_token"),
]);
const api = new GoogleAdsApi({ client_id, client_secret, developer_token });
const cust = api.Customer({ customer_id: "8370608815", refresh_token, login_customer_id: "8370608815" });

const CAMPAIGNS = [
  { id: "23581847001", newName: "Stampscan_CPI_EU_ByteX04" },
  { id: "23592298000", newName: "Stampscan_CPI_US_ByteX04" },
];
const csvCell = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;

const mainHeader = ["Campaign","Campaign type","Mobile app id","App store","Campaign daily budget",
  "Bid strategy type","Target CPA","Campaign status","Languages","Ad group","Ad group status",
  "Headline 1","Headline 2","Headline 3","Headline 4","Headline 5",
  "Description 1","Description 2","Description 3","Description 4","Description 5"];
const mainRows = [mainHeader.map(csvCell).join(",")];
const locRows = ["Campaign,Location,Location ID"];

for (const C of CAMPAIGNS) {
  const c = (await cust.query(`
    SELECT campaign.name, campaign.target_cpa.target_cpa_micros,
           campaign.app_campaign_setting.app_id, campaign_budget.amount_micros
    FROM campaign WHERE campaign.id=${C.id}`))[0];
  const tcpa = (Number(c.campaign.target_cpa?.target_cpa_micros || 0) / 1e6).toFixed(2);
  const budget = (Number(c.campaign_budget?.amount_micros || 0) / 1e6).toFixed(2);
  const appId = c.campaign.app_campaign_setting?.app_id;

  // languages
  const langRN = (await cust.query(`SELECT campaign_criterion.language.language_constant FROM campaign_criterion WHERE campaign.id=${C.id} AND campaign_criterion.type=LANGUAGE`)).map(r => r.campaign_criterion.language.language_constant).filter(Boolean);
  let langs = "English";
  if (langRN.length) {
    const ln = await cust.query(`SELECT language_constant.name FROM language_constant WHERE language_constant.resource_name IN (${langRN.map(r=>`'${r}'`).join(",")})`);
    langs = ln.map(r => r.language_constant.name).join(";");
  }
  // locations
  const geoRN = (await cust.query(`SELECT campaign_criterion.location.geo_target_constant FROM campaign_criterion WHERE campaign.id=${C.id} AND campaign_criterion.type=LOCATION`)).map(r => r.campaign_criterion.location.geo_target_constant).filter(Boolean);
  if (geoRN.length) {
    const gn = await cust.query(`SELECT geo_target_constant.id, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${geoRN.map(r=>`'${r}'`).join(",")})`);
    for (const r of gn) locRows.push(`${csvCell(C.newName)},${csvCell(r.geo_target_constant.name)},${r.geo_target_constant.id}`);
  }

  // ad groups + ad text
  const ads = await cust.query(`
    SELECT ad_group.id, ad_group.name, ad_group_ad.ad.app_ad.headlines, ad_group_ad.ad.app_ad.descriptions
    FROM ad_group_ad WHERE campaign.id=${C.id}`);
  const byAg = {};
  for (const a of ads) (byAg[a.ad_group.id] ??= { name: a.ad_group.name, h: [], d: [] }) && (() => {
    const app = a.ad_group_ad.ad.app_ad || {};
    byAg[a.ad_group.id].h = (app.headlines || []).map(x => x.text);
    byAg[a.ad_group.id].d = (app.descriptions || []).map(x => x.text);
  })();

  let first = true;
  for (const ag of Object.values(byAg)) {
    const row = [
      first ? C.newName : "",                 // Campaign (only first row carries campaign-level fields)
      first ? "App" : "",
      first ? appId : "",
      first ? "Google Play" : "",
      first ? budget : "",
      first ? "Target CPA" : "",
      first ? tcpa : "",
      first ? "Paused" : "",
      first ? langs : "",
      ag.name, "Enabled",
      ...Array.from({ length: 5 }, (_, i) => ag.h[i] || ""),
      ...Array.from({ length: 5 }, (_, i) => ag.d[i] || ""),
    ];
    mainRows.push(row.map(csvCell).join(","));
    first = false;
  }
}

writeFileSync(`${DIR}/gads-editor-import.csv`, mainRows.join("\n") + "\n");
writeFileSync(`${DIR}/gads-editor-locations.csv`, locRows.join("\n") + "\n");

const readme = `# StampScan → ByteX Ads 04 — import pack

## Images (by aspect ratio, for App campaign asset upload)
- images/square_1x1/      (1200x1200, 1:1)
- images/portrait_4x5/    (960x1200, 4:5)
- images/landscape_1.91x1/(1200x628, 1.91:1)
Videos: youtube-videos.txt (re-link by URL; no upload needed).

## Google Ads Editor CSVs
- gads-editor-import.csv     — campaigns, ad groups, headlines (1-5), descriptions (1-5).
- gads-editor-locations.csv  — per-campaign location targets (name + Google geo ID).

### How to import (Google Ads Editor)
1. PREREQUISITE (manual, blocks everything): in ByteX Ads 04, link the StampScan
   Android app (${"com.fetch.ai.stamp.identifier.value"}) and import install + in-app
   conversions (Google Play / Firebase / GA4). App campaigns cannot be created without it.
2. Editor → Account → ByteX Ads 04 → Accounts pane → "Import" → choose gads-editor-import.csv.
   Map columns when prompted. Review in the pending-changes panel BEFORE posting.
3. Add location targets from gads-editor-locations.csv (Editor: campaign → Locations →
   paste IDs), since App-campaign location import via CSV is unreliable.
4. Upload images from the ratio subfolders above + add the YouTube videos by URL.
5. Set Target CPA / budget per the import; keep campaigns PAUSED; review, then Post.

NOTE: Google Ads Editor's bulk CSV support for App campaigns is limited — treat this
pack as a faithful build spec. Some fields (app link, conversions, asset attachment)
must be set manually. All ad text + targeting values are exact from the source account.
`;
writeFileSync(`${DIR}/README.md`, readme);
console.log("Wrote gads-editor-import.csv, gads-editor-locations.csv, README.md");
