/**
 * Stock Status Engine.
 *
 * A page is read for several independent signals, each with a weight:
 *   3  schema.org JSON-LD  offers.availability   (structured, most reliable)
 *   2  retailer selectors  from lib/retailers.ts (precise, but break on redesigns)
 *   2  meta tags           product:availability / og:availability
 *   1  button/label text   "Add to basket", "Sold out", disabled buttons…
 * Weights are summed per status; on a tie the more cautious status wins, so a
 * confusing page never produces a false "in stock" alert.
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { StockStatus } from '@prisma/client';
import type { RetailerConfig } from '../retailers';

export type SignalSource = 'shopify' | 'json-ld' | 'selector' | 'meta' | 'text';
export type Signal = { status: StockStatus; source: SignalSource; weight: number; detail?: string };

export type ParsedPage = {
  status: StockStatus;
  signals: Signal[];
  title?: string;
  imageUrl?: string;
  pricePence?: number;
  wasPricePence?: number;
};

// Tie-break order: most cautious first.
const CAUTION: StockStatus[] = ['OUT_OF_STOCK', 'COMING_SOON', 'PREORDER', 'QUEUE', 'IN_STOCK', 'UNKNOWN'];

const SCHEMA_AVAILABILITY: Record<string, StockStatus> = {
  instock: 'IN_STOCK',
  limitedavailability: 'IN_STOCK',
  onlineonly: 'IN_STOCK',
  instoreonly: 'OUT_OF_STOCK', // not buyable online
  outofstock: 'OUT_OF_STOCK',
  soldout: 'OUT_OF_STOCK',
  discontinued: 'OUT_OF_STOCK',
  preorder: 'PREORDER',
  presale: 'PREORDER',
  backorder: 'PREORDER',
};

export function availabilityToStatus(v: unknown): StockStatus | undefined {
  if (typeof v !== 'string') return undefined;
  const key = (v.split('/').pop() ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (key === 'oos') return 'OUT_OF_STOCK';
  return SCHEMA_AVAILABILITY[key];
}

export function parsePricePence(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : undefined;
  if (typeof v !== 'string') return undefined;
  const m = v.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return undefined;
  const pence = Math.round(parseFloat(m[1]) * 100);
  return pence > 0 && pence < 10_000_000 ? pence : undefined;
}

// ---------- JSON-LD ----------

type LdNode = Record<string, unknown>;

function jsonLdNodes($: CheerioAPI): LdNode[] {
  const out: LdNode[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      out.push(n as LdNode);
      const graph = (n as LdNode)['@graph'];
      if (graph) walk(graph);
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      walk(JSON.parse(raw));
    } catch {
      // Some stores ship JSON-LD with raw newlines inside strings; try once more.
      try {
        walk(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')));
      } catch {
        /* ignore malformed block */
      }
    }
  });
  return out;
}

const hasType = (n: LdNode, t: string) => {
  const ty = n['@type'];
  return Array.isArray(ty) ? ty.includes(t) : ty === t;
};

function asArray<T>(v: T | T[] | undefined | null): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function readJsonLd($: CheerioAPI) {
  const nodes = jsonLdNodes($);
  const product = nodes.find((n) => hasType(n, 'Product')) ?? nodes.find((n) => hasType(n, 'ProductGroup'));
  if (!product) return undefined;

  // Flatten offers: Offer | Offer[] | AggregateOffer{offers} | ProductGroup.hasVariant[].offers
  const offers: LdNode[] = [];
  const addOffers = (o: unknown) => {
    for (const x of asArray(o as LdNode | LdNode[])) {
      if (!x || typeof x !== 'object') continue;
      offers.push(x);
      if (x.offers) addOffers(x.offers);
    }
  };
  addOffers(product.offers);
  for (const v of asArray(product.hasVariant as LdNode[])) addOffers(v?.offers);

  const gbpOnly = offers.filter((o) => !o.priceCurrency || o.priceCurrency === 'GBP');
  const gbp = gbpOnly.length ? gbpOnly : offers;
  const statuses = gbp.map((o) => availabilityToStatus(o.availability)).filter(Boolean) as StockStatus[];
  // Across variants/offers, report the most buyable state (in stock > pre-order > coming soon > OOS).
  const status = statuses.includes('IN_STOCK') ? 'IN_STOCK' : statuses.sort((a, b) => CAUTION.indexOf(b) - CAUTION.indexOf(a))[0];

  const priced = gbp.find((o) => o.price ?? o.lowPrice);
  const image = asArray(product.image as unknown)[0];

  return {
    status,
    title: typeof product.name === 'string' ? product.name : undefined,
    imageUrl: typeof image === 'string' ? image : (image as LdNode | undefined)?.url as string | undefined,
    pricePence: parsePricePence(priced?.price ?? priced?.lowPrice),
  };
}

// ---------- Text heuristics ----------

const TEXT_RULES: [RegExp, StockStatus][] = [
  [/\b(out of stock|sold out|currently unavailable|no longer available|not available online)\b/i, 'OUT_OF_STOCK'],
  [/\b(notify me|email me when|tell me when|register interest|back in stock alert)\b/i, 'OUT_OF_STOCK'],
  [/\bcoming soon\b/i, 'COMING_SOON'],
  [/\bpre-?order\b/i, 'PREORDER'],
  [/\badd to (basket|cart|bag|trolley)\b|\bbuy now\b/i, 'IN_STOCK'],
];

const ACTION_SEL =
  'button, input[type="submit"], input[type="button"], a[role="button"], ' +
  '[class*="add-to-cart" i], [class*="addtocart" i], [class*="add-to-basket" i], [class*="addtobasket" i]';
