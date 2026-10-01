import type { Retailer } from '@prisma/client';

export type SelectorKey = 'title' | 'price' | 'wasPrice' | 'image' | 'addToCart' | 'outOfStock';

export type RetailerConfig = {
  key: Retailer;
  name: string;
  /** First entry is the canonical host; URLs are rewritten to it. */
  hosts: string[];
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

/** Config for a built-in store, by its enum key (used for curated drops). */
export function getRetailer(key: Retailer): RetailerConfig {
  const cfg = BY_KEY.get(key);
  if (!cfg) throw new Error(`No retailer config for ${key}`);
  return cfg;
}

export type StoreConfig = Omit<RetailerConfig, 'key'> & { key: Retailer | null };

/** Readable name for a shop we have no config for: "www.gumgumgames.co.uk" → "gumgumgames.co.uk". */
export function storeNameFromHost(host: string): string {
  return host.replace(/^www\./, '');
}

/**
 * Config for any product URL: the built-in store's config when the host is
 * one we know, otherwise a generic config that relies on the Stock Status
 * Engine's generic signals (JSON-LD, meta tags, Shopify data, button text).
 */
export function getStoreConfig(url: string): StoreConfig {
  const host = new URL(url).hostname.toLowerCase();
  const known = RETAILERS.find((r) => r.hosts.includes(host));
  if (known) return known;
  return { key: null, name: storeNameFromHost(host), hosts: [host], discoveryUrls: [], minGapMs: 3_000, selectors: {} };
}

// Query params worth keeping (variant pickers); everything else — utm_*, gclid,
// fbclid, affiliate refs — is dropped so the same page never gets tracked twice.
const KEEP_PARAMS = new Set(['variant', 'sku', 'pid', 'id', 'product_id', 'p']);

/**
 * Block addresses that point inside a private network. The scraper fetches
 * whatever URL users paste, so it must never be usable to probe internal
 * services. (Blocks localhost, private/link-local IPv4 ranges, IP literals in
 * IPv6 form and single-label hostnames.)
 */
export function isPublicHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!h.includes('.') || h.startsWith('[')) return false;
  if (h === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(h)) return false;
  const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) return false;
  }
  return true;
}

export type ResolvedUrl =
  | { config: StoreConfig; url: string }
  | { shopHost: string } // a shop's homepage: scan its whole catalogue
  | { error: string };

/** Validate and normalise a pasted link: a product page, or a shop homepage (→ scan the whole shop). */
export function resolveStore(raw: string): ResolvedUrl {
  let u: URL;
  try {
    u = new URL(raw.trim().match(/^https?:\/\//i) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return { error: "That doesn't look like a link. Paste the full product URL." };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only web links are supported.' };
  if (u.port && u.port !== '443' && u.port !== '80') return { error: 'Links with custom ports aren’t supported.' };
  if (!isPublicHost(u.hostname)) return { error: 'That address isn’t a public website.' };
  if (u.username || u.password) return { error: 'Links with login details aren’t supported.' };

  const config = getStoreConfig(u.toString());
  u.protocol = 'https:';
  u.hostname = config.hosts[0];
  u.port = '';
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (!KEEP_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  if (u.pathname === '/' || u.pathname === '') return { shopHost: u.hostname };

  return { config, url: u.toString() };
}
