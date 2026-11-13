# App Intel

A self-hosted, AppKittie-style app market dashboard built only on free, public sources. It covers:

- **App Store and Google Play:** top charts, search and app details.
- **Estimates:** monthly downloads, MRR and revenue for every app, each shown as a low / mid / high range with the method behind it.
- **Brands:** social accounts, latest YouTube and Bluesky posts, Hacker News and Reddit mentions, and Meta Ad Library ads.
- **Calibration:** a check against the real, verified MRR of apps that publish it (TrustMRR).
- **Tracking:** daily snapshots of apps you track, so estimates turn into observed growth over time.

> Every revenue and download figure is a **model**, not measured data. Treat them as order-of-magnitude ranges.

## Run it

```bash
npm install
npm run demo        # fictional demo data, no network: http://localhost:4317
npm start           # live data
npm test            # estimation-engine tests
```

Node 22.9+ (uses the built-in `node:sqlite`). Works on Windows, macOS and Linux. Settings go in a `.env` file (copy `.env.example`); it is read automatically. It runs on your machine because Google Play and the Meta API can't be called from a browser page (no CORS, and the Meta token must stay server-side).

### Optional: Meta Ad Library (free, about 15 minutes plus ID approval)

1. Confirm your identity at https://www.facebook.com/ID (government ID; usually a few days).
2. Create an app at https://developers.facebook.com/apps. No App Review is needed.
3. In the Graph API Explorer, generate a user token, then exchange it for a long-lived (~60-day) token.
4. Put `META_TOKEN=xxxx` in `.env` and run `npm start`. Optional: `META_COUNTRIES=DE,FR,GB`, `META_API_VERSION=v25.0`.

Without a token, the Ad library tab shows deep links to the Meta, Google, TikTok and LinkedIn ad libraries instead.

### Search-as-you-type

Typing in the sidebar search shows matches immediately from the local catalogue, then live results from both stores: icon, name, developer, platform and installs or ratings. Use ↑/↓ and Enter to open an app; Enter on plain text opens full search. Any app that exists on either store right now can be found this way.

### Categories: what's working (daily crawl)

`npm start` crawls every category × free / paid / grossing chart on both stores once a day (also available as `npm run crawl` or via cron). It saves each day's ranks, and the **Categories** tab turns them into:

- **Overview:** each category's #1 grossing app, the summed revenue estimate of its top 50 (a size signal, not market size), the share of apps with in-app purchases, median rating, and the count of hidden earners.
- **Per category:**
  - **Rising:** up 5+ places vs ~7 days ago.
  - **New in chart:** apps that weren't in the chart when the crawl history started.
  - **Hidden earners:** top-50 grossing with ratings in the bottom fifth. These are quiet utility apps that make money without a big audience.

Countries are set with `CRAWL_COUNTRIES=us,gb,de` (default `us`).
- **First run:** about 1 hour per country, mostly Google Play detail pages.
- **After that:** about 10–15 minutes per country, because Play details are only re-fetched when older than 7 days.
- **Pace:** stays under about 20 requests/min for Apple.
- **Rising and new:** need about a week of daily crawls before they're meaningful.

A grossing rank is the strongest public revenue signal there is. Our dollar estimates don't use it, because there are no reliable public constants to convert rank into revenue. Calibrating rank against TrustMRR verified apps is the natural next step.

### How many apps you get (and how to get more)

1. **Charts** (daily): every category's free, paid and grossing charts on both stores. That's roughly 10–25K apps per country. The App Store and Google Play crawl in parallel, overall chart first.
2. **Expansion** (after the charts, on by default; set `CRAWL_EXPAND=0` to turn it off): follows leads from charted apps.
   - ~200 niche keyword searches per store.
   - Other apps by every charted developer.
   - Google Play similar apps for the top-50 apps per chart.
   - Install counts for the Play apps it discovers (up to 2,500 detail pages per run).
   - iOS apps with fewer than 20 ratings are skipped (`EXPAND_MIN_RATINGS`).
   - Each lead is marked done for 30 days, so later runs only process new leads.
   - The first expansion run takes ~1.5 h. Edit the keyword list in `lib/expand.js` to target your niches.
3. **More countries:** `CRAWL_COUNTRIES=us,gb,de,in`. Each country adds its own charts and leads.
4. **Everything (~5M):** the AppGoblin import below.

### Worth building: apps with a beatable incumbent

The **Worth building** tab scores every app in the latest crawl (grossing and free charts, all categories). It shows **Top picks** and **Best per category**. Score = 30% demand + 25% weakness + 15% open field + 20% buildable + 10% pays:

