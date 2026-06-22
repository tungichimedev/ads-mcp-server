// Extract a full replication blueprint for the two StampScan App campaigns
// (EU_21Feb, US_21Feb) from [Diep] Account 5, and write a markdown spec.
import keytar from "keytar";
import { writeFileSync } from "node:fs";
import { GoogleAdsApi } from "google-ads-api";

const g = async (f) => (await keytar.getPassword("ads-mcp", `google:_shared:${f}`)) || "";
const [developer_token, client_id, client_secret, refresh_token] = await Promise.all([
  g("developer_token"), g("client_id"), g("client_secret"), g("refresh_token"),
]);
const api = new GoogleAdsApi({ client_id, client_secret, developer_token });
const cust = api.Customer({ customer_id: "8370608815", refresh_token, login_customer_id: "8370608815" });

const CAMPAIGNS = [
  { id: "23581847001", tag: "EU_21Feb" },
  { id: "23592298000", tag: "US_21Feb" },
];

const q = async (gaql) => { try { return await cust.query(gaql); } catch (e) { console.error("  q err:", (e.errors?.[0]?.message || e.message || e)); return []; } };
const micros = (m) => (Number(m || 0) / 1e6);

let md = `# StampScan → ByteX Ads 04 — App Campaign Replication Blueprint\n\nSource: [Diep] Account 5 (8370608815). Target: ByteX Ads 04 (7656876964).\nApp: **com.fetch.ai.stamp.identifier.value** (Android / Google Play).\nThese are **App install campaigns** (Target CPA). Recreate as App campaigns once the app + conversions are linked in ByteX Ads 04. Ad **assets must be re-uploaded** (image/video assets do not transfer across accounts).\n\n`;

