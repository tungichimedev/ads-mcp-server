// Phase 1: create EU App campaign skeleton in ByteX Ads 04 (budget + campaign +
// geo + language), atomic. Run with `validate` arg for a dry run (creates nothing).
import keytar from "keytar";
import { GoogleAdsApi, enums, ResourceNames } from "google-ads-api";

const MODE = process.argv[2] === "apply" ? "apply" : "validate";
const TGT = "7656876964";                       // ByteX Ads 04
const SRC = "8370608815";                       // [Diep] Account 5
const SRC_EU = "23581847001";                   // source EU campaign
const FIRST_OPEN = `customers/${TGT}/conversionActions/7657362910`;

const g = async (f) => (await keytar.getPassword("ads-mcp", `google:_shared:${f}`)) || "";
const [developer_token, client_id, client_secret, refresh_token] = await Promise.all([
  g("developer_token"), g("client_id"), g("client_secret"), g("refresh_token"),
]);
const api = new GoogleAdsApi({ client_id, client_secret, developer_token });
const tgt = api.Customer({ customer_id: TGT, refresh_token, login_customer_id: TGT });
const src = api.Customer({ customer_id: SRC, refresh_token, login_customer_id: SRC });

// Pull exact geo + language criteria from the source EU campaign.
const geoRN = (await src.query(`SELECT campaign_criterion.location.geo_target_constant FROM campaign_criterion WHERE campaign.id=${SRC_EU} AND campaign_criterion.type=LOCATION`)).map(r => r.campaign_criterion.location.geo_target_constant);
const langRN = (await src.query(`SELECT campaign_criterion.language.language_constant FROM campaign_criterion WHERE campaign.id=${SRC_EU} AND campaign_criterion.type=LANGUAGE`)).map(r => r.campaign_criterion.language.language_constant);
console.log(`Source EU: ${geoRN.length} geos, ${langRN.length} languages`);

// Temp resource names (negative IDs) for atomic create.
const budgetRN = ResourceNames.campaignBudget(TGT, "-1");
const campaignRN = ResourceNames.campaign(TGT, "-2");

const ops = [
  { entity: "campaign_budget", operation: "create", resource: {
      resource_name: budgetRN,
      name: "Budget - Stampscan_CPI_EU_ByteX04",
      amount_micros: 36_000_000,
      delivery_method: enums.BudgetDeliveryMethod.STANDARD,
      explicitly_shared: false,
  }},
  { entity: "campaign", operation: "create", resource: {
      resource_name: campaignRN,
      name: "Stampscan_CPI_EU_ByteX04",
      status: enums.CampaignStatus.PAUSED,
      advertising_channel_type: enums.AdvertisingChannelType.MULTI_CHANNEL,
      advertising_channel_sub_type: enums.AdvertisingChannelSubType.APP_CAMPAIGN,
      campaign_budget: budgetRN,
      target_cpa: { target_cpa_micros: 300_000 },
      app_campaign_setting: {
        app_id: "com.fetch.ai.stamp.identifier.value",
        app_store: enums.AppCampaignAppStore.GOOGLE_APP_STORE,
        bidding_strategy_goal_type: enums.AppCampaignBiddingStrategyGoalType.OPTIMIZE_IN_APP_CONVERSIONS_TARGET_INSTALL_COST,
      },
      selective_optimization: { conversion_actions: [FIRST_OPEN] },
      contains_eu_political_advertising: enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
  }},
  ...geoRN.map(rn => ({ entity: "campaign_criterion", operation: "create", resource: {
      campaign: campaignRN, location: { geo_target_constant: rn } } })),
  ...langRN.map(rn => ({ entity: "campaign_criterion", operation: "create", resource: {
      campaign: campaignRN, language: { language_constant: rn } } })),
];

console.log(`Operations: ${ops.length} (1 budget + 1 campaign + ${geoRN.length} geo + ${langRN.length} lang)`);
console.log(`MODE = ${MODE}`);
try {
  const res = await tgt.mutateResources(ops, { validate_only: MODE === "validate" });
  if (MODE === "validate") {
    console.log("✅ VALIDATE-ONLY PASSED — v24 accepts the App campaign structure. Nothing created.");
  } else {
    const names = (res.mutate_operation_responses || res.results || res || []).map(r => JSON.stringify(r)).slice(0, 4);
    console.log("✅ CREATED:", JSON.stringify(res.results || res, null, 2).slice(0, 1200));
  }
} catch (e) {
  console.log("❌ FAIL:");
  for (const err of (e.errors || [])) {
    const path = (err.location?.field_path_elements || []).map(p => p.field_name + (p.index != null ? `[${p.index}]` : "")).join(".");
    console.log(`   - code=${JSON.stringify(err.error_code)} field="${path}" :: ${err.message} ${err.trigger ? JSON.stringify(err.trigger) : ""}`);
  }
  if (!e.errors) console.log("   ", e.message || String(e));
}
