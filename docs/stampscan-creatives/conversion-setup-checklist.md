# ByteX Ads 04 — StampScan App Conversion Setup (prerequisite checklist)

**Why this comes first:** App campaigns cannot be created in an account until the app is
linked and conversions exist. The two source campaigns bid with **app goal type 2 =
"Installs, optimizing for in-app actions, with a Target cost-per-install"** (Target CPA
$0.30 EU / $1.00 US). That goal needs **install tracking AND ≥1 in-app conversion event**
configured in ByteX Ads 04 — installs alone are not enough.

- **App:** StampScan (Android) — `com.fetch.ai.stamp.identifier.value`, Google Play
- **Target account:** ByteX Ads 04 (`765-687-6964` / `7656876964`), under MCC_Diep
- **Identity with access:** `tung@ichime.dev` (Admin/Standard needed for conversion + linking changes)

---

## A. Link the app data source (choose the one the app already uses)

The in-app events almost certainly already flow through **Firebase / Google Analytics for
Firebase** (since the source account ran in-app-optimized campaigns). Use the SAME source so
historical event definitions match.

- [ ] **Option 1 — Firebase/GA4 (recommended, matches source):**
  - In **Firebase console → Project settings → Integrations → Google Ads**, link the Google
    Ads account **ByteX Ads 04 (`7656876964`)**. (You'll need Firebase Owner/Editor on the
    StampScan project AND admin on the Ads account — both are `tung@ichime.dev`-class.)
  - Enable **"Personalized advertising"** and **import conversions** so Firebase/GA4 events
    become Google Ads conversion actions.
- [ ] **Option 2 — Google Play link (installs only):**
  - Ads → **Tools → Data manager / Linked accounts → Google Play** → link. Gives first-open
    (install) conversions. NOT sufficient alone for goal type 2 — pair with Option 1.
- [ ] **Option 3 — App Attribution Partner** (AppsFlyer/Adjust/Singular) if StampScan uses one:
    link the MMP and import its in-app events as conversions.

> Tip: open the SOURCE account [Diep] Account 5 → **Tools → Conversions** and note exactly
> which conversion actions the EU/US campaigns optimize for, then reproduce the same set.

---

## B. Create / import the conversion actions in ByteX Ads 04

Ads → **Goals → Conversions → Summary → + New conversion action → App**.

- [ ] **Install / First open** (Android, Google Play) — category *Install*.
- [ ] **At least one in-app event** matching the source's optimization target, e.g.:
  - [ ] `first_open` / `session_start` (engagement), or
  - [ ] the key activation event the source used (e.g. scan completed / purchase / trial).
- [ ] Set each action's **count, attribution model, and conversion window** to match the
      source account (so CPA targets stay comparable).
- [ ] Mark the in-app action(s) as **"Primary / for bidding"** at the account or campaign
      goal level — goal type 2 bids toward these.

---

## C. Verify before building campaigns

- [ ] **Conversions → Diagnostics** shows the install + in-app actions as **"Recording
      conversions"** (or "No recent conversions" but *Active*, for a brand-new link).
- [ ] App appears under **Tools → Linked accounts** (Firebase/Play/MMP) as **Linked**.
- [ ] Account-default goal includes the in-app action (Goals → check the campaign goal set).

---

## D. Then build the campaigns

Once A–C are green:
1. Import **`gads-editor-import-EU.csv`** and **`gads-editor-import-US.csv`** in Google Ads
   Editor (or build by hand from the blueprint).
2. Add locations from **`gads-editor-locations-EU.csv`** (25 EU) / **`-US.csv`** (US).
3. Upload images from `images/{square_1x1,portrait_4x5,landscape_1.91x1}/` and add the
   videos from `youtube-videos.txt` by URL.
4. Set Target CPA ($0.30 EU / $1.00 US) + daily budget ($36 / $20); keep **Paused**; review; Post.

**Blockers if skipped:** without B's in-app action, Google won't let you save a goal-type-2
App campaign (it forces an installs-only goal). Without A, you can't create an App campaign
for this app at all.
