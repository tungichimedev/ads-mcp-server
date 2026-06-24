# StampScan → ByteX Ads 04 — import pack

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
   Android app (com.fetch.ai.stamp.identifier.value) and import install + in-app
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
