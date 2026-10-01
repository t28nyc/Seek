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
  /** RRP printed on the page ("RRP £54.99"), if any. */
  rrpPence?: number;
  /** Where the price was read from (shown on hover so odd prices can be checked). */
  priceSource?: PriceSource;
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
  // If a £ sign is present, read the number right after it ("2 for £10" → £10, "Save £5 £44.99" → £5 is avoided below).
  const pounds = [...v.matchAll(/£\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)].map((m) => m[1]);
  let raw: string | undefined;
  if (pounds.length) {
    // "Was £54.99 Now £44.99" / "£54.99 £44.99": the last £ figure is normally the current price,
    // unless the text marks the first as the current one.
    raw = /\b(was|rrp|save|saving|off)\b/i.test(v) || pounds.length === 1 ? pounds[pounds.length - 1] : pounds[0];
    if (/\bsave\b/i.test(v) && pounds.length === 1) return undefined; // "Save £5" alone isn't a price
  } else {
    const t = v.trim();
    // European decimal comma ("49,99") vs thousands comma ("1,299.00")
    raw = /^\d+,\d{2}$/.test(t) ? t.replace(',', '.') : t.match(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/)?.[0];
  }
  if (!raw) return undefined;
  const pence = Math.round(parseFloat(raw.replace(/,/g, '')) * 100);
  return pence > 0 && pence < 10_000_000 ? pence : undefined;
}

/** A believable shop price for a Pokémon product: 50p to £10,000. */
export const plausiblePrice = (p: number | undefined) => (p && p >= 50 && p <= 1_000_000 ? p : undefined);

/**
 * Find an RRP written in text: "RRP £54.99", "RRP: £54.99", "MSRP £55", "SRP £49.99",
 * "Recommended retail price £54.99", "Retail price: £54.99".
 */
