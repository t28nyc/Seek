import type { Product, TrackedUrl } from '@prisma/client';
import { getStoreConfig } from '@/lib/retailers';
import { timeAgo } from '@/lib/format';
import { StatusBadge } from './status-badge';
import { PriceStrip, type RrpView } from './price-strip';
import { DeleteButton } from './delete-button';

export type Listing = TrackedUrl & { product: Product | null };

/** Readable name from a URL before the first check has fetched the real title. */
function nameFromUrl(url: string) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    return last.replace(/\.(html?|php|aspx?)$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || url;
  } catch {
    return url;
  }
}

/** One compact row per product, built for long lists on a phone: details on top, price strip below. */
export function ListingRow({
  listing,
  rrp,
  typical,
}: {
  listing: Listing;
  rrp: RrpView;
  typical?: [number, number] | null;
}) {
  const store = getStoreConfig(listing.url);
  const dim = listing.status === 'OUT_OF_STOCK';
  const title = listing.title ?? listing.product?.name ?? nameFromUrl(listing.url);

  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 gap-3">
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="size-14 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800"
          tabIndex={-1}
          aria-hidden
        >
          {listing.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className={`size-full object-contain p-1 ${dim ? 'opacity-50 grayscale' : ''}`}
            />
          ) : (
            <span className="flex size-full items-center justify-center text-xl text-zinc-300">◓</span>
          )}
        </a>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 text-sm font-medium leading-snug hover:underline"
          >
            {title}
          </a>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge status={listing.status} />
            <span className="truncate text-[11px] text-zinc-500">
              {store.name}
              {' · '}
              {listing.failCount > 0 ? (
                <span className="text-amber-600" title={listing.lastError ?? undefined}>
                  can’t reach shop
                </span>
              ) : listing.lastCheckedAt ? (
                `checked ${timeAgo(listing.lastCheckedAt)}`
              ) : (
                'waiting for first check'
              )}
            </span>
          </div>
        </div>

        <DeleteButton body={{ target: 'listing', id: listing.id }} confirmText={`Remove “${title}” from Peek?`} />
      </div>

      <div className="sm:w-72 sm:shrink-0">
        <PriceStrip
          productId={listing.productId}
          pricePence={listing.pricePence}
          wasPricePence={listing.onSale ? listing.wasPricePence : null}
          rrp={rrp}
          typical={typical}
        />
      </div>
    </li>
  );
}
