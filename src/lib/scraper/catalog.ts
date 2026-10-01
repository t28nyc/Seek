/**
 * Website scanner: finds every Pokémon TCG product a shop sells.
 *
 * - Shopify shops (most independent UK card shops) publish their whole
 *   catalogue as JSON at /products.json — 250 products per request, with
 *   stock and prices included. One scan refreshes hundreds of products in a
 *   few requests. Event tickets (pre-release events, tournaments) found there
 *   go to the In Store page.
 * - Any other site: product URLs are read from its sitemap.xml and filtered
 *   to Pokémon TCG products; each is then checked like a pasted link.
 */
import * as cheerio from 'cheerio';
import type { Prisma, StockStatus, TrackedUrl } from '@prisma/client';
import { prisma } from '../db';
import { getStoreConfig, storeNameFromHost } from '../retailers';
import { categorize } from '../categorize';
import { linkProducts } from '../products';
import { fetchHtml } from './fetch';
import { parsePricePence } from './parse';
import { findAnyDate } from '../dates';

const MIN = 60_000;
const PAGE_SIZE = 250;
const MAX_PAGES = 40;
const RESCAN_EVERY = 30 * MIN; // Shopify catalogues
const SITEMAP_RESCAN_EVERY = 24 * 60 * MIN; // sitemaps: new products appear slowly
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** UK Shopify card shops scanned out of the box. Users add more by pasting a shop's homepage. */
export const SEED_SHOPS = [
  { host: 'www.gumgumgames.co.uk', name: 'Gum Gum Games' },
  { host: 'www.totalcards.net', name: 'Total Cards' },
];

type ShopifyVariant = { id: number; available?: boolean; price: string; compare_at_price: string | null };
type ShopifyProduct = {
  title: string;
  handle: string;
  product_type?: string;
  vendor?: string;
  tags?: string[] | string;
  images?: { src: string }[];
  variants?: ShopifyVariant[];
  body_html?: string;
};

const SINGLE_CARD = /\b\d{1,3}\s?\/\s?\d{1,3}\b|\b(single|graded|psa|cgc|bgs)\b/i;
const NOT_SEALED =
  /\b(event|ticket|tournament|league|sleeves|binder|playmat|deck ?box|toploader|portfolio|plush|figure|t-shirt|hoodie|mug|keyring|poster)\b/i;

/** Pokémon TCG sealed product? (packs, boxes, ETBs, tins, collections…) — excludes singles and merch. */
export function isPokemonSealed(p: ShopifyProduct): boolean {
  const tags = Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags ?? '');
  if (!/pok[eé]mon/i.test(`${p.title} ${p.product_type} ${p.vendor} ${tags}`)) return false;
  if (SINGLE_CARD.test(`${p.title} ${p.product_type}`)) return false;
  if (NOT_SEALED.test(`${p.title} ${p.product_type}`)) return false;
  return categorize(p.title).type !== 'OTHER' || /\b(tcg|trading card|card game)\b/i.test(p.title);
}

const EVENT = /\b(pre-?release|event|tournament|league|league cup|challenge|championships?|launch party|play ?day)\b/i;

/** In-store Pokémon TCG event ticket (pre-release, league, tournament…). */
export function isPokemonEvent(p: ShopifyProduct): boolean {
  const tags = Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags ?? '');
  if (!/pok[eé]mon/i.test(`${p.title} ${p.product_type} ${tags}`)) return false;
  return EVENT.test(`${p.title} ${p.product_type}`);
}

