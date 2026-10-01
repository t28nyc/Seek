/**
 * Shop catalogue scanner: finds every Pokémon TCG product a shop sells and
 * keeps its stock status up to date.
 *
 * Works for Shopify shops (most independent UK card shops), which publish
 * their whole catalogue as JSON at /products.json — 250 products per request,
 * with stock status and prices included. One scan therefore refreshes
 * hundreds of products in a few requests, far cheaper than visiting each page.
 */
import type { Prisma, StockStatus, TrackedUrl } from '@prisma/client';
import { prisma } from '../db';
import { getStoreConfig, storeNameFromHost } from '../retailers';
import { categorize } from '../categorize';
import { linkProducts } from '../products';
import { fetchHtml } from './fetch';
import { parsePricePence } from './parse';

const MIN = 60_000;
const PAGE_SIZE = 250;
const MAX_PAGES = 40;
const RESCAN_EVERY = 30 * MIN;
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
  for (const item of items) {
    const e = byUrl.get(item.url);
    if (!e) continue;
    const priceChanged = item.pricePence !== undefined && item.pricePence !== e.pricePence;
    if (item.status === e.status && !priceChanged) {
      unchanged.push(e.id);
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
        },
      }),
      prisma.stockCheck.create({ data: { trackedUrlId: e.id, status: item.status, pricePence: item.pricePence } }),
    );
  }
  for (let i = 0; i < writes.length; i += 50) await prisma.$transaction(writes.slice(i, i + 50));
  if (unchanged.length) {
    await prisma.trackedUrl.updateMany({ where: { id: { in: unchanged } }, data: { lastCheckedAt: now } });
  }
  return { added, changed: writes.length / 2 };
}

/**
 * Scan one shop for up to `budgetMs`, resuming from where the last run
 * stopped. A full pass ends when a page comes back short or empty.
 */
async function scanShop(shop: { id: string; host: string; scanPage: number }, deadline: number) {
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
      ? { scanPage: 1, lastScannedAt: new Date(now), nextScanAt: new Date(now + RESCAN_EVERY), lastError: null }
      : error
        ? { lastError: error.slice(0, 300), nextScanAt: new Date(now + RESCAN_EVERY) }
        : { scanPage: page }, // out of time: carry on from this page next run
  });
  return { host: shop.host, found, added, changed, finished, error };
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

/** Add a shop (from a pasted homepage) if it's a readable Shopify shop. */
export async function addShop(host: string) {
  const firstPage = await probeShopify(host);
  if (!firstPage) return null;
  const shop = await prisma.shop.upsert({
    where: { host },
    update: { enabled: true, nextScanAt: new Date(), scanPage: 1 },
    create: { host, name: storeNameFromHost(host) },
  });
  return { shop, pokemonOnFirstPage: firstPage.filter(isPokemonSealed).length };
}

export { scanShop };