const LABEL_SEL = '[class*="stock" i], [class*="availability" i], [data-stock], [itemprop="availability"]';

// Areas whose buttons belong to *other* products or to the site chrome.
const NOISE_SEL =
  'header, footer, nav, aside, [class*="recommend" i], [class*="related" i], [class*="upsell" i], ' +
  '[class*="carousel" i], [class*="recently" i], [class*="also-bought" i], [class*="mini-cart" i]';

const SCOPE_SEL = [
  '[itemtype*="schema.org/Product"]',
  '[class*="product-detail" i]',
  '[class*="product-info" i]',
  '[class*="pdp" i]',
  'main',
  'body',
];

function isDisabled($el: { is(selector: string): boolean; attr(name: string): string | undefined }) {
  return (
    $el.is('[disabled]') ||
    $el.attr('aria-disabled') === 'true' ||
    /\bdisabled\b/i.test($el.attr('class') ?? '')
  );
}

function textSignals($: CheerioAPI, selectors: RetailerConfig['selectors']): Signal[] {
  const signals: Signal[] = [];

  // Retailer-specific selectors first (weight 2).
  if (selectors.outOfStock && $(selectors.outOfStock).length) {
    signals.push({ status: 'OUT_OF_STOCK', source: 'selector', weight: 2, detail: selectors.outOfStock });
  }
  if (selectors.addToCart) {
    const btn = $(selectors.addToCart).first();
    if (btn.length) {
      signals.push({
        status: isDisabled(btn) ? 'OUT_OF_STOCK' : 'IN_STOCK',
        source: 'selector',
        weight: 2,
        detail: selectors.addToCart,
      });
    }
  }

  // Generic heuristics (weight 1), restricted to the main product area.
  $(NOISE_SEL).remove();
  const scope = SCOPE_SEL.map((s) => $(s).first()).find((el) => el.length) ?? $.root();

  const seen = new Set<StockStatus>();
  scope.find(`${ACTION_SEL}, ${LABEL_SEL}`).each((_, el) => {
    const $el = $(el);
    const text = ($el.is('input') ? $el.attr('value') ?? '' : $el.text()).replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80) return;
    for (const [re, status] of TEXT_RULES) {
      if (!re.test(text)) continue;
      // A greyed-out "Add to basket" means out of stock.
      const s: StockStatus = status === 'IN_STOCK' && isDisabled($el) ? 'OUT_OF_STOCK' : status;
      if (!seen.has(s)) {
        seen.add(s);
        signals.push({ status: s, source: 'text', weight: 1, detail: text });
      }
      break;
    }
  });

  return signals;
}

function resolve(signals: Signal[]): StockStatus {
  if (!signals.length) return 'UNKNOWN';
  const score = new Map<StockStatus, number>();
  for (const s of signals) score.set(s.status, (score.get(s.status) ?? 0) + s.weight);
  return [...score.entries()].sort((a, b) => b[1] - a[1] || CAUTION.indexOf(a[0]) - CAUTION.indexOf(b[0]))[0][0];
}

function firstText($: CheerioAPI, sel?: string) {
  if (!sel) return undefined;
  const t = $(sel).first().text().replace(/\s+/g, ' ').trim();
  return t || undefined;
}

function absolute(url: string | undefined, base: string) {
  if (!url) return undefined;
  try {
    return new URL(url, base).toString();
  } catch {
    return undefined;
  }
}

// ---------- Entry point ----------

export function parseProductPage(html: string, cfg: Pick<RetailerConfig, 'selectors'>, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const sel = cfg.selectors;
  const signals: Signal[] = [];

  const ld = readJsonLd($);
  if (ld?.status) signals.push({ status: ld.status, source: 'json-ld', weight: 3 });

  const metaAvail =
    $('meta[property="product:availability"]').attr('content') ??
    $('meta[property="og:availability"]').attr('content') ??
    $('[itemprop="availability"]').attr('href') ??
    $('[itemprop="availability"]').attr('content');
  const metaStatus = availabilityToStatus(metaAvail?.replace(/\s+/g, ''));
  if (metaStatus) signals.push({ status: metaStatus, source: 'meta', weight: 2, detail: metaAvail });

  // Read price/title/image before textSignals() strips noise from the DOM.
  const title =
    firstText($, sel.title) ??
    ld?.title ??
    $('meta[property="og:title"]').attr('content')?.trim() ??
    firstText($, 'h1') ??
    firstText($, 'title');

  const pricePence =
    parsePricePence(firstText($, sel.price)) ??
    ld?.pricePence ??
    parsePricePence($('meta[property="product:price:amount"]').attr('content')) ??
    parsePricePence($('meta[property="og:price:amount"]').attr('content')) ??
    parsePricePence($('[itemprop="price"]').first().attr('content') ?? firstText($, '[itemprop="price"]'));

  const wasText =
    firstText($, sel.wasPrice) ??
    $('del, s, [class*="was-price" i], [class*="was_price" i], [class*="compare-at" i], [class*="rrp" i]')
      .filter((_, el) => /£\s?\d/.test($(el).text()))
      .first()
      .text();
  const wasPence = parsePricePence(wasText);

  const imageUrl = absolute(
    (sel.image && $(sel.image).first().attr('src')) || ld?.imageUrl || $('meta[property="og:image"]').attr('content'),
    pageUrl,
  );

  signals.push(...textSignals($, sel));

  return {
    status: resolve(signals),
    signals,
    title,
    imageUrl,
    pricePence,
    wasPricePence: wasPence && pricePence && wasPence > pricePence ? wasPence : undefined,
  };
}
