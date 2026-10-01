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
import { getStoreConfig, resolveStore, storeNameFromHost } from '../retailers';
import { categorize } from '../categorize';
import { linkProducts } from '../products';
import { fetchHtml } from './fetch';
import { parsePricePence } from './parse';
import { findRrpPence } from './parse';
import { DEFAULT_SETTINGS, getSettings, isPriorityTitle, matchesAny, splitList, type GeneralSettings } from '../settings';

const MIN = 60_000;
const PAGE_SIZE = 250;
const MAX_PAGES = 40;
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
// Settings used by the scanner (Settings page). Loaded at the start of each scan.
let scanSettings: GeneralSettings = DEFAULT_SETTINGS;
let excludePhrases = splitList(DEFAULT_SETTINGS.excludeFromScans);
async function loadScanSettings() {
  scanSettings = await getSettings();
  excludePhrases = splitList(scanSettings.excludeFromScans);
}
const notSealed = (text: string) => matchesAny(text, excludePhrases);
const rescanEvery = () => scanSettings.rescanShopsMin * MIN;

/**
 * Pokémon TCG sealed product? (packs, boxes, ETBs, tins, collections…) — excludes singles and merch.
 * `inPokemonCollection`: the product came from a Pokémon collection, so its title needn't say "Pokémon".
 */
export function isPokemonSealed(p: ShopifyProduct, inPokemonCollection = false): boolean {
  const tags = Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags ?? '');
  if (!inPokemonCollection && !/pok[eé]mon/i.test(`${p.title} ${p.product_type} ${p.vendor} ${tags}`)) return false;
  if (SINGLE_CARD.test(`${p.title} ${p.product_type}`)) return false;
  if (notSealed(`${p.title} ${p.product_type}`)) return false;
  return categorize(p.title).type !== 'OTHER' || /\b(tcg|trading card|card game)\b/i.test(p.title);
}

const stripHtml = (html?: string) => (html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

type ScannedItem = {
  url: string;
  title: string;
  status: StockStatus;
  pricePence?: number;
  wasPricePence?: number;
  rrpPence?: number;
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
    // Many shops write "RRP £54.99" in the product description
    rrpPence: findRrpPence(stripHtml(p.body_html)),
  };
}

/** Is this host a Shopify shop with a readable catalogue? Returns its first page if so. */
const catalogBase = (host: string, collection?: string | null) =>
  `https://${host}${collection ? `/collections/${encodeURIComponent(collection)}` : ''}/products.json`;