- **Demand:** best grossing rank, revenue estimate and number of ratings. Apps scoring under 30 are dropped.
- **Weakness:** rating gap below 4.7, months since the last update, ad-supported.
- **Open field:** fewer strong rivals (4.5★+, 10K+ ratings) in the category's top-50 grossing.
- **Buildable:** categories needing network effects, licensed content, inventory or regulation are penalised (social, dating, music, shopping, finance, medical, games…). So are big-tech and large publishers. Both are hidden by default and can be turned back on.
- **Pays:** in-app purchases > paid upfront > ads.

Each card lists **how to beat it**: unhappy users, a stale app, ad-heavy, hidden earner, few rivals, or a possible platform gap. **Analyze reviews** reads up to 500 recent reviews and adds complaint-based angles (pricing, ads, bugs, missing features, login friction).

Build a better alternative, not a copy: copying the name, icon, screenshots or UI risks rejection under App Store guidelines 4.1 and 4.3 and Google Play's impersonation policy.

### Full app catalog: AppGoblin import (automatic)

On first `npm start`, the server downloads AppGoblin's free public dataset from GitHub (~120 MB, no account needed). That's 3.1M live apps; it keeps the **~1.08M with traction** (10+ ratings or 1K+ installs). Expect about 1–2 minutes plus download time and ~310 MB on disk. You can also start it from the All apps tab, or with `npm run import:appgoblin`. Tune it with `IMPORT_MIN_RATINGS` / `IMPORT_MIN_INSTALLS`, or skip it with `AUTO_IMPORT=0`. The dataset is a mid-2026 snapshot, so newer apps come from live search and the crawls.

### Bigger optional catalog (~5M apps, needs a free AppGoblin account)

No store API lists every app (Apple search caps at ~200 results, Play at 250), so the "All apps" view is backed by a local SQLite catalog:

1. Make a free account at https://appgoblin.info/free-app-datasets and download the **App Metrics** file (`appgoblin_store-apps-metrics_<date>.tsv.xz`, ~90 MB).
2. Run `npm run import:appgoblin -- ~/Downloads/appgoblin_store-apps-metrics_<date>.tsv.xz`. That's about 1–2 minutes for 5M rows (300K rows imported in 4s in testing).
3. Every app you open, search or see in a chart is also added to the catalog automatically.

Licence: CC BY 4.0. Credit appgoblin.info if you publish anything built on it. Name search uses `LIKE`, so on the full 5M rows a name search takes a few seconds; filters on category, installs and ratings are indexed and fast.

### Instagram posts and reels (free, official)

Meta's Business Discovery API returns followers, recent posts and reels, likes, comments and views for any **business or creator** account. Personal and age-gated accounts return nothing.

1. Convert your own Instagram account to a professional account and link it to a Facebook Page.
2. In your Meta app, add the Instagram product. Generate a token with `instagram_basic` and `pages_show_list`.
3. Get your IG user id: `GET /me/accounts?fields=instagram_business_account`.
4. Start with `IG_USER_ID=... IG_TOKEN=... npm start` (`META_TOKEN` is used if `IG_TOKEN` is unset).

TikTok has no comparable free API (its Research API is for academics), so TikTok shows links only.

### Verified revenue: TrustMRR