export function findRrpPence(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.match(
    /(?:\bR\.?R\.?P\b|\bM\.?S\.?R\.?P\b|\bS\.?R\.?P\b|\brecommended (?:retail )?price\b|\bretail price\b)\.?[^£\d]{0,15}£\s?(\d{1,4}(?:[.,]\d{2})?)/i,
  );
  return m ? parsePricePence(m[1].replace(',', '.')) : undefined;
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

const norm = (s: unknown) => (typeof s === 'string' ? s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : '');

function readJsonLd($: CheerioAPI, pageUrl: string, pageTitle: string) {
  const nodes = jsonLdNodes($);
  const products = nodes.filter((n) => hasType(n, 'Product') || hasType(n, 'ProductGroup'));
  if (!products.length) return undefined;
  // Pages can include related products too: prefer the one whose url or name matches this page.
  const path = (() => {
    try {
      return new URL(pageUrl).pathname.replace(/\/$/, '');
    } catch {
      return '';
    }
  })();
  const title = norm(pageTitle);
  const product =
    products.find((n) => {
      const u = typeof n.url === 'string' ? n.url : typeof n['@id'] === 'string' ? (n['@id'] as string) : '';
      return !!path && u.split('#')[0].split('?')[0].replace(/\/$/, '').endsWith(path);
    }) ??
    products.find((n) => title && norm(n.name) && (title.includes(norm(n.name)) || norm(n.name).includes(title))) ??
    products[0];

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

  // UK only: offers priced in another currency are ignored entirely (never shown as £).
  const gbp = offers.filter((o) => !o.priceCurrency || String(o.priceCurrency).toUpperCase() === 'GBP');
  const statuses = gbp.map((o) => availabilityToStatus(o.availability)).filter(Boolean) as StockStatus[];
  // Across variants/offers, report the most buyable state (in stock > pre-order > coming soon > OOS).
  const status = statuses.includes('IN_STOCK') ? 'IN_STOCK' : statuses.sort((a, b) => CAUTION.indexOf(b) - CAUTION.indexOf(a))[0];

  // Price: the first in-stock offer (Shopify lists the default variant first), else the first priced offer.
  const priced =
    gbp.find((o) => (o.price ?? o.lowPrice) != null && availabilityToStatus(o.availability) === 'IN_STOCK') ??
    gbp.find((o) => (o.price ?? o.lowPrice) != null);
  const image = asArray(product.image as unknown)[0];

  return {
    status,
    title: typeof product.name === 'string' ? product.name : undefined,
    imageUrl: typeof image === 'string' ? image : ((image as LdNode | undefined)?.url as string | undefined),
    pricePence: plausiblePrice(parsePricePence(priced?.price ?? priced?.lowPrice)),
    otherCurrency: offers.length > 0 && gbp.length === 0,
  };
}

// ---------- Text heuristics ----------

const TEXT_RULES: [RegExp, StockStatus][] = [
  [/\b(out of stock|sold out|currently unavailable|no longer available|not available online)\b/i, 'OUT_OF_STOCK'],
  [/\b(notify me|email me when|tell me when|register interest|back in stock alert)\b/i, 'OUT_OF_STOCK'],
  [/\b(coming soon|pre-?orders? (?:open )?soon|available for pre-?order soon|not yet released)\b/i, 'COMING_SOON'],
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
  const best = [...score.entries()].sort((a, b) => b[1] - a[1] || CAUTION.indexOf(a[0]) - CAUTION.indexOf(b[0]))[0][0];
  // "Out of stock" in the data but "Coming soon" on the page: not yet released. Both mean not buyable,
  // so the more informative one wins.
  if (best === 'OUT_OF_STOCK' && score.has('COMING_SOON')) return 'COMING_SOON';
  return best;
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

const meta = ($: CheerioAPI, key: string) =>
  ($(`meta[property="${key}"]`).attr('content') ?? $(`meta[name="${key}"]`).attr('content'))?.trim() || undefined;

/** The main product area of a page, with other products' tiles (related, recently viewed…) removed. */
function productScope($: CheerioAPI) {
  const scope = SCOPE_SEL.slice(0, -1)
    .map((s) => $(s).first())
    .find((el) => el.length);
  const el = (scope ?? $('body')).clone();
  el.find(NOISE_SEL).remove();
  return el;
}

export type PriceSource = 'selector' | 'product data' | 'page meta' | 'page markup';

export function parseProductPage(html: string, cfg: Pick<RetailerConfig, 'selectors'>, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const sel = cfg.selectors;
  const signals: Signal[] = [];

  const h1 = firstText($, 'h1') ?? '';
  const ld = readJsonLd($, pageUrl, meta($, 'og:title') ?? h1);
  if (ld?.status) signals.push({ status: ld.status, source: 'json-ld', weight: 3 });

  const metaAvail =
    meta($, 'product:availability') ??
    meta($, 'og:availability') ??
    $('[itemprop="availability"]').attr('href') ??
    $('[itemprop="availability"]').attr('content');
  const metaStatus = availabilityToStatus(metaAvail?.replace(/\s+/g, ''));
  if (metaStatus) signals.push({ status: metaStatus, source: 'meta', weight: 2, detail: metaAvail });

  // Read price/title/image before textSignals() strips noise from the DOM.
  const title = firstText($, sel.title) ?? ld?.title ?? meta($, 'og:title') ?? (h1 || undefined) ?? firstText($, 'title');

  // Price, most reliable source first. Every source must be in pounds and believable.
  const scope = productScope($);
  const metaCurrency = (meta($, 'product:price:currency') ?? meta($, 'og:price:currency'))?.toUpperCase();
  const metaGbp = !metaCurrency || metaCurrency === 'GBP';
  const twitterPrice = [1, 2].map((n) => (/price/i.test(meta($, `twitter:label${n}`) ?? '') ? meta($, `twitter:data${n}`) : undefined)).find(Boolean);
  const microdata = scope.find('[itemprop="price"]').first();
  const candidates: [PriceSource, number | undefined][] = [
    ['selector', plausiblePrice(parsePricePence(firstText($, sel.price)))],
    ['product data', ld?.pricePence],
    ['page meta', metaGbp ? plausiblePrice(parsePricePence(meta($, 'product:price:amount') ?? meta($, 'og:price:amount'))) : undefined],
    ['page meta', twitterPrice && /£/.test(twitterPrice) ? plausiblePrice(parsePricePence(twitterPrice)) : undefined],
    ['page markup', plausiblePrice(parsePricePence(microdata.attr('content') ?? microdata.text()))],
  ];
  // A page whose structured data is priced in another currency never gets a scraped £ price.
  const found = ld?.otherCurrency && !metaGbp ? undefined : candidates.find(([, p]) => p);
  const pricePence = found?.[1];

  const wasText =
    firstText($, sel.wasPrice) ??
    scope
      .find('del, s, [class*="was-price" i], [class*="was_price" i], [class*="compare-at" i], [class*="compare_at" i]')
      .filter((_, el) => /£\s?\d/.test($(el).text()))
      .first()
      .text();
  const wasPence = plausiblePrice(parsePricePence(wasText));

  const imageUrl = absolute(
    (sel.image && $(sel.image).first().attr('src')) || ld?.imageUrl || meta($, 'og:image'),
    pageUrl,
  );

  // Look for an RRP in the main product area only (not in other products' tiles).
  const rrpPence = plausiblePrice(findRrpPence(scope.text().replace(/\s+/g, ' ').slice(0, 30_000)));

  signals.push(...textSignals($, sel));

  return {
    status: resolve(signals),
    signals,
    title,
    imageUrl,
    pricePence,
    priceSource: found?.[0],
    // A "was" price only counts if it's above the current price and not absurdly so (a different product's price).
    wasPricePence: wasPence && pricePence && wasPence > pricePence && wasPence < pricePence * 4 ? wasPence : undefined,
    rrpPence,
  };
}