const stripHtml = (html?: string) => (html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Save in-store events from a catalogue page to the In Store page. */
async function saveEvents(shopName: string, host: string, products: ShopifyProduct[]) {
  const events = products.filter(isPokemonEvent);
  if (!events.length) return 0;
  const { count } = await prisma.dropItem.createMany({
    data: events.map((p) => {
      const body = stripHtml(p.body_html);
      return {
        url: `https://${host}/products/${p.handle}`,
        title: p.title.slice(0, 300),
        kind: 'in-store',
        source: shopName,
        summary: body.slice(0, 300) || null,
        imageUrl: p.images?.[0]?.src,
        releaseDate: findAnyDate(`${p.title} ${body}`),
        publishedAt: new Date(),
      };
    }),
    skipDuplicates: true,
  });
  return count;
}

type ScannedItem = {
  url: string;
  title: string;
  status: StockStatus;
  pricePence?: number;
  wasPricePence?: number;
  imageUrl?: string;
};

function toItem(host: string, p: ShopifyProduct): ScannedItem {
  const variants = p.variants ?? [];
  const inStock = variants.filter((v) => v.available !== false && v.available !== undefined);
  const pick = (inStock.length ? inStock : variants)
    .map((v) => ({ price: parsePricePence(v.price), was: parsePricePence(v.compare_at_price ?? undefined) }))
    .filter((v) => v.price)
    .sort((a, b) => a.price! - b.price!)[0];
  const tags = Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags ?? '');
  const status: StockStatus = !inStock.length
    ? 'OUT_OF_STOCK'
    : /pre-?order/i.test(`${p.title} ${tags}`)
      ? 'PREORDER'
      : 'IN_STOCK';
  return {
    url: `https://${host}/products/${p.handle}`,
    title: p.title,
    status,
    pricePence: pick?.price,
    wasPricePence: pick?.was && pick.price && pick.was > pick.price ? pick.was : undefined,
    imageUrl: p.images?.[0]?.src,
  };
}

/** Is this host a Shopify shop with a readable catalogue? Returns its first page if so. */
export async function probeShopify(host: string): Promise<ShopifyProduct[] | null> {
  try {
    const { html } = await fetchHtml(`https://${host}/products.json?limit=${PAGE_SIZE}&page=1`, {
      timeoutMs: 10_000,
      retries: 0,
    });
    const data = JSON.parse(html) as { products?: ShopifyProduct[] };
    return Array.isArray(data.products) ? data.products : null;
  } catch {
    return null;
  }
}

/** Save one page of scanned items: insert new ones, update changed ones. */
async function saveItems(items: ScannedItem[]) {
  if (!items.length) return { added: 0, changed: 0 };
  const now = new Date();
  const later = new Date(now.getTime() + 24 * 60 * MIN); // the scan keeps these fresh, not the per-page poller

  const existing = await prisma.trackedUrl.findMany({ where: { url: { in: items.map((i) => i.url) } } });
  const byUrl = new Map<string, TrackedUrl>(existing.map((e) => [e.url, e]));

  const fresh = items.filter((i) => !byUrl.has(i.url));
  let added = 0;
  if (fresh.length) {
    const products = await linkProducts(fresh.map((f) => f.title));
    const res = await prisma.trackedUrl.createMany({
      data: fresh.map((f) => {
        const product = products.get(f.title);
        return {
          url: f.url,
          retailer: getStoreConfig(f.url).key,
          source: 'CATALOG' as const,
          title: f.title,
          imageUrl: f.imageUrl,
          productId: product?.id,
          priority: product?.hot ? 1 : 0,
          status: f.status,
          pricePence: f.pricePence,
          wasPricePence: f.wasPricePence,
          onSale: !!f.wasPricePence,
          lastCheckedAt: now,
          lastChangedAt: now,
          lastInStockAt: f.status === 'IN_STOCK' ? now : null,
          nextCheckAt: later,
        };
      }),
      skipDuplicates: true,
    });
    added = res.count;
  }

  const writes: Prisma.PrismaPromise<unknown>[] = [];
  const unchanged: string[] = [];
  const unchangedCatalog: string[] = [];
  for (const item of items) {
    const e = byUrl.get(item.url);
    if (!e) continue;
    const priceChanged = item.pricePence !== undefined && item.pricePence !== e.pricePence;
    if (item.status === e.status && !priceChanged) {
      (e.source === 'CATALOG' ? unchangedCatalog : unchanged).push(e.id);
      continue;
    }
    writes.push(
      prisma.trackedUrl.update({
        where: { id: e.id },
        data: {
          status: item.status,
          pricePence: item.pricePence ?? e.pricePence,
          wasPricePence: item.wasPricePence ?? null,
          onSale: !!item.wasPricePence,
          lastCheckedAt: now,
          failCount: 0,
          lastError: null,
          ...(item.status !== e.status && { lastChangedAt: now }),
          ...(item.status === 'IN_STOCK' && { lastInStockAt: now }),
          // The scan keeps catalogue finds fresh; the per-page poller handles links you added.
          ...(e.source === 'CATALOG' && { nextCheckAt: later }),
        },
      }),
      prisma.stockCheck.create({ data: { trackedUrlId: e.id, status: item.status, pricePence: item.pricePence } }),
    );
  }
  for (let i = 0; i < writes.length; i += 50) await prisma.$transaction(writes.slice(i, i + 50));
  if (unchanged.length) {
    await prisma.trackedUrl.updateMany({ where: { id: { in: unchanged } }, data: { lastCheckedAt: now } });
  }
  if (unchangedCatalog.length) {
    await prisma.trackedUrl.updateMany({
      where: { id: { in: unchangedCatalog } },
      data: { lastCheckedAt: now, nextCheckAt: later },
    });
  }
  return { added, changed: writes.length / 2 };
}

