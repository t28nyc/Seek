import type { Product, TrackedUrl } from '@prisma/client';
import { getStoreConfig } from '@/lib/retailers';
import { formatPence, timeAgo } from '@/lib/format';
import { typeLabel } from '@/lib/categorize';
import { StatusBadge } from './status-badge';

export type Listing = TrackedUrl & { product: Product | null };

export function ListingCard({ listing }: { listing: Listing }) {
  const store = getStoreConfig(listing.url);
  const price = formatPence(listing.pricePence);
  const was = listing.onSale ? formatPence(listing.wasPricePence) : undefined;
  const pctOff =
    listing.onSale && listing.wasPricePence && listing.pricePence
      ? Math.round((1 - listing.pricePence / listing.wasPricePence) * 100)
      : 0;
  const stale = listing.failCount > 0;
  const buyable = listing.status === 'IN_STOCK' || listing.status === 'PREORDER' || listing.status === 'QUEUE';

  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group flex flex-col overflow-hidden rounded-2xl border bg-white transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-zinc-900 ${
        buyable ? 'border-emerald-500/40' : 'border-zinc-200 dark:border-zinc-800'
      }`}
    >
      <div className="relative aspect-square bg-zinc-100 dark:bg-zinc-800">
        {listing.imageUrl ? (
          // Plain <img>: avoids burning the free-tier image optimisation quota on retailer images.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className={`size-full object-contain p-4 transition group-hover:scale-[1.03] ${
              listing.status === 'OUT_OF_STOCK' ? 'opacity-50 grayscale' : ''
            }`}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-4xl text-zinc-300">◓</div>
        )}
        {pctOff > 0 && (
          <span className="absolute left-3 top-3 rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">
            −{pctOff}%
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
          <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">{store.name}</span>
          {listing.product && listing.product.type !== 'OTHER' && <span>{typeLabel(listing.product.type)}</span>}
        </div>

        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
          {listing.title ?? listing.product?.name ?? listing.url}
        </h3>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="flex items-baseline gap-1.5">
            {price && <span className="text-base font-bold tabular-nums">{price}</span>}
            {was && <span className="text-xs text-zinc-400 line-through tabular-nums">{was}</span>}
          </div>
          <StatusBadge status={listing.status} />
        </div>

        <p className="text-[11px] text-zinc-400">
          {stale ? (
            <span className="text-amber-600" title={listing.lastError ?? undefined}>
              Can’t reach store · last known {timeAgo(listing.lastChangedAt ?? listing.lastCheckedAt)}
            </span>
          ) : (
            <>Checked {timeAgo(listing.lastCheckedAt)}</>
          )}
        </p>
      </div>
    </a>
  );
}
