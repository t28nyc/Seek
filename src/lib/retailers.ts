import type { Retailer } from '@prisma/client';

export type SelectorKey = 'title' | 'price' | 'wasPrice' | 'image' | 'addToCart' | 'outOfStock';

export type RetailerConfig = {
  key: Retailer;
  name: string;
  /** First entry is the canonical host; URLs are rewritten to it. */
  hosts: string[];
  /** Reject pasted URLs whose path doesn't match — keeps us on the UK storefront. */
  pathGuard?: RegExp;
  /** Pattern that product pages match; used by discovery to ignore nav/category links. */
  productPath?: RegExp;
  /** Category or search pages crawled once a day to find new Pokémon TCG products. */
  discoveryUrls: string[];
  /** Minimum gap between two requests to this host, in ms (politeness). */
  minGapMs: number;
  /**
   * Retailer-specific CSS selectors. They outrank the generic button-text
   * heuristics but not schema.org JSON-LD. Retailers change markup without
   * warning — confirm each one in DevTools and re-check when a store's
   * results start coming back UNKNOWN.
   */
  selectors: Partial<Record<SelectorKey, string>>;
  notes?: string;
};

export const RETAILERS: RetailerConfig[] = [
  {
    key: 'POKEMON_CENTER',
    name: 'Pokémon Center UK',
    hosts: ['www.pokemoncenter.com'],
    pathGuard: /^\/en-gb\//,
    productPath: /^\/en-gb\/product\//,
    discoveryUrls: [], // TODO: add the en-gb TCG category URL
    minGapMs: 6_000,
    selectors: {},
    notes:
      'Sits behind enterprise bot protection and uses a virtual queue on big drops. ' +
      'Expect frequent blocked fetches from datacenter IPs; a QUEUE status is itself a useful drop signal.',
  },
  {
    key: 'SMYTHS',
    name: 'Smyths Toys',
    hosts: ['www.smythstoys.com'],
    pathGuard: /^\/uk\//,
    productPath: /\/p\/\d+/,
    discoveryUrls: [], // TODO: add the UK Pokémon trading cards category URL
    minGapMs: 4_000,
    selectors: {},
  },
  {
    key: 'GAME',
    name: 'GAME',
    hosts: ['www.game.co.uk'],
    discoveryUrls: [],
    minGapMs: 4_000,
    selectors: {},
  },
  {
    key: 'MAGIC_MADHOUSE',
    name: 'Magic Madhouse',
    hosts: ['magicmadhouse.co.uk', 'www.magicmadhouse.co.uk'],
    discoveryUrls: [],
    minGapMs: 3_000,
    selectors: {},
  },
  {
    key: 'CHAOS_CARDS',
    name: 'Chaos Cards',
    hosts: ['www.chaoscards.co.uk', 'chaoscards.co.uk'],
    discoveryUrls: [],
    minGapMs: 3_000,
    selectors: {},
  },
];

const BY_KEY = new Map(RETAILERS.map((r) => [r.key, r]));

export function getRetailer(key: Retailer): RetailerConfig {
  const cfg = BY_KEY.get(key);
  if (!cfg) throw new Error(`No retailer config for ${key}`);
  return cfg;
}

// Query params worth keeping (variant pickers); everything else — utm_*, gclid,
// fbclid, affiliate refs — is dropped so the same page never gets tracked twice.
const KEEP_PARAMS = new Set(['variant', 'sku', 'pid']);

export type ResolvedUrl = { config: RetailerConfig; url: string } | { error: string };

/**
 * Validate a pasted URL against the supported UK retailers and normalise it.
 * The host allowlist doubles as SSRF protection: the scraper never fetches a
 * host that isn't in RETAILERS.
 */
export function resolveRetailer(raw: string): ResolvedUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: "That doesn't look like a link. Paste the full product URL." };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only web links are supported.' };

  const host = u.hostname.toLowerCase();
  const config = RETAILERS.find((r) => r.hosts.includes(host));
  if (!config) {
    return { error: `${host} isn't a supported store yet. Supported: ${RETAILERS.map((r) => r.name).join(', ')}.` };
  }
  if (config.pathGuard && !config.pathGuard.test(u.pathname)) {
    return { error: `That ${config.name} link isn't from the UK store.` };
  }

  u.protocol = 'https:';
  u.hostname = config.hosts[0];
  u.port = '';
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (!KEEP_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');

  return { config, url: u.toString() };
}