/**
 * Scan one shop for up to `budgetMs`, resuming from where the last run
 * stopped. A full pass ends when a page comes back short or empty.
 */
type ShopRow = { id: string; host: string; name: string; platform: string; scanPage: number };

async function scanShop(shop: ShopRow, deadline: number) {
  return shop.platform === 'sitemap' ? scanSitemapShop(shop, deadline) : scanShopifyShop(shop, deadline);
}

async function scanShopifyShop(shop: ShopRow, deadline: number) {
  let page = shop.scanPage;
  let found = 0;
  let added = 0;
  let changed = 0;
  let finished = false;
  let error: string | undefined;

  while (Date.now() < deadline) {
    try {
      const { html } = await fetchHtml(`https://${shop.host}/products.json?limit=${PAGE_SIZE}&page=${page}`, {
        timeoutMs: 10_000,
        retries: 1,
      });
      const products = (JSON.parse(html) as { products?: ShopifyProduct[] }).products ?? [];
      await saveEvents(shop.name, shop.host, products);
      const items = products.filter(isPokemonSealed).map((p) => toItem(shop.host, p));
      found += items.length;
      const saved = await saveItems(items);
      added += saved.added;
      changed += saved.changed;
      if (products.length < PAGE_SIZE || page >= MAX_PAGES) {
        finished = true;
        break;
      }
      page++;
      await sleep(1_500); // politeness gap between pages
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      break;
    }
  }

  const now = Date.now();
  await prisma.shop.update({
    where: { id: shop.id },
    data: finished
      ? {
          scanPage: 1,
          lastScannedAt: new Date(now),
          nextScanAt: new Date(now + RESCAN_EVERY),
          lastError: null,
          productsFound: found,
        }
      : error
        ? { lastError: error.slice(0, 300), nextScanAt: new Date(now + RESCAN_EVERY) }
        : { scanPage: page }, // out of time: carry on from this page next run
  });
  return { host: shop.host, found, added, changed, finished, error };
}

// ---------- Sitemap scanning (any website) ----------

const SKIP_SITEMAP = /(blog|post|page|categor|collection|tag|author|image|video|brand|news|article)/i;
const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, '');

/** Does this URL's path look like a Pokémon TCG sealed product? (Sitemaps give URLs, not titles.) */
export function looksLikePokemonProductUrl(loc: string, host: string): boolean {
  let u: URL;
  try {
    u = new URL(loc);
  } catch {
    return false;
  }
  if (bareHost(u.hostname) !== bareHost(host)) return false;
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep raw */
  }
  const text = path.replace(/[-_/.+]/g, ' ');
  const c = categorize(text);
  if (!/pok[eé]mon/i.test(text) && !c.expansion) return false;
  if (/\b\d{1,3} \d{3}\b/.test(text) || /\b(single|singles|graded|psa|cgc)\b/i.test(text)) return false; // single cards
  if (NOT_SEALED.test(text)) return false;
  return c.type !== 'OTHER' || /\b(tcg|trading cards?)\b/i.test(text);
}