export async function probeShopify(host: string, collection?: string | null): Promise<ShopifyProduct[] | null> {
  try {
    const { html } = await fetchHtml(`${catalogBase(host, collection)}?limit=${PAGE_SIZE}&page=1`, {
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
          priority: product?.hot || isPriorityTitle(f.title, scanSettings) ? 1 : 0,
          rrpPence: f.rrpPence,
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
    const rrpFound = !!item.rrpPence && item.rrpPence !== e.rrpPence;
    if (item.status === e.status && !priceChanged && !rrpFound) {
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
          ...(item.rrpPence ? { rrpPence: item.rrpPence } : {}),
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
type ShopRow = { id: string; host: string; name: string; platform: string; scanPage: number; collection: string | null };

async function scanShop(shop: ShopRow, deadline: number) {
  if (shop.platform === 'sitemap') return scanSitemapShop(shop, deadline);
  if (shop.platform === 'listing') return scanListingShop(shop, deadline);
  return scanShopifyShop(shop, deadline);
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
      const { html } = await fetchHtml(`${catalogBase(shop.host, shop.collection)}?limit=${PAGE_SIZE}&page=${page}`, {
        timeoutMs: 10_000,
        retries: 1,
      });
      const products = (JSON.parse(html) as { products?: ShopifyProduct[] }).products ?? [];
      const pokemonCollection = !!shop.collection && /pok/i.test(shop.collection);
      const items = products.filter((p) => isPokemonSealed(p, pokemonCollection)).map((p) => toItem(shop.host, p));
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
          nextScanAt: new Date(now + rescanEvery()),
          lastError: null,
          productsFound: found,
        }
      : error
        ? { lastError: error.slice(0, 300), nextScanAt: new Date(now + rescanEvery()) }
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
  if (notSealed(text)) return false;
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

// ---------- Category/listing pages (any website) ----------

const NON_PRODUCT_PATH = /\/(category|categories|collections?|c|brands?|tags?|search|pages?|blog|news|account|cart|basket|login|wishlist)(\/|$)/i;

/** Anchor text that reads like a Pokémon TCG product title. */
function looksLikePokemonProductText(text: string, u: URL): boolean {
  if (text.length < 8 || text.length > 200 || NON_PRODUCT_PATH.test(u.pathname)) return false;
  const c = categorize(text);
  if (!/pok[eé]mon/i.test(text) && !c.expansion) return false;
  if (SINGLE_CARD.test(text) || notSealed(text)) return false;
  return c.type !== 'OTHER';
}

/**
 * Read a category page (e.g. a shop's "Pokémon" section) and collect links to
 * Pokémon products on it, following "next page" links up to `maxPages`.
 */
export async function crawlListingPage(startUrl: string, deadline: number, maxPages = 6, max = 400): Promise<string[]> {
  const host = new URL(startUrl).hostname;
  const found = new Set<string>();
  const seen = new Set<string>();
  let next: string | undefined = startUrl;

  while (next && seen.size < maxPages && found.size < max && Date.now() < deadline) {
    seen.add(next);
    let html: string;
    let finalUrl: string;
    try {
      ({ html, finalUrl } = await fetchHtml(next, { timeoutMs: 10_000, retries: 0 }));
    } catch {
      break;
    }
    const $ = cheerio.load(html);
    $('a[href]').each((_, a) => {
      let u: URL;
      try {
        u = new URL($(a).attr('href')!, finalUrl);
      } catch {
        return;
      }
      if (bareHost(u.hostname) !== bareHost(host)) return;
      const text = `${$(a).attr('title') ?? ''} ${$(a).text()}`.replace(/\s+/g, ' ').trim();
      if (!looksLikePokemonProductUrl(u.toString(), host) && !looksLikePokemonProductText(text, u)) return;
      const resolved = resolveStore(u.toString());
      if ('url' in resolved && resolved.url !== finalUrl && found.size < max) found.add(resolved.url);
    });
    const rel = $('link[rel="next"]').attr('href') || $('a[rel="next"]').attr('href');
    next = rel ? new URL(rel, finalUrl).toString() : undefined;
    if (next && seen.has(next)) next = undefined;
    if (next) await sleep(1_000);
  }
  return [...found];
}

async function scanListingShop(shop: ShopRow, deadline: number) {
  const urls = shop.collection ? await crawlListingPage(shop.collection, deadline) : [];
  const added = await saveFoundUrls(urls);
  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      lastScannedAt: new Date(),
      nextScanAt: new Date(Date.now() + SITEMAP_RESCAN_EVERY),
      productsFound: urls.length,
      lastError: urls.length ? null : 'No Pokémon product links found on that page',
    },
  });
  return { host: shop.host, found: urls.length, added, changed: 0, finished: true, error: undefined as string | undefined };
}

/** Queue found product links for checking, spread over the next 30 minutes so a site isn't hit all at once. */
export async function saveFoundUrls(urls: string[]) {
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
  const added = await saveFoundUrls(urls);
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
  await loadScanSettings();
  await prisma.shop.createMany({ data: SEED_SHOPS, skipDuplicates: true });
  const due = await prisma.shop.findMany({
    where: { enabled: true, nextScanAt: { lte: new Date() } },
    orderBy: { nextScanAt: 'asc' },
    take: 6,
  });
  return Promise.all(due.map((shop) => scanShop(shop, deadline)));
}

/**
 * Add a website from a pasted link: a homepage (whole shop) or a Shopify
 * collection page. Shopify shops are scanned through their catalogue JSON;
 * any other site through its sitemap. Returns null if nothing readable.
 */
export async function addShop(host: string, collection?: string) {
  await loadScanSettings();
  const existing = await prisma.shop.findUnique({ where: { host } });
  if (existing?.enabled && !existing.collection && existing.platform === 'shopify' && collection) {
    return { shop: existing, platform: 'shopify' as const, alreadyWhole: true };
  }

  const firstPage = await probeShopify(host, collection);
  if (firstPage) {
    const shop = await prisma.shop.upsert({
      where: { host },
      update: { enabled: true, platform: 'shopify', collection: collection ?? null, nextScanAt: new Date(), scanPage: 1, lastError: null },
      create: { host, name: storeNameFromHost(host), platform: 'shopify', collection: collection ?? null },
    });
    return { shop, platform: 'shopify' as const, alreadyWhole: false };
  }
  if (collection) return null; // looked like a Shopify collection but isn't readable

  const urls = await sitemapProductUrls(host, Date.now() + 25_000);
  if (!urls.length) return null;
  const shop = await prisma.shop.upsert({
    where: { host },
    update: { enabled: true, platform: 'sitemap', collection: null, lastError: null },
    create: { host, name: storeNameFromHost(host), platform: 'sitemap' },
  });
  await saveFoundUrls(urls);
  await prisma.shop.update({
    where: { id: shop.id },
    data: { lastScannedAt: new Date(), nextScanAt: new Date(Date.now() + SITEMAP_RESCAN_EVERY), productsFound: urls.length },
  });
  return { shop, platform: 'sitemap' as const, found: urls.length, alreadyWhole: false };
}

/** Add a category page (non-Shopify) as a source: collect its product links now and re-read it daily. */
export async function addListingPage(url: string, deadline: number) {
  await loadScanSettings();
  const urls = await crawlListingPage(url, deadline);
  if (urls.length < 2) return null;
  const host = new URL(url).hostname;
  const existing = await prisma.shop.findUnique({ where: { host } });
  const shop =
    existing?.enabled && !existing.collection
      ? existing // already scanning the whole site; just add these links
      : await prisma.shop.upsert({
          where: { host },
          update: { enabled: true, platform: 'listing', collection: url, lastError: null },
          create: { host, name: storeNameFromHost(host), platform: 'listing', collection: url },
        });
  await saveFoundUrls(urls);
  await prisma.shop.update({
    where: { id: shop.id },
    data: { lastScannedAt: new Date(), nextScanAt: new Date(Date.now() + SITEMAP_RESCAN_EVERY), productsFound: urls.length },
  });
  return { shop, found: urls.length };
}

export { scanShop };
