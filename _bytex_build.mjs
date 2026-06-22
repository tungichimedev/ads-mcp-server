// Unified ByteX Ads 04 App-campaign builder.  Usage: node _bytex_build.mjs <EU|US> <stage>
// stages: skeleton-validate skeleton-apply assets-validate assets-apply ads-validate ads-apply
import keytar from "keytar";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { GoogleAdsApi, enums, ResourceNames } from "google-ads-api";

const TAG = (process.argv[2] || "").toUpperCase();
const STAGE = process.argv[3] || "skeleton-validate";
const TGT = "7656876964", SRC = "8370608815";
const FIRST_OPEN = `customers/${TGT}/conversionActions/7657362910`;
const IMG_ROOT = "/Users/admin/Documents/GitHub/_tools/ads-mcp-server/docs/stampscan-creatives/images";

const CONFIG = {
  EU: { srcCampaign:"23581847001", name:"Stampscan_CPI_EU_ByteX04", tcpa:300_000, budget:36_000_000 },
  US: { srcCampaign:"23592298000", name:"Stampscan_CPI_US_ByteX04", tcpa:1_000_000, budget:20_000_000 },
};
const C = CONFIG[TAG];
if (!C) { console.log("first arg must be EU or US"); process.exit(1); }
const STATE = `/Users/admin/Documents/GitHub/_tools/ads-mcp-server/_bytex_${TAG}_state.json`;
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE,"utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state,null,2));

const g = async (f) => (await keytar.getPassword("ads-mcp", `google:_shared:${f}`)) || "";
const [developer_token, client_id, client_secret, refresh_token] = await Promise.all([
  g("developer_token"), g("client_id"), g("client_secret"), g("refresh_token")]);
const api = new GoogleAdsApi({ client_id, client_secret, developer_token });
const tgt = api.Customer({ customer_id: TGT, refresh_token, login_customer_id: TGT });
const src = api.Customer({ customer_id: SRC, refresh_token, login_customer_id: SRC });
const V = STAGE.endsWith("validate");
const errDump = (e) => { console.log("❌ FAIL:"); for (const err of (e.errors||[])) { const p=(err.location?.field_path_elements||[]).map(x=>x.field_name+(x.index!=null?`[${x.index}]`:"")).join("."); console.log(`   code=${JSON.stringify(err.error_code)} field="${p}" :: ${err.message}`);} if(!e.errors) console.log("  ",e.message||String(e)); };

// local image index by source asset id
const localById = {};
for (const b of readdirSync(IMG_ROOT)) { const d=`${IMG_ROOT}/${b}`; try { for (const f of readdirSync(d)) { const m=f.match(/^(\d+)_/); if(m) localById[m[1]]=`${d}/${f}`; } } catch {} }

// ── SKELETON ────────────────────────────────────────────────────────────────
if (STAGE.startsWith("skeleton")) {
  const geoRN = (await src.query(`SELECT campaign_criterion.location.geo_target_constant FROM campaign_criterion WHERE campaign.id=${C.srcCampaign} AND campaign_criterion.type=LOCATION`)).map(r=>r.campaign_criterion.location.geo_target_constant);
  const langRN = (await src.query(`SELECT campaign_criterion.language.language_constant FROM campaign_criterion WHERE campaign.id=${C.srcCampaign} AND campaign_criterion.type=LANGUAGE`)).map(r=>r.campaign_criterion.language.language_constant);
  const bRN = ResourceNames.campaignBudget(TGT,"-1"), cRN = ResourceNames.campaign(TGT,"-2");
  const ops = [
    { entity:"campaign_budget", operation:"create", resource:{ resource_name:bRN, name:`Budget - ${C.name}`, amount_micros:C.budget, delivery_method:enums.BudgetDeliveryMethod.STANDARD, explicitly_shared:false } },
    { entity:"campaign", operation:"create", resource:{ resource_name:cRN, name:C.name, status:enums.CampaignStatus.PAUSED,
      advertising_channel_type:enums.AdvertisingChannelType.MULTI_CHANNEL, advertising_channel_sub_type:enums.AdvertisingChannelSubType.APP_CAMPAIGN,
      campaign_budget:bRN, target_cpa:{ target_cpa_micros:C.tcpa },
      app_campaign_setting:{ app_id:"com.fetch.ai.stamp.identifier.value", app_store:enums.AppCampaignAppStore.GOOGLE_APP_STORE, bidding_strategy_goal_type:enums.AppCampaignBiddingStrategyGoalType.OPTIMIZE_IN_APP_CONVERSIONS_TARGET_INSTALL_COST },
      selective_optimization:{ conversion_actions:[FIRST_OPEN] },
      contains_eu_political_advertising:enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING } },
    ...geoRN.map(rn=>({ entity:"campaign_criterion", operation:"create", resource:{ campaign:cRN, location:{ geo_target_constant:rn } } })),
    ...langRN.map(rn=>({ entity:"campaign_criterion", operation:"create", resource:{ campaign:cRN, language:{ language_constant:rn } } })),
  ];
  console.log(`${TAG} skeleton: 1 budget + 1 campaign + ${geoRN.length} geo + ${langRN.length} lang`);
  try { const res = await tgt.mutateResources(ops, { validate_only:V });
    if (V) console.log("✅ SKELETON VALIDATE PASSED");
    else { const cr=(res.mutate_operation_responses||res.results).find(r=>r.campaign_result)?.campaign_result?.resource_name; state.campaign=cr; save(); console.log("✅ SKELETON CREATED, campaign:", cr); }
  } catch(e){ errDump(e); }
}

