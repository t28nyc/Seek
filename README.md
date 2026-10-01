# Seek — UK Pokémon TCG stock finder

Paste a product link from **any** shop and Seek keeps checking whether it's in stock. Shopify shops (most independent card shops) are read from Shopify's product JSON, which is exact; everything else goes through the HTML Stock Status Engine. The five built-in UK stores also get daily discovery and store-specific tuning.

Next.js (App Router) + Tailwind + Prisma/Postgres (Neon) + cheerio, built to run on Vercel's free (Hobby) plan.

## Pages

- **Online** (`/`) — everything Seek tracks, as compact rows. Each row shows **Price | RRP | vs RRP (£ and %)**. Filters: status chips with counts, "Added by me", shop chips, search; 50 rows at a time. Delete one row (×) or "Delete all"/"Delete these" (applies to the current filters; asks first). The "Websites Seek scans" panel shows each site's scan status and lets you remove a site.
- **In store** (`/in-store`) — releases only: Pokémon cards in high-street shops (supermarkets, Smyths, Argos, Happy Meals…) and upcoming set release days, grouped by month. Events, game nights and tournaments are left out. "+ Add a link" to add one by hand.
- **Product drops** (`/drops`) — pre-orders, restocks, new sets and deals from the web; upcoming release dates first, then newest posts by day. "+ Add a link" too.
- **Refresh** (header) — starts a background check of your links, every website and every feed; the page updates itself over the next minute.

Deleting hides items rather than erasing them, so scans and feeds don't add them straight back.

## Sources for drops and in-store

`lib/drops/feeds.ts` with the list in Settings → Sources — HotUKDeals (UK deals forum), Poké Tracker's UK news page (read as a page of headlines — any headline page works, not just RSS), PokeBeach, and **Bing News searches** (UK edition): general ones for pre-orders, restocks, new sets and UK rumours/leaks, plus one per high-street chain or group (Tesco, Smyths, TG Jones/WHSmith, Morrisons, Asda, Sainsbury's, Aldi/Lidl, Argos, B&M/Home Bargains/The Range, The Entertainer/GAME, supermarkets, McDonald's) for In store. Each page has a "Sources" panel showing what each source found last time.

## Prices

Read in this order, keeping the first believable (50p–£10,000) price in pounds: Shopify catalogue / product JSON (the default variant, not the cheapest) → the page's structured product data (the product matching the page, not related products; in-stock offer first) → `og:`/`product:` price meta tags (`property` or `name`) → Twitter price tags → `itemprop="price"` inside the main product area. "Was" prices only count from the main product area and if under 4× the price. Each listing stores where its price came from (hover the price), and prices far from the RRP (under 35% or over 4×) get a ⚠ so they can be checked.

## Languages

Each product is English, Japanese, Chinese or Other (Korean, European editions…), from its title and the shop's tags — e.g. "Japanese", "(CN)", "Simplified Chinese", "Gem Pack", "Korean", "(German)", or Japanese-only set names like Nihil Zero. Filter with the language chips on the Online page.

## Links added to Product drops / In store

`lib/drops/extract.ts` reads the page for: title, product image, price, status (**Product drop**, **Raffle**, **Pre-order**, **Coming soon**, In stock, Sold out), the expected/drop date ("Expected 06/11/2026", "Release date: 14th November", "Ballot closes 3rd Nov", "Dispatches from 7 November"…), the link to enter the drop, and purchase limits ("limited to only purchasing 1"). Added links are re-read every 3 hours (and on Refresh) as drops get closer.

Deleted items can be brought back with **Restore**; In store shows how many items its word filter hides, with a link to show them. The Sources panel shows where each source's posts went (in store / drops / deleted).

## RRP

Worked out automatically, best source first: set by you → "RRP £x" (or MSRP / recommended retail price) printed on any shop's page or Shopify description for that product → the Pokémon Center UK price → the **RRP table** on the Settings page (matched on the product name) → the most common "was" price across shops. Tap the RRP on any row to set your own; it applies to that product at every shop. Every row shows Price | RRP | vs RRP (£ and %).

## Settings (`/settings`, gear icon — tabs: RRP table, Sources, Checking & keywords, Shops)

- **RRP table** — add, edit, remove, turn off and reorder rows (first matching row wins), with a "try a product name" tester and reset to defaults.
- **Drop & in-store sources** — add an RSS link or just search words (becomes a web search), choose which page it feeds, turn off, remove, reorder.
- **Checking & keywords** — check intervals, priority keywords (Pokémon, product types and set names by default), words that leave products out of website scans, words that hide items from In store (it shows releases only), how long drops are kept, whether the RRP table applies to Japanese products.
- **Websites** — the sites being scanned.

