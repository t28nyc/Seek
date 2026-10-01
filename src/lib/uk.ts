/**
 * UK-only rules: shops must price in pounds; posts about US/other-country
 * shops are dropped.
 */
import { fetchHtml } from './scraper/fetch';
import { matchesAny } from './match';

export type UkVerdict = 'uk' | 'not-uk' | 'unknown';

const cache = new Map<string, { verdict: UkVerdict; currency?: string; at: number }>();

/** Shops and sites Peek always treats as UK (their UK storefronts). */
const KNOWN_UK = /(^|\.)(pokemoncenter\.com|smythstoys\.com|johnlewis\.com|hmv\.com|zavvi\.com|selfridges\.com|forbiddenplanet\.com|totalcards\.net)$/i;

/** Read the currency a site's homepage prices in. */
export function currencyFromHtml(html: string): string | undefined {
  const patterns = [
    /Shopify\.currency\s*=\s*\{\s*"active"\s*:\s*"([A-Z]{3})"/, // Shopify themes
    /"currencyCode"\s*:\s*"([A-Z]{3})"/,
    /property="(?:og|product):price:currency"\s+content="([A-Z]{3})"/i,
    /"priceCurrency"\s*:\s*"([A-Z]{3})"/,
    /"currency"\s*:\s*"([A-Z]{3})"/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1].toUpperCase();
  }
  // Fall back to counting price symbols in the page
  const pounds = (html.match(/£\s?\d/g) ?? []).length;
  const others = (html.match(/(?:\$|€|US\$|A\$|C\$)\s?\d/g) ?? []).length;
  if (pounds > others && pounds > 0) return 'GBP';
  if (others > pounds) return 'OTHER';
  return undefined;
}

/** Is this site a UK shop? .uk domains and known UK retailers are; otherwise the homepage currency decides. */
export async function ukCheck(host: string): Promise<{ verdict: UkVerdict; currency?: string }> {
  const h = host.toLowerCase();
  if (/\.uk$/.test(h) || KNOWN_UK.test(h)) return { verdict: 'uk', currency: 'GBP' };
  const hit = cache.get(h);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit;
  let result: { verdict: UkVerdict; currency?: string } = { verdict: 'unknown' };
  try {
    const { html } = await fetchHtml(`https://${h}/`, { timeoutMs: 8_000, retries: 0 });
    const currency = currencyFromHtml(html);
    result = { verdict: currency === 'GBP' ? 'uk' : currency ? 'not-uk' : 'unknown', currency };
  } catch {
    /* unreachable: unknown */
  }
  cache.set(h, { ...result, at: Date.now() });
  return result;
}

const UK_MARKERS = /£|\b(uk|u\.k\.|britain|british|england|scotland|wales|northern ireland|london)\b/i;

/**
 * Is a news/deal post about somewhere other than the UK? True when it mentions
 * non-UK shops or dollar/euro prices and nothing UK-specific.
 */
export function isNonUkPost(text: string, nonUkWords: string): boolean {
  if (UK_MARKERS.test(text)) return false;
  return /(?:\$|€|US\$|A\$|C\$)\s?\d/.test(text) || matchesAny(text, nonUkWords);
}
