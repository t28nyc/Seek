import { prisma } from './db';
import { getStoreConfig } from './retailers';
import { getRrpRules, getSettings, matchRrpRule } from './settings';

export type Rrp = {
  pence: number;
  /** Where the figure came from — shown under it. */
  source: 'you' | 'shop page' | 'Pokémon Center' | 'RRP table' | 'usual price';
  detail?: string; // shop name, or the RRP table row name
};

function mode(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
}

type ListingLike = {
  productId: string | null;
  url: string;
  retailer: string | null;
  pricePence: number | null;
  wasPricePence: number | null;
  rrpPence: number | null;
};

type Rule = { name: string; keywords: string; rrpPence: number; enabled: boolean };

/**
 * RRP for a product, best source first:
 * 1. set by you  2. "RRP £x" printed on a shop's page  3. Pokémon Center UK price (official RRP)
 * 4. the RRP table on the Settings page (matched on the product name)  5. the most common "was" price across shops
 */
function pick(productRrp: number | null | undefined, listings: ListingLike[], tableMatch: Rule | undefined): Rrp | undefined {
  if (productRrp) return { pence: productRrp, source: 'you' };

  const printed = listings.filter((l) => l.rrpPence);
  const printedMode = mode(printed.map((l) => l.rrpPence!));
  if (printedMode) {
    const from = printed.find((l) => l.rrpPence === printedMode)!;
    return { pence: printedMode, source: 'shop page', detail: getStoreConfig(from.url).name };
  }

  const pc = listings.find((l) => l.retailer === 'POKEMON_CENTER' && l.pricePence);
  if (pc) return { pence: pc.pricePence!, source: 'Pokémon Center' };

  if (tableMatch) return { pence: tableMatch.rrpPence, source: 'RRP table', detail: tableMatch.name };

  const was = mode(listings.filter((l) => l.wasPricePence).map((l) => l.wasPricePence!));
  if (was) return { pence: was, source: 'usual price' };
  return undefined;
}

/**
 * RRP for each listing on a page. Products are shared across shops, so a
 * figure found at one shop (or set by you) applies everywhere it's sold.
 */
export async function rrpForListings(
  listings: (ListingLike & {
    id: string;
    title: string | null;
    product: { id: string; name: string; rrpPence: number | null; language: string } | null;
  })[],
): Promise<Map<string, Rrp>> {
  const productIds = [...new Set(listings.map((l) => l.productId).filter(Boolean))] as string[];
  const [siblings, rules, settings] = await Promise.all([
    productIds.length
      ? prisma.trackedUrl.findMany({
          where: { productId: { in: productIds } },
          select: { productId: true, url: true, retailer: true, pricePence: true, wasPricePence: true, rrpPence: true },
        })
      : Promise.resolve([]),
    getRrpRules(),
    getSettings(),
  ]);
  const byProduct = new Map<string, ListingLike[]>();
  for (const s of siblings) byProduct.set(s.productId!, [...(byProduct.get(s.productId!) ?? []), s]);

  const out = new Map<string, Rrp>();
  for (const l of listings) {
    const group = l.productId ? (byProduct.get(l.productId) ?? [l]) : [l];
    const title = l.title ?? l.product?.name ?? '';
    const japanese = l.product?.language === 'JP' || /japanese|\bjpn?\b/i.test(title);
    const tableMatch = title && (!japanese || settings.rrpForJapanese) ? matchRrpRule(title, rules) : undefined;
    const rrp = pick(l.product?.rrpPence, group, tableMatch);
    if (rrp) out.set(l.id, rrp);
  }
  return out;
}
