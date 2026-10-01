import type { Product, TrackedUrl } from '@prisma/client';
import { getStoreConfig } from '@/lib/retailers';
import { formatPence, timeAgo } from '@/lib/format';
import { StatusBadge } from './status-badge';
import { RrpEditor } from './rrp-editor';

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

/** One compact row per product: built for long lists on a phone. */
export function ListingRow({ listing }: { listing: Listing }) {
  const store = getStoreConfig(listing.url);
  const price = formatPence(listing.pricePence);
  const was = listing.onSale ? formatPence(listing.wasPricePence) : undefined;
  const rrpPence = listing.product?.rrpPence ?? listing.rrpPence ?? null;
  const rrpSource = listing.product?.rrpPence ? 'you' : listing.rrpPence ? 'shop' : null;
  const dim = listing.status === 'OUT_OF_STOCK';

  return (
    <li className="flex gap-3 px-3 py-3">
      <a
        href={listing.url}
        target="_blank"
        rel="noopener noreferrer"
        className="size-14 shrink-0 overflow-hidden rounded-lg bg-zinc-100 sm:size-16 dark:bg-zinc-800"
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

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 text-sm font-medium leading-snug hover:underline"
        >
          {listing.title ?? listing.product?.name ?? nameFromUrl(listing.url)}
        </a>
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
        <RrpEditor
          compact
          productId={listing.productId}
          rrpPence={rrpPence}
          pricePence={listing.pricePence}
          rrpSource={rrpSource}
        />
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {price ? (
          <span className={`text-sm font-bold tabular-nums ${dim ? 'text-zinc-500' : ''}`}>{price}</span>
        ) : (
          <span className="text-xs text-zinc-400">—</span>
        )}
        {was && <span className="text-[11px] text-zinc-400 line-through tabular-nums">{was}</span>}
        <StatusBadge status={listing.status} />
      </div>
    </li>
  );
}
