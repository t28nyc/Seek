import { formatDay, formatPence, timeAgo } from '@/lib/format';
import { DeleteButton } from './delete-button';

export type DropTileData = {
  key: string;
  href: string;
  title: string;
  source: string;
  imageUrl?: string | null;
  /** "Product drop", "Raffle", "Pre-order", "Coming soon", "Deal", "News", "In store"… */
  label: string;
  releaseDate?: Date | null;
  publishedAt?: Date | null;
  pricePence?: number | null;
  /** Where to enter a drop/raffle, if the page links to it. */
  entryUrl?: string | null;
  purchaseLimit?: number | null;
  /** Short line under the title, e.g. "Only available through a product drop · Pre-orders open soon". */
  note?: string | null;
  cta: string;
  /** What to send to /api/delete for this tile (omit to hide the delete button). */
  deleteBody?: Record<string, unknown>;
};

const LABEL_STYLE: Record<string, string> = {
  'Product drop': 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  Raffle: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'Pre-order': 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'Coming soon': 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  'In stock': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'Sold out': 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
  Deal: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  Restock: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  Allocation: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  Release: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'In store': 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
};

const DATE_WORD: Record<string, string> = {
  'Product drop': 'Drop expected',
  Raffle: 'Draw expected',
  'Pre-order': 'Expected',
  'Coming soon': 'Expected',
};

export function DropTile({ drop }: { drop: DropTileData }) {
  const upcoming = drop.releaseDate && drop.releaseDate.getTime() > Date.now() - 86_400_000;
  const dateText = drop.releaseDate
    ? `${upcoming ? (DATE_WORD[drop.label] ?? 'Releases') : 'Released'} ${formatDay(drop.releaseDate)}`
    : drop.publishedAt
      ? `Posted ${timeAgo(drop.publishedAt)}`
      : 'Date to be confirmed';

  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
      <a href={drop.href} target="_blank" rel="noopener noreferrer" className="group flex gap-3 p-3 pr-9">
        <div className="size-24 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-zinc-100 sm:size-28 dark:bg-zinc-800 dark:ring-zinc-800">
          {drop.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={drop.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-contain p-1" />
          ) : (
            <div className="flex size-full items-center justify-center text-2xl text-zinc-300">◓</div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={`rounded-full px-2 py-0.5 font-semibold ${LABEL_STYLE[drop.label] ?? 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300'}`}>
              {drop.label}
            </span>
            <span className="truncate text-zinc-500">{drop.source}</span>
          </div>
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug group-hover:underline">{drop.title}</h3>
          {drop.note && <p className="line-clamp-2 text-[11px] text-zinc-500">{drop.note}</p>}
          <div className="mt-auto flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className={upcoming ? 'font-semibold text-rose-600' : 'text-zinc-500'}>{dateText}</span>
            {drop.pricePence ? <span className="font-bold tabular-nums">{formatPence(drop.pricePence)}</span> : null}
            {drop.purchaseLimit ? <span className="text-zinc-500">limit {drop.purchaseLimit}</span> : null}
          </div>
        </div>
      </a>
      <div className="flex items-center gap-2 border-t border-zinc-100 px-3 py-2 text-xs dark:border-zinc-800">
        <a href={drop.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-zinc-900 hover:underline dark:text-zinc-100">
          {drop.cta} →
        </a>
        {drop.entryUrl && (
          <a
            href={drop.entryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto rounded-lg bg-violet-600 px-3 py-1.5 font-semibold text-white hover:bg-violet-500"
          >
            {drop.label === 'Raffle' ? 'Enter raffle' : 'Enter drop'} →
          </a>
        )}
      </div>
      {drop.deleteBody && (
        <div className="absolute right-1 top-1">
          <DeleteButton body={drop.deleteBody} confirmText={`Remove “${drop.title}”?`} />
        </div>
      )}
    </div>
  );
}
