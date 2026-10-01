import type { DropItem } from '@prisma/client';
import type { DropTileData } from '@/components/drop-tile';
import { ADDED_BY_YOU } from './feeds';

/** Turn a stored drop/in-store item into a tile. Links you added carry details read from the page. */
export function toTile(i: DropItem, page: 'online' | 'in-store'): DropTileData {
  const added = i.source === ADDED_BY_YOU;
  const fallbackLabel =
    page === 'in-store'
      ? i.kind === 'in-store'
        ? 'In store'
        : 'Release'
      : i.source === 'HotUKDeals'
        ? 'Deal'
        : /pre-?order/i.test(i.title)
          ? 'Pre-order'
          : /restock/i.test(i.title)
            ? 'Restock'
            : 'News';
  return {
    key: i.id,
    href: i.url,
    title: i.title,
    source: i.source,
    imageUrl: i.imageUrl,
    label: i.status ?? fallbackLabel,
    releaseDate: i.releaseDate,
    publishedAt: added ? null : i.publishedAt,
    pricePence: i.pricePence,
    entryUrl: i.entryUrl,
    purchaseLimit: i.purchaseLimit,
    note: added ? i.summary : null,
    cta: i.status ? 'View product' : 'Read more',
    deleteBody: { target: 'drop', id: i.id },
  };
}
