// Dump + download all creative assets for the two StampScan App campaigns.
// Writes a manifest (CSV), url lists, and downloads images for re-upload.
import keytar from "keytar";
import { writeFileSync, mkdirSync, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GoogleAdsApi } from "google-ads-api";

const g = async (f) => (await keytar.getPassword("ads-mcp", `google:_shared:${f}`)) || "";
const [developer_token, client_id, client_secret, refresh_token] = await Promise.all([
  g("developer_token"), g("client_id"), g("client_secret"), g("refresh_token"),
]);
const api = new GoogleAdsApi({ client_id, client_secret, developer_token });
const cust = api.Customer({ customer_id: "8370608815", refresh_token, login_customer_id: "8370608815" });

const CAMPAIGN_IDS = ["23581847001", "23592298000"]; // EU_21Feb, US_21Feb
const OUT = "docs/stampscan-creatives";
mkdirSync(OUT + "/images", { recursive: true });

// Collect all image + video asset refs across both campaigns.
const imgRefs = new Set(), vidRefs = new Set();
for (const id of CAMPAIGN_IDS) {
  const ads = await cust.query(`
    SELECT ad_group_ad.ad.app_ad.images, ad_group_ad.ad.app_ad.youtube_videos
    FROM ad_group_ad WHERE campaign.id=${id}`);
  for (const a of ads) {
    const app = a.ad_group_ad.ad.app_ad || {};
    for (const im of app.images || []) if (im.asset) imgRefs.add(im.asset);
    for (const v of app.youtube_videos || []) if (v.asset) vidRefs.add(v.asset);
  }
}
console.log(`Unique image assets: ${imgRefs.size} | unique video assets: ${vidRefs.size}`);

// Resolve image assets → url + dimensions + name.
const images = [];
if (imgRefs.size) {
  const list = [...imgRefs].map(r => `'${r}'`).join(",");
  const rows = await cust.query(`
    SELECT asset.id, asset.name, asset.image_asset.full_size.url,
           asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels,
           asset.image_asset.file_size
    FROM asset WHERE asset.resource_name IN (${list})`);
  for (const r of rows) {
    const a = r.asset;
    images.push({
      id: a.id, name: (a.name || `asset_${a.id}`).replace(/[^\w.-]+/g, "_"),
      w: a.image_asset?.full_size?.width_pixels, h: a.image_asset?.full_size?.height_pixels,
      bytes: a.image_asset?.file_size, url: a.image_asset?.full_size?.url,
    });
  }
}
// Resolve video assets → youtube id + title.
const videos = [];
if (vidRefs.size) {
  const list = [...vidRefs].map(r => `'${r}'`).join(",");
  const rows = await cust.query(`
    SELECT asset.id, asset.name, asset.youtube_video_asset.youtube_video_id,
           asset.youtube_video_asset.youtube_video_title
    FROM asset WHERE asset.resource_name IN (${list})`);
  for (const r of rows) videos.push({
    id: r.asset.id, vid: r.asset.youtube_video_asset?.youtube_video_id,
    title: r.asset.youtube_video_asset?.youtube_video_title || "",
  });
}

// Manifest CSV + url lists.
const csv = ["asset_id,name,width,height,bytes,filename,url",
  ...images.map(im => `${im.id},"${im.name}",${im.w},${im.h},${im.bytes},${im.id}_${im.w}x${im.h}.${(im.url||"").includes(".png")?"png":"jpg"},${im.url}`)].join("\n");
writeFileSync(`${OUT}/images-manifest.csv`, csv);
writeFileSync(`${OUT}/image-urls.txt`, images.map(im => im.url).filter(Boolean).join("\n") + "\n");
writeFileSync(`${OUT}/youtube-videos.txt`,
  videos.map(v => `https://www.youtube.com/watch?v=${v.vid}\t${v.title}`).join("\n") + "\n");

// Download images.
let ok = 0, fail = 0;
for (const im of images) {
  if (!im.url) { fail++; continue; }
  const ext = im.url.includes(".png") ? "png" : "jpg";
  const fn = `${OUT}/images/${im.id}_${im.w}x${im.h}.${ext}`;
  try {
    const res = await fetch(im.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(fn));
    ok++;
  } catch (e) { console.error(`  fail ${im.id}: ${e.message}`); fail++; }
}
console.log(`\nImages downloaded: ${ok} ok, ${fail} failed → ${OUT}/images/`);
console.log(`Manifest: ${OUT}/images-manifest.csv`);
console.log(`URL lists: ${OUT}/image-urls.txt , ${OUT}/youtube-videos.txt (${videos.length} videos)`);