// ── ASSETS / ADS share source structure ─────────────────────────────────────
const loadAdGroups = async () => {
  const rows = await src.query(`SELECT ad_group.name, ad_group_ad.ad.app_ad.headlines, ad_group_ad.ad.app_ad.descriptions, ad_group_ad.ad.app_ad.images, ad_group_ad.ad.app_ad.youtube_videos FROM ad_group_ad WHERE campaign.id=${C.srcCampaign}`);
  return rows.map(a=>{const app=a.ad_group_ad.ad.app_ad||{}; return { name:a.ad_group.name, headlines:(app.headlines||[]).map(h=>h.text), descriptions:(app.descriptions||[]).map(d=>d.text), imgRNs:(app.images||[]).map(i=>i.asset), vidRNs:(app.youtube_videos||[]).map(v=>v.asset) };});
};

if (STAGE.startsWith("assets")) {
  const ags = await loadAdGroups();
  const allImg=[...new Set(ags.flatMap(a=>a.imgRNs))], allVid=[...new Set(ags.flatMap(a=>a.vidRNs))];
  const vmap={}; if(allVid.length){ const vr=await src.query(`SELECT asset.resource_name, asset.youtube_video_asset.youtube_video_id FROM asset WHERE asset.resource_name IN (${allVid.map(r=>`'${r}'`).join(",")})`); for(const r of vr) vmap[r.asset.resource_name]=r.asset.youtube_video_asset?.youtube_video_id; }
  const imgOps = allImg.map(rn=>{ const id=rn.split("/").pop(); const p=localById[id]; if(!p) throw new Error(`no local image ${id}`); return { _src:rn, entity:"asset", operation:"create", resource:{ name:`${TAG}_img_${id}`, type:enums.AssetType.IMAGE, image_asset:{ data:readFileSync(p) } } }; });
  const vidOps = allVid.map(rn=>({ _src:rn, entity:"asset", operation:"create", resource:{ name:`${TAG}_vid_${vmap[rn]}`, type:enums.AssetType.YOUTUBE_VIDEO, youtube_video_asset:{ youtube_video_id:vmap[rn] } } }));
  const ops=[...imgOps,...vidOps];
  console.log(`${TAG} assets: ${imgOps.length} images + ${vidOps.length} videos`);
  try { const res=await tgt.mutateResources(ops.map(({_src,...o})=>o), { validate_only:V });
    if(V) console.log("✅ ASSETS VALIDATE PASSED");
    else { const results=res.mutate_operation_responses||res.results; const map={images:{},videos:{}}; results.forEach((r,i)=>{ const rn=r.asset_result?.resource_name; if(i<imgOps.length) map.images[ops[i]._src]=rn; else map.videos[ops[i]._src]=rn; }); state.assets=map; save(); console.log(`✅ ASSETS CREATED: ${Object.keys(map.images).length} img, ${Object.keys(map.videos).length} vid`); }
  } catch(e){ errDump(e); }
}

if (STAGE.startsWith("ads")) {
  const ags = await loadAdGroups();
  const map = state.assets; const campaign = state.campaign;
  let i=-10; const ops=[];
  for (const ag of ags) {
    const agRN=ResourceNames.adGroup(TGT,String(i--));
    ops.push({ entity:"ad_group", operation:"create", resource:{ resource_name:agRN, name:ag.name, campaign, status:enums.AdGroupStatus.ENABLED } });
    ops.push({ entity:"ad_group_ad", operation:"create", resource:{ ad_group:agRN, status:enums.AdGroupAdStatus.ENABLED, ad:{ app_ad:{
      headlines:ag.headlines.map(t=>({text:t})), descriptions:ag.descriptions.map(t=>({text:t})),
      images:ag.imgRNs.map(rn=>({asset:map.images[rn]})).filter(x=>x.asset),
      youtube_videos:ag.vidRNs.map(rn=>({asset:map.videos[rn]})).filter(x=>x.asset) } } } });
  }
  console.log(`${TAG} ads: ${ags.length} ad groups + ${ags.length} app ads`);
  try { const res=await tgt.mutateResources(ops, { validate_only:V });
    if(V) console.log("✅ ADS VALIDATE PASSED");
    else { console.log("✅ ADS CREATED:"); for(const r of (res.mutate_operation_responses||res.results||[])){ const rn=r.ad_group_result?.resource_name||r.ad_group_ad_result?.resource_name; if(rn) console.log("   ",rn);} }
  } catch(e){ errDump(e); }
}
