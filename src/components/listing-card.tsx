import type { Product, TrackedUrl } from '@prisma/client';
import { getStoreConfig } from '@/lib/retailers';
import { formatPence, timeAgo } from '@/lib/format';
import { StatusBadge } from './status-badge';
import { RrpEditor } from './rrp-editor';

export type Listing = TrackedUrl & { product: Product | null };

export function ListingCard({ listing }: { listing: Listing }) {
  const store = getStoreConfig(listing.url);
  const price = formatPence(listing.pricePence);
  const was = listing.onSale ? formatPence(listing.wasPricePence) : undefined;
  const stale = listing.failCount > 0;
  const buyable = listing.status === 'IN_STOCK' || listing.status === 'QUEUE';

  const rrpPence = listing.product?.rrpPence ?? listing.rrpPence ?? null;
  const rrpSource = listing.product?.rrpPence ? 'you' : listing.rrpPence ? 'shop' : null;

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-2xl border bg-white dark:bg-zinc-900 ${
        buyable ? 'border-emerald-500/40' : 'border-zinc-200 dark:border-zinc-800'
      }`}
    >
      <a href={listing.url} target="_blank" rel="noopener noreferrer" className="group flex flex-1 flex-col">
        <div className="relative aspect-square bg-zinc-100 dark:bg-zinc-800">
          {listing.imageUrl ? (
            // Plain <img>: avoids burning the free-tier image optimisation quota on shop images.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className={`size-full object-contain p-3 transition group-hover:scale-[1.03] ${
                listing.status === 'OUT_OF_STOCK' ? 'opacity-50 grayscale' : ''
              }`}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-4xl text-zinc-300">◓</div>
          )}
          <span className="absolute left-2 top-2">
            <StatusBadge status={listing.status} />
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-1 p-3 pb-2">
          <span className="truncate text-[11px] font-medium uppercase tracking-wide text-zinc-500">{store.name}</span>
          <h3 className="line-clamp-3 text-[13px] font-semibold leading-snug text-zinc-900 group-hover:underline sm:text-sm dark:text-zinc-50">
            {listing.title ?? listing.product?.name ?? listing.url}
          </h3>
          <div className="mt-auto flex items-baseline gap-1.5 pt-1">
            {price ? (
              <span className="text-base font-bold tabular-nums">{price}</span>
            ) : (
              <span className="text-xs text-zinc-400">No price yet</span>
            )}
            {was && <span className="text-xs text-zinc-400 line-through tabular-nums">{was}</span>}
          </div>
        </div>
      </a>

      <div className="flex flex-col gap-1.5 px-3 pb-3">
        <RrpEditor
          productId={listing.productId}
          rrpPence={rrpPence}
          pricePence={listing.pricePence}
          rrpSource={rrpSource}
        />
        <p className="text-[10px] text-zinc-400">
          {stale ? (
            <span className="text-amber-600" title={listing.lastError ?? undefined}>
              Can’t reach shop · last known {timeAgo(listing.lastChangedAt ?? listing.lastCheckedAt)}
            </span>
          ) : (
            <>Checked {timeAgo(listing.lastCheckedAt)}</>
          )}
        </p>
      </div>
    </article>
  );
}