/** Read robots.txt → sitemaps (and sitemap indexes) → product URLs. */
export async function sitemapProductUrls(host: string, deadline: number, max = 400): Promise<string[]> {
  const roots: string[] = [];
  try {
    const { html } = await fetchHtml(`https://${host}/robots.txt`, { timeoutMs: 6_000, retries: 0 });
    for (const m of html.matchAll(/^\s*sitemap:\s*(\S+)/gim)) roots.push(m[1]);
  } catch {
    /* no robots.txt */
  }
  if (!roots.length) roots.push(`https://${host}/sitemap.xml`, `https://${host}/sitemap_index.xml`);

  const queue = [...roots];
  const seen = new Set<string>();
  const found = new Set<string>();
  while (queue.length && seen.size < 20 && found.size < max && Date.now() < deadline) {
    const sm = queue.shift()!;
    if (seen.has(sm) || sm.endsWith('.gz')) continue;
    seen.add(sm);
    let xml: string;
    try {
      xml = (await fetchHtml(sm, { timeoutMs: 10_000, retries: 0 })).html;
    } catch {
      continue;
    }
    const $ = cheerio.load(xml, { xml: true });
    $('sitemap > loc').each((_, el) => {
      const loc = $(el).text().trim();
      if (!loc) return;
      if (/product/i.test(loc)) queue.unshift(loc); // product sitemaps first
      else if (!SKIP_SITEMAP.test(loc)) queue.push(loc);
    });
    $('url > loc').each((_, el) => {
      const loc = $(el).text().trim();
      if (found.size < max && looksLikePokemonProductUrl(loc, host)) found.add(loc.split('#')[0]);
    });
  }
  return [...found];
}

/** Queue sitemap finds for checking, spread over the next 30 minutes so a site isn't hit all at once. */
async function saveSitemapUrls(urls: string[]) {
  if (!urls.length) return 0;
  const now = Date.now();
  const { count } = await prisma.trackedUrl.createMany({
    data: urls.map((url) => ({
      url,
      retailer: getStoreConfig(url).key,
      source: 'CATALOG' as const,
      nextCheckAt: new Date(now + Math.random() * 30 * MIN),
    })),
    skipDuplicates: true,
  });
  return count;
}

async function scanSitemapShop(shop: ShopRow, deadline: number) {
  const urls = await sitemapProductUrls(shop.host, deadline);
  const added = await saveSitemapUrls(urls);
  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      lastScannedAt: new Date(),
      nextScanAt: new Date(Date.now() + SITEMAP_RESCAN_EVERY),
      productsFound: urls.length,
      lastError: urls.length ? null : 'No Pokémon product links found in the sitemap',
    },
  });
  return { host: shop.host, found: urls.length, added, changed: 0, finished: true, error: undefined as string | undefined };
}


/** Scan every shop that is due, in parallel, within the time budget. */
export async function runDueScans(budgetMs = 45_000) {
  const deadline = Date.now() + budgetMs;
  await prisma.shop.createMany({ data: SEED_SHOPS, skipDuplicates: true });
  const due = await prisma.shop.findMany({
    where: { enabled: true, nextScanAt: { lte: new Date() } },
    orderBy: { nextScanAt: 'asc' },
    take: 6,
  });
  return Promise.all(due.map((shop) => scanShop(shop, deadline)));
}

/**
 * Add a website (from a pasted homepage): a Shopify shop is scanned through
 * its catalogue JSON; any other site through its sitemap. Returns null if
 * neither finds anything readable.
 */
export async function addShop(host: string) {
  const firstPage = await probeShopify(host);
  if (firstPage) {
    const shop = await prisma.shop.upsert({
      where: { host },
      update: { enabled: true, platform: 'shopify', nextScanAt: new Date(), scanPage: 1 },
      create: { host, name: storeNameFromHost(host), platform: 'shopify' },
    });
    return { shop, platform: 'shopify' as const };
  }

  const urls = await sitemapProductUrls(host, Date.now() + 25_000);
  if (!urls.length) return null;
  const shop = await prisma.shop.upsert({
    where: { host },
    update: { enabled: true, platform: 'sitemap' },
    create: { host, name: storeNameFromHost(host), platform: 'sitemap' },
  });
  await saveSitemapUrls(urls);
  await prisma.shop.update({
    where: { id: shop.id },
    data: { lastScannedAt: new Date(), nextScanAt: new Date(Date.now() + SITEMAP_RESCAN_EVERY), productsFound: urls.length },
  });
  return { shop, platform: 'sitemap' as const, found: urls.length };
}

export { scanShop };
