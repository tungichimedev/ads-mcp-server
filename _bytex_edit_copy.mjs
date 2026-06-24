// Edit flagged ad copy on both ByteX Ads 04 campaigns to clear MISLEADING_AD_DESIGN.
// Usage: node _bytex_edit_copy.mjs [validate|apply]
import keytar from "keytar";
import { GoogleAdsApi } from "google-ads-api";

const MODE = process.argv[2] === "apply" ? "apply" : "validate";
const TGT = "7656876964";
const CAMP = [23957492769, 23967164572];

const REPL = {
  // headlines (≤30 chars)
  "Is Your Stamp Worth $$$?": "Identify Your Stamp's Value",
  "Scan, Value, Profit": "Scan, Identify, Catalog",
  "Turn Old Stamps Into Value": "Identify Your Old Stamps",
  "Stop Guessing Stamp Value": "Estimate Stamp Value Fast",
  "The Collector Secret Tool": "The Collector's Toolkit",
  "Smart Collectors Use This": "Built for Smart Collectors",
  // descriptions (≤90 chars)
  "Discover stamps worth thousands with a simple scan": "Discover the value of your stamps with a simple scan",
  "Identify rare stamps and discover investment opportunities.": "Identify rare stamps and grow your collection.",
  "Build a digital portfolio and manage stamps like an investor.": "Build a digital portfolio and manage your collection with ease.",
  "Unlock hidden stamp value and explore global philately.": "Explore stamp values and global philately.",
};
const sub = (t) => REPL[t.trim()] || t;

const g = async (f) => (await keytar.getPassword("ads-mcp", `google:_shared:${f}`)) || "";
const [developer_token, client_id, client_secret, refresh_token] = await Promise.all([
  g("developer_token"), g("client_id"), g("client_secret"), g("refresh_token")]);
const api = new GoogleAdsApi({ client_id, client_secret, developer_token });
const c = api.Customer({ customer_id: TGT, refresh_token, login_customer_id: TGT });

const rows = await c.query(`SELECT campaign.name, ad_group.name, ad_group_ad.ad.resource_name, ad_group_ad.ad.app_ad.headlines, ad_group_ad.ad.app_ad.descriptions, ad_group_ad.ad.app_ad.mandatory_ad_text, ad_group_ad.ad.app_ad.images, ad_group_ad.ad.app_ad.youtube_videos FROM ad_group_ad WHERE campaign.id IN (${CAMP.join(",")})`);

const ops = [];
let changes = 0;
for (const r of rows) {
  const ad = r.ad_group_ad.ad, app = ad.app_ad || {};
  const newH = (app.headlines || []).map(h => ({ text: sub(h.text) }));
  const newD = (app.descriptions || []).map(d => ({ text: sub(d.text) }));
  const changed = newH.some((h, i) => h.text !== app.headlines[i].text) || newD.some((d, i) => d.text !== app.descriptions[i].text);
  if (changed) changes++;
  const updated = (app.headlines || []).map((h, i) => h.text !== newH[i].text ? `\n     H: "${h.text}" → "${newH[i].text}"` : "").join("")
                + (app.descriptions || []).map((d, i) => d.text !== newD[i].text ? `\n     D: "${d.text}" → "${newD[i].text}"` : "").join("");
  if (updated) console.log(`${r.campaign.name}/${r.ad_group.name}:${updated}`);
  ops.push({ resource_name: ad.resource_name, app_ad: {
    headlines: newH, descriptions: newD,
    ...(app.mandatory_ad_text?.text ? { mandatory_ad_text: { text: app.mandatory_ad_text.text } } : {}),
    images: (app.images || []).map(i => ({ asset: i.asset })),
    youtube_videos: (app.youtube_videos || []).map(v => ({ asset: v.asset })),
  }});
}
console.log(`\n${changes} ads changed. MODE=${MODE}`);
try {
  await c.ads.update(ops, { validate_only: MODE === "validate" });
  console.log(MODE === "validate" ? "✅ VALIDATE PASSED (ads are editable; nothing changed)" : "✅ APPLIED — ads updated, fresh policy review triggered");
} catch (e) {
  console.log("❌ FAIL:");
  for (const err of (e.errors || [])) console.log("   -", err.message, err.error_code ? JSON.stringify(err.error_code) : "");
  if (!e.errors) console.log("   ", e.message || String(e));
}
