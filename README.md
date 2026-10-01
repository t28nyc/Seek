# Peek — Pokémon TCG stock finder

Paste a product link from **any** shop and Peek keeps checking whether it's in stock. Shopify shops (most independent card shops) are read from Shopify's product JSON, which is exact; everything else goes through the HTML Stock Status Engine. The five built-in UK stores also get daily discovery and store-specific tuning.

Next.js (App Router) + Tailwind + Prisma/Postgres (Neon) + cheerio, built to run on Vercel's free (Hobby) plan.

## Pages

- **Online** (`/`) — everything Peek tracks, as compact rows. Each row shows **Price | RRP | vs RRP (£ and %)**. Filters: status chips with counts, "Added by me", shop chips, search; 50 rows at a time. Delete one row (×) or "Delete all"/"Delete these" (applies to the current filters; asks first). The "Websites Peek scans" panel shows each site's scan status and lets you remove a site.
- **In store** (`/in-store`) — pre-release events and tournaments from scanned shops, news about Pokémon cards in high-street shops (supermarkets, Smyths, Argos, Happy Meals…), and upcoming set release days; grouped by month. "+ Add a link" to add one by hand.
- **Product drops** (`/drops`) — pre-orders, restocks, new sets and deals from the web; upcoming release dates first, then newest posts by day. "+ Add a link" too.
- **Refresh** (header) — starts a background check of your links, every website and every feed; the page updates itself over the next minute.

Deleting hides items rather than erasing them, so scans and feeds don't add them straight back.

## Sources for drops and in-store

`lib/drops/feeds.ts` — HotUKDeals (UK deals forum), PokeBeach (TCG news) and several **Bing News searches** (UK edition): Bing publishes any news search as RSS, which is how Peek searches the web without a paid API. Each page has a "Sources" panel showing what each source found last time.

## RRP

Worked out automatically, in this order: set by you → "RRP £x" printed on any shop's page for that product → the Pokémon Center UK price → the most common "was" price across shops. Otherwise a typical range for the product type is shown as a hint (`lib/rrp.ts`). Tap the RRP on any row to set your own; it applies to that product at every shop.

## Adding a whole website

Paste any of these into the box on the Online page:

- **A homepage** — Shopify shops: the whole catalogue from `/products.json`, rescanned every ~30 minutes. Other sites: Pokémon product URLs from the sitemap (up to 400), re-read daily.
- **A Shopify collection** (e.g. `/collections/pokemon`) — just that collection.
- **Any other category page** — the Pokémon product links on it (following "next page" links), re-read daily.

Singles, accessories and merch are filtered out; event tickets go to the In store page.

## Scheduled jobs

The GitHub workflow calls three endpoints every 5 minutes; each decides for itself whether work is due:

| Endpoint | Does |
|---|---|
| `/api/cron/scrape` | Checks tracked product pages that are due |
| `/api/cron/scan` | Scans shop catalogues that are due |
| `/api/cron/drops` | Reads drop/deal feeds (every 30 min) |

## Directory structure

```
peek/
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
4. GitHub → Settings → Secrets and variables → Actions → add `PEEK_URL` (your Vercel URL) and `CRON_SECRET`.

Local development: `npm install`, copy the database variables into `.env` (see `.env.example`), `npm run dev`.

Drops/allocation links are curated by hand: add rows to the `Drop` table from Vercel → Storage → your Neon database → open in Neon console (or build a small admin page later).

## Scheduling on the free tier

Vercel Hobby only allows each cron to run **once per day**, and fires it at some point within the scheduled hour. Faster schedules fail the deploy. So:

- `vercel.json` keeps two daily crons: discovery (04:30 UTC) and a scrape safety-net run (07:00 UTC).
- The frequent scrape trigger is external: `.github/workflows/scrape.yml` (every 5 min, GitHub's minimum) or a free service like cron-job.org (can go down to every few minutes). Both just send the same authorised GET.
- Polling frequency per URL is adaptive (`nextDelayMs` in `run.ts`), so a busy schedule doesn't mean every page is fetched every time.

## Before going live — things to fill in

- `discoveryUrls` and `selectors` in `lib/retailers.ts` are deliberately empty. Open each store's Pokémon TCG category page and a product page in DevTools, and add the category URLs and any selectors the generic engine gets wrong. Re-check whenever a store's results start coming back `UNKNOWN`.
- `EXPANSIONS` in `lib/categorize.ts` is a starting list. Add new sets as they are announced.
- `/api/track` is open to anyone who can reach the site. Before sharing publicly, add a rate limit (e.g. Upstash free tier) or put it behind sign-in.
- Alerts: `checkOne()` in `run.ts` has a marked hook for "went in stock" notifications (Discord webhook, email, web push).

## Being a good citizen with retailer sites

Read each retailer's terms and robots.txt before scraping them. This code is built to be polite and to fail gracefully, not to defeat bot protection:

- One request at a time per store, with jittered gaps; low default frequencies.
- Honest User-Agent with a contact URL; en-GB headers.
- Respects `429`/`Retry-After`; never retries a block; exponential backoff after failures.
- Challenge pages are detected and recorded as "can't reach store", never as "out of stock".
- `regions: ["lhr1"]` runs functions in London, so stores see a UK request and serve UK stock/prices.

Some stores (notably Pokémon Center) use enterprise bot protection and will often refuse datacenter IPs, including Vercel's. Expect those listings to show "can't reach store" much of the time; the `QUEUE` detection still catches drops when a waiting room appears. Where a retailer offers an official feed, an affiliate product API, or stock-alert emails, prefer those over scraping.
