// EU App campaign — Phase 2 (upload assets) + Phase 3 (ad groups + app ads).
// Stages:  assets-validate | assets-apply | ads-validate | ads-apply
import keytar from "keytar";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { GoogleAdsApi, enums, ResourceNames } from "google-ads-api";

const STAGE = process.argv[2] || "assets-validate";
const TGT = "7656876964", SRC = "8370608815", SRC_EU = "23581847001";
const NEW_CAMPAIGN = `customers/${TGT}/campaigns/23957492769`;
const IMG_ROOT = "/Users/admin/Documents/GitHub/_tools/ads-mcp-server/docs/stampscan-creatives/images";
const MAP_FILE = "/Users/admin/Documents/GitHub/_tools/ads-mcp-server/_bytex_eu_assetmap.json";

const g = async (f) => (await keytar.getPassword("ads-mcp", `google:_shared:${f}`)) || "";
const [developer_token, client_id, client_secret, refresh_token] = await Promise.all([
  g("developer_token"), g("client_id"), g("client_secret"), g("refresh_token"),
]);
const api = new GoogleAdsApi({ client_id, client_secret, developer_token });
const tgt = api.Customer({ customer_id: TGT, refresh_token, login_customer_id: TGT });
const src = api.Customer({ customer_id: SRC, refresh_token, login_customer_id: SRC });

const errDump = (e) => { console.log("❌ FAIL:"); for (const err of (e.errors || [])) { const p=(err.location?.field_path_elements||[]).map(x=>x.field_name+(x.index!=null?`[${x.index}]`:"")).join("."); console.log(`   code=${JSON.stringify(err.error_code)} field="${p}" :: ${err.message}`);} if(!e.errors) console.log("  ", e.message||String(e)); };

// ── Gather source EU ad-group structure ────────────────────────────────────
const rows = await src.query(`SELECT ad_group.id, ad_group.name, ad_group_ad.ad.app_ad.headlines, ad_group_ad.ad.app_ad.descriptions, ad_group_ad.ad.app_ad.images, ad_group_ad.ad.app_ad.youtube_videos FROM ad_group_ad WHERE campaign.id=${SRC_EU}`);
const adGroups = rows.map(a => { const app=a.ad_group_ad.ad.app_ad||{}; return {
  name: a.ad_group.name,
  headlines: (app.headlines||[]).map(h=>h.text),
  descriptions: (app.descriptions||[]).map(d=>d.text),
  imgRNs: (app.images||[]).map(i=>i.asset),
  vidRNs: (app.youtube_videos||[]).map(v=>v.asset),
};});
const allImgRN = [...new Set(adGroups.flatMap(a=>a.imgRNs))];
const allVidRN = [...new Set(adGroups.flatMap(a=>a.vidRNs))];

// Index local image files by source asset id (filename = {srcId}_{w}x{h}.ext).
const localById = {};
for (const bucket of readdirSync(IMG_ROOT)) {
  const dir = `${IMG_ROOT}/${bucket}`;
  if (!existsSync(dir) || !readdirSync) continue;
  try { for (const f of readdirSync(dir)) { const m=f.match(/^(\d+)_/); if(m) localById[m[1]] = `${dir}/${f}`; } } catch {}
}

if (STAGE.startsWith("assets")) {
  // Resolve source video asset RN → youtube id.
  const vmap = {};
  if (allVidRN.length) {
    const vr = await src.query(`SELECT asset.resource_name, asset.youtube_video_asset.youtube_video_id FROM asset WHERE asset.resource_name IN (${allVidRN.map(r=>`'${r}'`).join(",")})`);
    for (const r of vr) vmap[r.asset.resource_name] = r.asset.youtube_video_asset?.youtube_video_id;
  }
  const imgOps = allImgRN.map(rn => {
    const id = rn.split("/").pop();
    const path = localById[id];
    if (!path) throw new Error(`no local file for source image ${id}`);
    return { entity:"asset", operation:"create", _srcRN: rn, resource:{ name:`EU_img_${id}`, type:enums.AssetType.IMAGE, image_asset:{ data: readFileSync(path) } } };
  });
  const vidOps = allVidRN.map(rn => ({ entity:"asset", operation:"create", _srcRN: rn, resource:{ name:`EU_vid_${vmap[rn]}`, type:enums.AssetType.YOUTUBE_VIDEO, youtube_video_asset:{ youtube_video_id: vmap[rn] } } }));
  const ops = [...imgOps, ...vidOps];
  console.log(`Asset ops: ${imgOps.length} images + ${vidOps.length} videos`);
  try {
    const res = await tgt.mutateResources(ops.map(({_srcRN,...o})=>o), { validate_only: STAGE.endsWith("validate"), partial_failure: false });
    if (STAGE.endsWith("validate")) { console.log("✅ ASSETS VALIDATE PASSED"); }
    else {
      const results = res.mutate_operation_responses || res.results;
      const map = { images:{}, videos:{} };
      results.forEach((r, i) => { const rn = r.asset_result?.resource_name; const o = ops[i]; if (i < imgOps.length) map.images[o._srcRN]=rn; else map.videos[o._srcRN]=rn; });
      writeFileSync(MAP_FILE, JSON.stringify(map, null, 2));
      console.log(`✅ ASSETS CREATED: ${Object.keys(map.images).length} images, ${Object.keys(map.videos).length} videos → ${MAP_FILE}`);
    }
  } catch(e){ errDump(e); }
}

if (STAGE.startsWith("ads")) {
  const map = JSON.parse(readFileSync(MAP_FILE, "utf8"));
  let i = -10;
  const ops = [];
  for (const ag of adGroups) {
    const agRN = ResourceNames.adGroup(TGT, String(i--));
    ops.push({ entity:"ad_group", operation:"create", resource:{ resource_name:agRN, name:ag.name, campaign:NEW_CAMPAIGN, status:enums.AdGroupStatus.ENABLED } });
    ops.push({ entity:"ad_group_ad", operation:"create", resource:{ ad_group:agRN, status:enums.AdGroupAdStatus.ENABLED, ad:{ app_ad:{
      headlines: ag.headlines.map(t=>({text:t})),
      descriptions: ag.descriptions.map(t=>({text:t})),
      images: ag.imgRNs.map(rn=>({asset: map.images[rn]})).filter(x=>x.asset),
      youtube_videos: ag.vidRNs.map(rn=>({asset: map.videos[rn]})).filter(x=>x.asset),
    }}}});
  }
  console.log(`Ad ops: ${ops.length} (${adGroups.length} ad groups + ${adGroups.length} app ads)`);
  try {
    const res = await tgt.mutateResources(ops, { validate_only: STAGE.endsWith("validate") });
    if (STAGE.endsWith("validate")) console.log("✅ ADS VALIDATE PASSED");
    else { console.log("✅ ADS CREATED:"); for (const r of (res.mutate_operation_responses||res.results||[])) { const rn=r.ad_group_result?.resource_name||r.ad_group_ad_result?.resource_name; if(rn) console.log("   ", rn); } }
  } catch(e){ errDump(e); }
}
