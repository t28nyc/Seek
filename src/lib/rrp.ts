import type { ProductType } from '@prisma/client';
import { prisma } from './db';
import { getStoreConfig } from './retailers';

export type Rrp = {
  pence: number;
  /** Where the figure came from — shown next to it. */
  source: 'you' | 'shop page' | 'Pokémon Center' | 'usual price';
  detail?: string; // e.g. the shop name
};

/**
 * Typical UK price ranges by product type, shown as a hint when no RRP has
 * been found. Source: packratt.co.uk UK buying guide (2026). Edit freely.
 */
export const TYPICAL_RANGES: Partial<Record<ProductType, [number, number]>> = {
  ETB: [4000, 5500],
  BOOSTER_BUNDLE: [2200, 2800],
  BOOSTER_BOX: [10000, 14000],
  BOOSTER_PACK: [400, 500],
  PREMIUM_COLLECTION: [2500, 4500],
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

function pick(productRrp: number | null | undefined, listings: ListingLike[]): Rrp | undefined {
  // 1. Set by you
  if (productRrp) return { pence: productRrp, source: 'you' };
  // 2. Printed on a shop's page ("RRP £54.99")
  const printed = listings.filter((l) => l.rrpPence);
  const printedMode = mode(printed.map((l) => l.rrpPence!));
  if (printedMode) {
    const from = printed.find((l) => l.rrpPence === printedMode)!;
    return { pence: printedMode, source: 'shop page', detail: getStoreConfig(from.url).name };
  }
  // 3. Pokémon Center UK sells at the official RRP
  const pc = listings.find((l) => l.retailer === 'POKEMON_CENTER' && l.pricePence);
  if (pc) return { pence: pc.pricePence!, source: 'Pokémon Center' };
  // 4. The most common "was" price across shops (shops usually show RRP as the was price)
  const was = mode(listings.filter((l) => l.wasPricePence).map((l) => l.wasPricePence!));
  if (was) return { pence: was, source: 'usual price' };
  return undefined;
}

/**
 * RRP for each listing on a page. Products are shared across shops, so a
 * figure found at one shop (or set by you) applies everywhere it's sold.
 */
export async function rrpForListings(
  listings: (ListingLike & { id: string; product: { id: string; rrpPence: number | null } | null })[],
): Promise<Map<string, Rrp>> {
  const productIds = [...new Set(listings.map((l) => l.productId).filter(Boolean))] as string[];
  const siblings = productIds.length
    ? await prisma.trackedUrl.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, url: true, retailer: true, pricePence: true, wasPricePence: true, rrpPence: true },
      })
    : [];
  const byProduct = new Map<string, ListingLike[]>();
  for (const s of siblings) byProduct.set(s.productId!, [...(byProduct.get(s.productId!) ?? []), s]);

  const out = new Map<string, Rrp>();
  for (const l of listings) {
    const group = l.productId ? (byProduct.get(l.productId) ?? [l]) : [l];
    const rrp = pick(l.product?.rrpPence, group);
    if (rrp) out.set(l.id, rrp);
  }
  return out;
}