for (const C of CAMPAIGNS) {
  console.log(`\n=== ${C.tag} (${C.id}) ===`);
  const c = (await q(`
    SELECT campaign.name, campaign.advertising_channel_type, campaign.advertising_channel_sub_type,
           campaign.bidding_strategy_type, campaign.target_cpa.target_cpa_micros,
           campaign.app_campaign_setting.app_id, campaign.app_campaign_setting.app_store,
           campaign.app_campaign_setting.bidding_strategy_goal_type,
           campaign.optimization_score, campaign_budget.amount_micros, campaign_budget.name
    FROM campaign WHERE campaign.id=${C.id}`))[0];
  if (!c) { md += `## ${C.tag}: NOT FOUND\n\n`; continue; }

  // Geo targets
  const geoRows = await q(`SELECT campaign_criterion.location.geo_target_constant, campaign_criterion.negative FROM campaign_criterion WHERE campaign.id=${C.id} AND campaign_criterion.type=LOCATION`);
  const geoRN = geoRows.map(r => r.campaign_criterion.location.geo_target_constant).filter(Boolean);
  let geoNames = [];
  if (geoRN.length) {
    const list = geoRN.map(r => `'${r}'`).join(",");
    const gn = await q(`SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${list})`);
    geoNames = gn.map(r => `${r.geo_target_constant.name} (${r.geo_target_constant.country_code || r.geo_target_constant.id})`);
  }
  // Languages
  const langRows = await q(`SELECT campaign_criterion.language.language_constant FROM campaign_criterion WHERE campaign.id=${C.id} AND campaign_criterion.type=LANGUAGE`);
  const langRN = langRows.map(r => r.campaign_criterion.language.language_constant).filter(Boolean);
  let langNames = [];
  if (langRN.length) {
    const list = langRN.map(r => `'${r}'`).join(",");
    const ln = await q(`SELECT language_constant.name, language_constant.code FROM language_constant WHERE language_constant.resource_name IN (${list})`);
    langNames = ln.map(r => `${r.language_constant.name} (${r.language_constant.code})`);
  }

  md += `## ${C.tag} — ${c.campaign.name}\n\n`;
  md += `- **Type:** App campaign (channel ${c.campaign.advertising_channel_type}, subtype ${c.campaign.advertising_channel_sub_type})\n`;
  md += `- **App:** ${c.campaign.app_campaign_setting?.app_id} (store ${c.campaign.app_campaign_setting?.app_store})\n`;
  md += `- **Bidding:** type ${c.campaign.bidding_strategy_type} (6=TARGET_CPA); **Target CPA = $${micros(c.campaign.target_cpa?.target_cpa_micros).toFixed(2)}**; app goal type ${c.campaign.app_campaign_setting?.bidding_strategy_goal_type}\n`;
  md += `- **Budget:** $${micros(c.campaign_budget?.amount_micros).toFixed(2)}/day\n`;
  md += `- **Languages:** ${langNames.join(", ") || "(none)"}\n`;
  md += `- **Geo targets (${geoNames.length}):** ${geoNames.join(", ") || geoRN.join(", ")}\n\n`;

  // Ad groups + ads
  const ads = await q(`
    SELECT ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name,
           ad_group_ad.ad.app_ad.headlines, ad_group_ad.ad.app_ad.descriptions,
           ad_group_ad.ad.app_ad.mandatory_ad_text, ad_group_ad.ad.app_ad.images,
           ad_group_ad.ad.app_ad.youtube_videos, ad_group_ad.ad.app_ad.html5_media_bundles
    FROM ad_group_ad WHERE campaign.id=${C.id}`);

  // collect asset refs to resolve
  const assetRefs = new Set();
  for (const a of ads) {
    const app = a.ad_group_ad.ad.app_ad || {};
    for (const im of app.images || []) if (im.asset) assetRefs.add(im.asset);
    for (const v of app.youtube_videos || []) if (v.asset) assetRefs.add(v.asset);
    for (const h of app.html5_media_bundles || []) if (h.asset) assetRefs.add(h.asset);
  }
  const assetMap = {};
  if (assetRefs.size) {
    const list = [...assetRefs].map(r => `'${r}'`).join(",");
    const ar = await q(`SELECT asset.resource_name, asset.name, asset.type, asset.image_asset.full_size.url, asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels, asset.youtube_video_asset.youtube_video_id FROM asset WHERE asset.resource_name IN (${list})`);
    for (const r of ar) assetMap[r.asset.resource_name] = r.asset;
  }

  const byAg = {};
  for (const a of ads) {
    const ag = a.ad_group.id;
    (byAg[ag] ??= { name: a.ad_group.name, ads: [] }).ads.push(a);
  }
  md += `### Ad groups (${Object.keys(byAg).length})\n\n`;
  for (const [agId, ag] of Object.entries(byAg)) {
    md += `**Ad group: ${ag.name}** (${agId}) — ${ag.ads.length} ad(s)\n\n`;
    for (const a of ag.ads) {
      const app = a.ad_group_ad.ad.app_ad || {};
      md += `- Ad ${a.ad_group_ad.ad.id}:\n`;
      md += `  - Headlines: ${(app.headlines || []).map(h => `"${h.text}"`).join(" | ") || "(none)"}\n`;
      md += `  - Descriptions: ${(app.descriptions || []).map(d => `"${d.text}"`).join(" | ") || "(none)"}\n`;
      if (app.mandatory_ad_text?.text) md += `  - Mandatory text: "${app.mandatory_ad_text.text}"\n`;
      const imgs = (app.images || []).map(im => assetMap[im.asset]).filter(Boolean);
      const vids = (app.youtube_videos || []).map(v => assetMap[v.asset]).filter(Boolean);
      if (imgs.length) md += `  - Images (re-upload, ${imgs.length}):\n${imgs.map(im => `      - ${im.name || "?"} [${im.image_asset?.full_size?.width_pixels}x${im.image_asset?.full_size?.height_pixels}] ${im.image_asset?.full_size?.url || ""}`).join("\n")}\n`;
      if (vids.length) md += `  - Videos (re-upload): ${vids.map(v => `youtu.be/${v.youtube_video_asset?.youtube_video_id}`).join(" ; ")}\n`;
      const html5 = (app.html5_media_bundles || []).length;
      if (html5) md += `  - HTML5 media bundles: ${html5}\n`;
    }
    md += `\n`;
  }
}

const out = "docs/stampscan-bytex04-blueprint.md";
writeFileSync(out, md);
console.log(`\nWrote ${out}`);
console.log(md);
