import type { StockStatus } from '@prisma/client';
import type { RetailerConfig } from '../retailers';
import { fetchHtml, FetchFailure, type FetchFailureKind } from './fetch';
import { findRrpPence, parseProductPage, plausiblePrice, type PriceSource, type Signal } from './parse';

export type ScrapeResult = {
  /** QUEUE / parsed status on success; UNKNOWN when the fetch failed. */
  status: StockStatus;
  ok: boolean;
  title?: string;
  imageUrl?: string;
  pricePence?: number;
  wasPricePence?: number;
  rrpPence?: number;
  priceSource?: PriceSource;
  httpStatus?: number;
  durationMs: number;
  error?: string;
  failure?: FetchFailureKind;
  retryAfterSec?: number;
  signals?: Signal[];
};

/**
 * Fetch one product page and extract title, price and stock status.
 * Never throws: every failure comes back as { ok: false, failure, error }
 * so a single bad page can't take down a cron batch.
 */
type ShopifyVariant = { id: number; available: boolean; price: number; compare_at_price: number | null };
type ShopifyProduct = {
  title?: string;
  available?: boolean;
  price?: number; // pence
  compare_at_price?: number | null;
  featured_image?: string;
  description?: string;
  variants?: ShopifyVariant[];
};

/**
 * Many independent UK card shops run on Shopify, which publishes every product
 * as JSON at /products/<handle>.js with an exact `available` flag and prices in
 * pence. That's far more reliable than reading buttons, so try it first for any
 * /products/ URL. Returns undefined (fall back to HTML) if the shop isn't Shopify.
 */
async function tryShopify(url: string, timeoutMs: number): Promise<ScrapeResult | undefined> {
  const u = new URL(url);
  if (!/\/products\/[^/]+$/.test(u.pathname)) return undefined;
  const started = Date.now();
  try {
    const res = await fetchHtml(`${u.origin}${u.pathname}.js`, { timeoutMs, retries: 0 });
    const data = JSON.parse(res.html) as ShopifyProduct;
    if (typeof data?.available !== 'boolean') return undefined;

    // The variant in the link, else the default one Shopify shows first (in stock if possible).
    // (data.price is the *cheapest* variant, which can be a different item, e.g. a single pack vs a box.)
    const variantId = u.searchParams.get('variant');
    const variants = data.variants ?? [];
    const variant = variantId
      ? variants.find((v) => String(v.id) === variantId)
      : (variants.find((v) => v.available) ?? variants[0]);
    const available = variantId && variant ? variant.available : data.available;
    const price = variant?.price ?? data.price;
    const compare = variant?.compare_at_price ?? data.compare_at_price;
    const status: StockStatus = !available ? 'OUT_OF_STOCK' : /pre-?order/i.test(data.title ?? '') ? 'PREORDER' : 'IN_STOCK';

    return {
      status,
      ok: true,
      title: data.title,
      imageUrl: data.featured_image?.startsWith('//') ? `https:${data.featured_image}` : data.featured_image,
      pricePence: Number.isInteger(price) ? plausiblePrice(price) : undefined,
      priceSource: 'product data' as const,
      wasPricePence: compare && price && compare > price ? compare : undefined,
      rrpPence: findRrpPence(data.description?.replace(/<[^>]+>/g, ' ')),
      httpStatus: res.httpStatus,
      durationMs: Date.now() - started,
      signals: [{ status, source: 'shopify', weight: 4 }],
    };
  } catch {
    return undefined;
  }
}

export async function scrapeUrl(
  url: string,
  cfg: Pick<RetailerConfig, 'selectors'>,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<ScrapeResult> {
  const started = Date.now();
  const shopify = await tryShopify(url, Math.min(opts.timeoutMs ?? 8_000, 6_000));
  if (shopify) return shopify;
  try {
    const page = await fetchHtml(url, { timeoutMs: opts.timeoutMs ?? 8_000, retries: opts.retries ?? 1 });
    const parsed = parseProductPage(page.html, cfg, page.finalUrl);
    return { ...parsed, ok: true, httpStatus: page.httpStatus, durationMs: Date.now() - started };
  } catch (e) {
    const durationMs = Date.now() - started;
    if (e instanceof FetchFailure) {
      // A waiting room is a real, useful status — the drop is live.
      if (e.kind === 'queue') {
        return { status: 'QUEUE', ok: true, httpStatus: e.httpStatus, durationMs, failure: 'queue' };
      }
      return {
        status: 'UNKNOWN',
        ok: false,
        failure: e.kind,
        error: e.message,
        httpStatus: e.httpStatus,
        retryAfterSec: e.retryAfterSec,
        durationMs,
      };
    }
    return { status: 'UNKNOWN', ok: false, failure: 'network', error: String(e), durationMs };
  }
}