Stored in the `Setting`, `RrpRule` and `FeedSource` tables; defaults in `lib/settings.ts`.

## UK only

- **Shops**: `.uk` domains and known UK retailers pass. Any other shop must prove it's a UK business — Shopify's own shop country (`/meta.json`), or a UK postcode / company number / "United Kingdom" on its homepage — and price in pounds. US shops that show £ to UK visitors fail. Shops from the starter list (taken from UK buying guides) are trusted unless shown to be non-UK; shops found on the web must prove it. Non-UK shops are marked "Not UK" and their products hidden.
- **Pasted product links** from unknown shops get the same check; Pokémon Center links must be the `/en-gb/` store.
- **Drop and in-store posts** (`isUkPost` in `lib/uk.ts`): UK sources (HotUKDeals, Poké Tracker, `.uk` sites) are always kept. Anything else is dropped if it mentions US/other-country shops or $/€ prices without mentioning the UK, and — with "Only keep web news that's clearly about the UK" on (default) — must mention the UK, £ or a UK high-street shop, or come from a UK publisher.
- **Prices** are only ever taken in pounds: structured data or meta tags priced in another currency are ignored.

## Shops Seek polls (Settings → Shops)

A starter list of ~40 UK shops from UK buying guides, plus shops found on the web (links in UK "where to buy" articles, searched weekly or with **Find more UK shops**), plus shops you add. Each new shop is checked before polling: UK pricing, then the best way to read it — Shopify catalogue, its Pokémon category pages, or its sitemap. The table shows status (Polling / Paused / Checking / Not UK / Can't read), products found, how many are in stock, and lets you pause, re-check or remove each one (`lib/scraper/shops.ts`, `/api/shops`, `/api/cron/shops`).

Seek respects each site's **robots.txt** (`lib/robots.ts`) and never fetches pages a site asks bots not to read. Marketplaces (Amazon, eBay) aren't polled.

## Adding a whole website

Paste any of these into the box on the Online page:

- **A homepage** — Shopify shops: the whole catalogue from `/products.json`, rescanned every ~30 minutes. Other sites: Pokémon product URLs from the sitemap (up to 400), re-read daily.
- **A Shopify collection** (e.g. `/collections/pokemon`) — just that collection.
- **Any other category page** — the Pokémon product links on it (following "next page" links), re-read daily.

Singles, accessories, merch and event tickets are filtered out (word list on the Settings page).

## Scheduled jobs

The GitHub workflow calls three endpoints every 5 minutes; each decides for itself whether work is due:

| Endpoint | Does |
|---|---|
| `/api/cron/scrape` | Checks tracked product pages that are due |
| `/api/cron/scan` | Scans shop catalogues that are due |
| `/api/cron/drops` | Reads drop/deal feeds (every 30 min) |
| `/api/cron/shops` | Checks newly added shops; finds more UK shops weekly |

## Directory structure

```
seek/
├── .github/workflows/scrape.yml   # free frequent scheduler → /api/cron/scrape every 5 min
├── prisma/schema.prisma           # Product, TrackedUrl, StockCheck, Drop
├── vercel.json                    # London region + two daily crons (Hobby limit)
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx               # dashboard (server component, reads DB directly)
    │   ├── globals.css
    │   └── api/
    │       ├── track/route.ts     # POST: paste a URL → validate, save, first check
    │       └── cron/
    │           ├── scrape/route.ts    # checks every URL that is due
    │           └── discover/route.ts  # daily: find new products + prune history
    ├── components/
    │   ├── listing-card.tsx  filter-bar.tsx  status-badge.tsx
    │   ├── drops-strip.tsx
    │   └── track-url-form.tsx     # the only client component
    └── lib/
        ├── db.ts                  # Prisma singleton
        ├── retailers.ts           # built-in store configs, any-URL validation (blocks private addresses)
        ├── categorize.ts          # set / product-type / language detection
        ├── products.ts            # groups the same item across retailers
        ├── format.ts  cron-auth.ts
        └── scraper/
            ├── fetch.ts           # timeouts, size cap, retries, block/queue detection
            ├── parse.ts           # Stock Status Engine (JSON-LD → selectors → text)
            ├── scrape.ts          # scrapeUrl(): never throws
            ├── run.ts             # batch runner: due rows, per-host throttle, leases, backoff
            └── discover.ts        # crawls category pages for new products
```

Why this shape: everything that touches a retailer lives in `lib/scraper`, everything store-specific lives in one config file (`lib/retailers.ts`), and the UI is server-rendered straight from Postgres — no client-side data fetching, no extra API surface.

## How a check works

1. A scheduler calls `GET /api/cron/scrape` with `Authorization: Bearer $CRON_SECRET`.
2. `runDueChecks()` loads up to 40 rows where `nextCheckAt <= now`, hot sets first.
3. Rows are grouped by host. Hosts run in parallel; each host is fetched one page at a time with a jittered gap.
4. Each row is leased (optimistic update on `nextCheckAt`) before fetching, so duplicate or overlapping cron runs never double-fetch.
5. `fetchHtml()` enforces an 8s timeout covering the body read, retries once on timeouts/5xx only, caps the response at 3MB, and classifies challenge pages and waiting rooms.
6. `parseProductPage()` collects weighted signals and resolves a status. Ties go to the more cautious status.
7. `applyResult()` updates the row. **A failed fetch never overwrites the last known status** — it bumps `failCount` and backs off (30m → 6h).
8. History rows are written only when status or price changes, or a check fails.
9. Work stops at a 40s budget; anything left is picked up next run.

Statuses: `IN_STOCK`, `QUEUE` (waiting room live — a drop is happening), `PREORDER`, `COMING_SOON`, `OUT_OF_STOCK`, `UNKNOWN`.

## Setup

Runs on Vercel + Neon (added from Vercel → Storage), with no other services.

1. Vercel → Storage → add a Neon database to the project. This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
2. Vercel → Settings → Environment Variables → add `CRON_SECRET` (optional: `SCRAPER_USER_AGENT`).
3. Deploy. The build runs `prisma db push`, which creates/updates the tables automatically.
4. GitHub → Settings → Secrets and variables → Actions → add `SEEK_URL` (your Vercel URL; the older name `PEEK_URL` also works) and `CRON_SECRET`.

Local development: `npm install`, copy the database variables into `.env` (see `.env.example`), `npm run dev`.

Drops/allocation links are curated by hand: add rows to the `Drop` table from Vercel → Storage → your Neon database → open in Neon console (or build a small admin page later).

## Scheduling on the free tier

Vercel Hobby only allows each cron to run **once per day**, and fires it at some point within the scheduled hour. Faster schedules fail the deploy. So:

- `vercel.json` keeps two daily crons: discovery (04:30 UTC) and a scrape safety-net run (07:00 UTC).
- The frequent scrape trigger is external: `.github/workflows/scrape.yml` (every 5 min, GitHub's minimum) or a free service like cron-job.org (can go down to every few minutes). Both just send the same authorised GET.
- Polling frequency per URL is adaptive (`nextDelayMs` in `run.ts`), so a busy schedule doesn't mean every page is fetched every time.

## Before going live — things to fill in

- `selectors` in `lib/retailers.ts` are empty: the generic engine handles most shops. If a shop's stock or price comes back wrong, add selectors for it there.
- `EXPANSIONS` in `lib/categorize.ts` is a starting list. Add new sets as they are announced.
- The site has no accounts. Set `SITE_PASSWORD` in Vercel to password-protect it (any username; `/api/cron/*` keeps using `CRON_SECRET`), especially before sharing the link — otherwise anyone with the address can delete items or change settings.
- Alerts: `checkOne()` in `run.ts` has a marked hook for "went in stock" notifications (Discord webhook, email, web push).

## Being a good citizen with retailer sites

Read each retailer's terms and robots.txt before scraping them. This code is built to be polite and to fail gracefully, not to defeat bot protection:

- One request at a time per store, with jittered gaps; low default frequencies.
- Honest User-Agent with a contact URL; en-GB headers.
- Respects `429`/`Retry-After`; never retries a block; exponential backoff after failures.
- Challenge pages are detected and recorded as "can't reach store", never as "out of stock".
- `regions: ["lhr1"]` runs functions in London, so stores see a UK request and serve UK stock/prices.

Some stores (notably Pokémon Center) use enterprise bot protection and will often refuse datacenter IPs, including Vercel's. Expect those listings to show "can't reach store" much of the time; the `QUEUE` detection still catches drops when a waiting room appears. Where a retailer offers an official feed, an affiliate product API, or stock-alert emails, prefer those over scraping.