- **Without a key:** the free 50-startup feed.
- **With a key:** set `TRUSTMRR_API_KEY` (create it in TrustMRR's developer dashboard, under their API acceptable-use policy). The server then syncs **every** startup into SQLite in the background, once a day, staying under their 10 requests/min limit. A "Sync now" button is in the Verified MRR tab.

TrustMRR's terms forbid scraping their website, so the app uses only their feed and their API.

### Daily snapshots

The server snapshots tracked apps every 12 hours while it runs. For a box that isn't always on, add a cron job:

```
15 3 * * *  cd /path/to/app-intel && node scripts/snapshot.js >> data/snapshot.log 2>&1
```

## Apps / SaaS mode

The switch at the top of the sidebar flips between **Apps** (the store intelligence above, plus **App ideas** from the daily apps scan) and **SaaS**:
- **Worth cloning:** clone and gap verdicts, review-backed first, each with its customer complaints and source links.
- **Products:** all 1,661 SaaS products with filters, and a page per product (complaints, problems that name it, how its category splits, peers, socials and ads).
- **Problems:** 107 evidence-backed problem statements.
- **SaaS ideas:** the daily scan's opportunities. Score = (4·demand + 4·pain + 3·switch + 3·build + 2·recurring + 2·distribution + monetization + defensibility − 20) ÷ 80. The colour follows the gate verdict.
- **Categories:** 114 category notes plus the scan's researched categories.
- **Complaints** and **Avoid.**
- **Startups:** 1,680 YC- and VC-backed startups, with fit and play.
- **Shared with Apps mode:** Ad library, Brand lookup and Verified MRR.

The research lives in `data/idea-hunter/` (the `data/` folder of an Idea Hunter export: `saas_database/`, `saas_track/`, `apps_track/`, `startups/`, `reference/`). To update it, copy a newer export's files over these. The server picks up changes on the next request, with no restart.

## SaaS mode: the live catalog

SaaS mode is backed by a live catalog that the server builds and refreshes in the background, scored the same way as your SaaS scan:

| Source | What | Volume | Refresh |
|---|---|---|---|
| Shopify App Store | Rating, review count, star breakdown, pricing plans, launch date, category; 1★/2★/3★ and newest reviews | 29.5K apps listed | App pages ~1.5 s each: first full pass ≈ 12 h, then every 21 days; reviews monthly, most-reviewed first |
| WordPress.org plugins | Installs, stars, unresolved support threads; review feed | plugins with ≥2K installs (~5K; `WP_MIN_INSTALLS`) | weekly |
| Atlassian Marketplace | Paid apps: installs, average stars, review counts, written reviews | ~5.7K | weekly |
| TrustMRR | Verified MRR, growth | 50 free, all with `TRUSTMRR_API_KEY` | every 12 h |
| Y Combinator | Active software companies from the open yc-oss dataset: batch, team size, stage, tags | ~4.4K | every 3 days |
| Hacker News | Show HN launches with ≥80 points in the last 3 years | thousands | daily |

By default only general SaaS sources are shown and synced: your research, the Zapier app directory (~10K SaaS in ~90 categories), Y Combinator, TrustMRR, Show HN product launches (open-source repos excluded), Product Hunt and Atlassian. Shopify apps and WordPress plugins are platform add-ons, so they're off; add `shopify` and/or `wp` to `SAAS_SOURCES` in `.env` to bring them back (data already fetched is kept, just hidden).

Sources sync in four parallel lanes (Atlassian, WordPress, launches, Shopify). The Atlassian and WordPress list crawls save a checkpoint after every page, so a restart continues where it stopped.
| Product Hunt | Top launches, last 12 months | needs `PH_TOKEN` | daily |
| Your research | 1,661 products with verdicts and complaints | export | on change |

**Scoring** (`lib/saas/score.js`):
- Each product gets your eight SaaS pillars, derived from its signals. Demand comes from installs, reviews, MRR and votes. Pain comes from the 1–2★ share and complaints. Switch comes from fixable complaint themes. Build comes from how hard the category is. Recurring and monetization come from pricing and revenue. Distribution reflects marketplace presence.
- The score uses your formula.
- **Strong** requires every core pillar ≥3, monetization ≥3 and real evidence. Real evidence means 30+ ratings with a star breakdown, 10+ collected reviews, verified MRR, or a review-backed research verdict.
- Your research verdicts are respected: *watch* caps at validate, and *avoid* is always rejected.
- *Gap* plays are shown as add-ons, not clones.

**Sources tab:** shows each source's count, progress and last error, and has a *Sync now* button. G2, Capterra and Trustpilot are not scraped, because they block bots and their terms forbid it. Your research agents' findings from them come in through the export.

## If something goes wrong

`npm start` runs a small supervisor. If the server ever stops unexpectedly, it restarts it within seconds. Everything the server prints is also saved to `data/server.log`, so a crash leaves a record; send that file for diagnosis. `npm run serve` runs the server directly, without the supervisor.

## How the estimates work (`public/estimate.js`)

The order of preference, best signal first:

1. **Your own snapshots (observed).**
   - Android: the change in Google's install counter over N days. This is high confidence once you have 14+ days.
   - iOS: the change in rating count × downloads-per-rating.
2. **Android, no history yet.** The recent review rate (from the newest 150 reviews) × lifetime installs per written review. This is medium confidence.
3. **iOS, no history yet.** Apple's "ratings for current version" ÷ days since that version shipped, which gives a recent rating rate, × downloads-per-rating (default 40 / 80 / 160). If ratings weren't reset for the version, it falls back to lifetime ratings ÷ age. This is low confidence, because Apple publishes no install numbers.
4. **Revenue / MRR.** New payers = downloads × conversion (1% / 2.5% / 5%). Subscribers accumulate over the app's age with monthly churn (20% / 12% / 7%). MRR = subscribers × monthly price × (1 − store cut).
   - Price comes from the app's IAP list (iOS page scrape, or the Play IAP range). Anything above $20 is treated as a yearly plan.
   - Paid-upfront apps add downloads × price.
   - Play apps flagged as showing ads add DAU × ARPDAU.

All assumptions can be edited live in the UI (sidebar → *Estimate assumptions*). **Verified MRR** compares the estimates against TrustMRR's verified revenue for App Store apps, and can rescale the conversion rate to match.

## Data sources

| Source | Gives | Cost / limits |
|---|---|---|
| iTunes Search & Lookup API | iOS metadata, price, ratings, current-version ratings, developer site | Free, no key, about 20 requests per minute |
| App Store RSS (legacy JSON) `itunes.apple.com/{cc}/rss/top{free,paid,grossing}applications/limit=200/genre=…/json` | Top charts by country and genre | Free. Falls back to `rss.marketingtools.apple.com` v2 (top 50, no grossing, no genre) |
| App Store review RSS | Latest ~500 reviews | Free |
| apps.apple.com page | IAP price list | Scraped; breaks when Apple changes markup |
| [google-play-scraper](https://github.com/facundoolano/google-play-scraper) (MIT) | Play charts (free/paid/grossing), search, installs (`maxInstalls`), IAP range, ads flag, reviews, similar apps | Free. Unofficial and unmaintained; parsing breaks when Play changes |
| [Meta Ad Library API](https://www.facebook.com/ads/library/api/) | Ads, creative text, start dates, platforms, EU/UK reach | Free with ID check. Commercial ads only if delivered in the EU/UK. No spend data for commercial ads, so spend here is reach × frequency × CPM guesses |
| Google Ads Transparency / TikTok / LinkedIn ad libraries | Creatives | No free API: links only |
| Developer website HTML | Social profile links | Scraped |
| YouTube channel RSS | Latest videos and views | Free, no key |
| Bluesky public AppView | Latest posts and engagement | Free, no key |
| HN Algolia API | Mentions | Free, no key |
| Reddit `search.json` | Mentions | Best effort; often rate-limited without OAuth |
| TrustMRR `/api/ai/discovery` | 50 startups with verified MRR | Free public snapshot. Their terms ask you not to scrape the site itself |

**Worth adding later:**
- [AppGoblin free datasets](https://appgoblin.info/free-app-datasets): about 5M apps with installs and ratings, CC BY 4.0, needs a free account. Good for bulk discovery.
- [open-app-intel / AppScope](https://github.com/Ahad690/open-app-intel) (MIT, Python): same idea. It calibrates a Garg–Telang rank→downloads curve from pooled Android anchors.
- Apple Search Ads keyword popularity: needs an ASA account.

**Not available for free at all:** real revenue for apps that don't publish it, Meta spend for non-political ads, Instagram/TikTok/X post feeds, and panel usage data (Sensor Tower, data.ai).

## Layout

```
server.js            Express API + static UI
lib/ios.js           Apple endpoints
lib/android.js       google-play-scraper wrapper
lib/ads.js           Meta Ad Library
lib/socials.js       socials, YouTube, Bluesky, HN, Reddit
lib/trustmrr.js      verified MRR feed + keyed full sync
lib/instagram.js     Instagram Business Discovery
lib/db.js            SQLite catalog
scripts/import-appgoblin.js  bulk catalog import
lib/store.js         tracked apps + daily history (./data)
lib/mock.js          demo data
public/estimate.js   estimation engine (shared by browser + Node)
public/app.js        dashboard (vanilla JS, hash routes)
```

## Caveats

- Scrapers break. When Play or Apple changes markup, `google-play-scraper` or the IAP scrape returns errors. The UI shows the error and keeps the rest.
- Don't hammer the stores. Responses are cached (charts 3h, apps 6–12h). The first load of a Play chart fetches about 60 detail pages, 6 at a time.
- Respect each source's terms; scraping Play and App Store pages is a grey area for commercial use.


### One SaaS list, reviews and clone plans

- **Merged list.** All SaaS shows every product once. Rows from different sources with the same website (your research, Zapier, YC, TrustMRR, Show HN) are merged; the research row wins and the others add MRR, team size, Zapier tier and so on. The old Research DB page redirects here; its filters (research verdict, size, build time, has price, has revenue) are on All SaaS.
- **Negative reviews.** A background pass ("Store listings & reviews finder" on Sources) looks each product up on the App Store, Google Play, WordPress.org and the Shopify App Store, and accepts a listing only when its developer website is the product's own site. Matched listings add their ratings and critical reviews to the product; critical Hacker News comments are added too. Research products go first. The product page also has a "Find store listings & reviews now" button. G2, Capterra and Trustpilot are not used (their terms forbid scraping), so products with no app, plugin or HN discussion only have research complaints.
- **Clone plan.** Each product page shows the MVP feature checklist for its product family (~50 families), what to build later, what not to build, features its users ask for (pulled from reviews), the wedge (research play, top complaint themes, category opening) and a price anchor.
