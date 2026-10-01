/**
 * Reads a product or drop page for the details shown on a drop tile:
 * title, image, price, status (product drop / raffle / pre-order / coming
 * soon / in stock / sold out), expected date, where to enter, and any
 * purchase limit.
 *
 * Every shop words this differently, so it looks for common phrasing, e.g.
 *   "Available for Pre-Order soon. Expected 06/11/2026"
 *   "This item will only be accessible through a product drop"
 *   "Enter the raffle", "Ballot closes 3rd Nov", "Release date: 14/11/2026"
 *   "Customers are limited to only purchasing 1 of this product"
 */
import * as cheerio from 'cheerio';
import { parseProductPage } from '../scraper/parse';
import { findDateNear, findAnyDate } from '../dates';

export type DropStatus = 'Product drop' | 'Raffle' | 'Pre-order' | 'Coming soon' | 'In stock' | 'Sold out';

export type DropDetails = {
  title?: string;
  imageUrl?: string;
  pricePence?: number;
  status?: DropStatus;
  releaseDate?: Date;
  entryUrl?: string;
  purchaseLimit?: number;
  /** Short lines worth showing, e.g. "Only available through a product drop". */
  notes: string[];
};

const RAFFLE = /\b(raffle|ballot|prize draw|lottery|enter (?:the|our) draw|draw closes|winners? (?:will be|are) (?:chosen|picked|drawn|notified))\b/i;
const PRODUCT_DROP = /\b(product drops?|only (?:be )?(?:available|accessible) (?:through|via) (?:a|our) (?:product )?drop|allocation|register (?:your )?interest|sign up (?:for|to) (?:the|this) drop|you'?ll be notified if you are a winner)\b/i;
const PRE_ORDER_SOON = /\b(pre-?orders? (?:open )?soon|available for pre-?order soon|pre-?order coming soon)\b/i;
const PRE_ORDER = /\b(pre-?order(?:s)?(?: now)?|preorder)\b/i;
const COMING_SOON = /\b(coming soon|not yet released|releases? soon|notify me when available)\b/i;
const LIMIT =
  /\b(?:limited to (?:only )?(?:purchasing |buying )?(\d{1,3})|(?:max(?:imum)?|limit(?: of)?) (\d{1,3}) (?:per|each) (?:customer|order|household|person))/i;
const ENTRY_LINK = /product[- ]?drops?|raffle|ballot|draw|enter|register[- ]interest|allocation/i;

function cleanTitle(t: string | undefined): string | undefined {
  if (!t) return undefined;
  // "Pokemon TCG | Delta Reign Elite Trainer Box | Free UK Shipping" → the most product-like part
  const parts = t.split(/\s+[|–—]\s+/).map((p) => p.trim()).filter(Boolean);
  const best = parts.length > 1 ? parts.reduce((a, b) => (b.length > a.length && !/shipping|delivery|shop|store/i.test(b) ? b : a)) : t;
  return best.replace(/\s+/g, ' ').trim().slice(0, 300) || undefined;
}

export function extractDropDetails(html: string, pageUrl: string): DropDetails {
  const parsed = parseProductPage(html, { selectors: {} }, pageUrl);
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, header, footer, nav').remove();

  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const title = h1.length >= 6 && h1.length <= 200 ? h1 : cleanTitle(parsed.title);

  // Main content text (falls back to the whole page)
  const all = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 60_000);
  const mainText = $('main, #content, [class*="product-detail" i], [class*="product-info" i]')
    .first()
    .text()
    .replace(/\s+/g, ' ')
    .trim();
  const text = (mainText.length > 200 ? mainText : all).slice(0, 30_000);

  const notes: string[] = [];
  let status: DropStatus | undefined;
  if (RAFFLE.test(text)) {
    status = 'Raffle';
    notes.push('Entry by raffle / ballot');
  } else if (PRODUCT_DROP.test(text)) {
    status = 'Product drop';
    notes.push('Only available through a product drop');
  } else if (PRE_ORDER_SOON.test(text)) {
    status = 'Coming soon';
    notes.push('Pre-orders open soon');
  } else if (parsed.status === 'PREORDER') {
    status = 'Pre-order';
  } else if (parsed.status === 'COMING_SOON' || COMING_SOON.test(text)) {
    status = 'Coming soon';
  } else if (parsed.status === 'IN_STOCK') {
    status = /pre-?order/i.test(h1) ? 'Pre-order' : 'In stock';
  } else if (PRE_ORDER.test(text)) {
    status = 'Pre-order';
  } else if (parsed.status === 'OUT_OF_STOCK') {
    status = 'Sold out';
  }
  // A drop page usually also says pre-orders are coming — note it alongside the drop.
  if ((status === 'Product drop' || status === 'Raffle') && PRE_ORDER_SOON.test(text)) notes.push('Pre-orders open soon');

  const releaseDate =
    findDateNear(text) ?? findDateNear(all) ?? (status && !['In stock', 'Sold out'].includes(status) ? findAnyDate(text) : undefined);

  const limitMatch = text.match(LIMIT);
  const purchaseLimit = limitMatch ? Number(limitMatch[1] ?? limitMatch[2]) : undefined;
  if (purchaseLimit) notes.push(`Limit ${purchaseLimit} per customer`);

  // Where to enter: a link on the same site whose text or address mentions the drop/raffle
  let entryUrl: string | undefined;
  if (status === 'Product drop' || status === 'Raffle') {
    const host = new URL(pageUrl).hostname.replace(/^www\./, '');
    const $all = cheerio.load(html);
    $all('a[href]').each((_, a) => {
      if (entryUrl) return;
      const href = $all(a).attr('href') ?? '';
      const label = $all(a).text().replace(/\s+/g, ' ').trim();
      if (!ENTRY_LINK.test(href) && !ENTRY_LINK.test(label)) return;
      try {
        const u = new URL(href, pageUrl);
        if (u.hostname.replace(/^www\./, '') !== host) return;
        if (/account|login|register$|wishlist|basket|cart/i.test(u.pathname)) return;
        if (u.toString().split('#')[0] === pageUrl.split('#')[0]) return;
        entryUrl = u.toString();
      } catch {
        /* ignore bad link */
      }
    });
  }

  return {
    title,
    imageUrl: parsed.imageUrl,
    pricePence: parsed.pricePence,
    status,
    releaseDate,
    entryUrl,
    purchaseLimit,
    notes,
  };
}
