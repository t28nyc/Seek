/**
 * UK-only rules.
 * - Shops: must be UK businesses pricing in pounds.
 * - Posts (drops, in store): must be about the UK.
 */
import { fetchHtml } from './scraper/fetch';
import { matchesAny } from './match';
import { bareHost } from './host';

export type UkVerdict = 'uk' | 'not-uk' | 'unknown';

const cache = new Map<string, { verdict: UkVerdict; currency?: string; why?: string; at: number }>();

/** Big retailers whose sites are UK storefronts even without a .uk domain. */
const KNOWN_UK = /(^|\.)(pokemoncenter\.com|smythstoys\.com|johnlewis\.com|hmv\.com|zavvi\.com|selfridges\.com|forbiddenplanet\.com|totalcards\.net)$/i;

/** Read the currency a site's homepage prices in. */
export function currencyFromHtml(html: string): string | undefined {
  const patterns = [
    /Shopify\.currency\s*=\s*\{\s*"active"\s*:\s*"([A-Z]{3})"/, // Shopify themes
    /"currencyCode"\s*:\s*"([A-Z]{3})"/,
    /(?:property|name)="(?:og|product):price:currency"\s+content="([A-Z]{3})"/i,
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

/** Signs a website belongs to a UK business: UK postcode, "United Kingdom", Companies House wording, GB VAT number, +44. */
export function ukBusinessEvidence(html: string): boolean {
  const text = html.replace(/<[^>]+>/g, ' ');
  return (
    /\b(?:[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?)\s?\d[ABD-HJLNP-UW-Z]{2}\b/.test(text) || // UK postcode
    /united kingdom|registered in (?:england|scotland|wales|northern ireland)|company (?:no|number|reg)|companies house|\bvat (?:no|number|reg)[^a-z]{0,12}gb|\+44\s?\d/i.test(text) ||
    /"addressCountry"\s*:\s*"(?:GB|UK|United Kingdom)"/i.test(html)
  );
}

/**
 * Is this site a UK shop?
 * .uk domains and known UK retailers: yes. Anything else must price in pounds AND show it's a UK business
 * (Shopify's shop country, or a UK address/company number on the homepage). US shops that show £ to UK
 * visitors (Shopify Markets) fail this, because their shop country isn't GB.
 */
export async function ukCheck(host: string): Promise<{ verdict: UkVerdict; currency?: string; why?: string }> {
  const h = host.toLowerCase();
  if (/\.uk$/.test(h) || KNOWN_UK.test(h)) return { verdict: 'uk', currency: 'GBP' };
  const hit = cache.get(h);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit;

  let result: { verdict: UkVerdict; currency?: string; why?: string } = { verdict: 'unknown' };
  try {
    // Shopify publishes the shop's own country and base currency
    try {
      const { html } = await fetchHtml(`https://${h}/meta.json`, { timeoutMs: 6_000, retries: 0 });
      const meta = JSON.parse(html) as { country?: string; currency?: string };
      if (meta.country) {
        const uk = meta.country.toUpperCase() === 'GB';
        result = {
          verdict: uk ? 'uk' : 'not-uk',
          currency: meta.currency,
          why: uk ? 'Shopify shop based in the UK' : `Shopify shop based in ${meta.country}`,
        };
      }
    } catch {
      /* not Shopify */
    }
    if (result.verdict === 'unknown') {
      const { html } = await fetchHtml(`https://${h}/`, { timeoutMs: 8_000, retries: 0 });
      const currency = currencyFromHtml(html);
      if (currency && currency !== 'GBP') result = { verdict: 'not-uk', currency, why: 'Prices aren’t in pounds' };
      else if (ukBusinessEvidence(html)) result = { verdict: 'uk', currency, why: 'UK business details on the site' };
      else if (currency === 'GBP') result = { verdict: 'unknown', currency, why: 'Prices in £ but no UK address found' };
    }
  } catch {
    /* unreachable: unknown */
  }
  cache.set(h, { ...result, at: Date.now() });
  return result;
}

// ---------- Posts ----------

const UK_WORDS = /£|\b(uk|u\.k\.|britain|british|england|english stores|scotland|wales|welsh|northern ireland|london|manchester|birmingham|glasgow)\b/i;
const UK_STORES =
  /\b(tesco|smyths|tg jones|whsmith|wh smith|morrisons|asda|sainsbury'?s|aldi uk|lidl uk|argos|the entertainer|b&m|home bargains|the range|card factory|hamleys|forbidden planet|poundland|co-?op|iceland|john lewis|very\.co\.uk|currys|boots)\b/i;
/** UK publishers whose domains don't end in .uk. */
const UK_PUBLISHERS =
  /(^|\.)(thesun\.co\.uk|bbc\.com|independent\.co\.uk|standard\.co\.uk|eurogamer\.net|rockpapershotgun\.com|vg247\.com|nintendolife\.com|pushsquare\.com|purexbox\.com|videogamer\.com|pockettactics\.com|stuff\.tv|t3\.com|techradar\.com|gamesradar\.com|radiotimes\.com|hotukdeals\.com|poketracker\.co\.uk|fullfact\.org)$/i;
const UK_PUBLISHER_NAMES =
  /^(the sun|bbc|the independent|evening standard|metro|daily mirror|mirror|daily express|express|daily mail|mail online|the guardian|the telegraph|the times|radio times|which\?|full fact|eurogamer|nintendo life|pocket tactics|manchester evening news|liverpool echo|birmingham live|wales online|daily record|the scotsman|hotukdeals|poké tracker.*)$/i;

/** Sources whose every post is UK (UK deals forum, UK stock tracker, UK shops' own pages). */
export function isUkSource(url: string, sourceName?: string): boolean {
  const host = bareHost(url);
  return /\.uk$/.test(host) || /(^|\.)hotukdeals\.com$/.test(host) || /^(hotukdeals|added by you|poké tracker)/i.test(sourceName ?? '');
}

export type PostCheck = { title: string; summary?: string | null; url: string; source?: string };

/**
 * Should this post be shown? UK sources: always. Otherwise it must not be about another country
 * ($/€ prices, US shops…) — and, when `requireUkMention` is on, it must positively mention the UK
 * (£, "UK", a UK high-street shop) or come from a UK publisher.
 */
export function isUkPost(p: PostCheck, nonUkWords: string, requireUkMention: boolean): boolean {
  if (isUkSource(p.url, p.source)) return true;
  const text = `${p.title} ${p.summary ?? ''}`;
  const host = bareHost(p.url);
  const ukPublisher = /\.uk$/.test(host) || UK_PUBLISHERS.test(host) || UK_PUBLISHER_NAMES.test((p.source ?? '').trim());
  const ukMention = UK_WORDS.test(text) || UK_STORES.test(text);
  const foreign = /(?:\$|€|US\$|A\$|C\$|CA\$)\s?\d/.test(text) || matchesAny(text, nonUkWords);
  if (foreign && !ukMention) return false;
  if (requireUkMention) return ukMention || ukPublisher;
  return true;
}
