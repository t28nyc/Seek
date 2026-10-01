import { formatDay, formatPence, timeAgo } from '@/lib/format';
import { DeleteButton } from './delete-button';

export type DropTileData = {
  key: string;
  href: string;
  title: string;
  source: string;
  imageUrl?: string | null;
  /** "Pre-order", "Coming soon", "Deal", "News" … */
  label: string;
  releaseDate?: Date | null;
  publishedAt?: Date | null;
  pricePence?: number | null;
  cta: string;
  /** What to send to /api/delete for this tile (omit to hide the delete button). */
  deleteBody?: Record<string, unknown>;
};

const LABEL_STYLE: Record<string, string> = {
  'Pre-order': 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'Coming soon': 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  Deal: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  Allocation: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'Pre-release': 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  Event: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  Release: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  Restock: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'In store': 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
};

export function DropTile({ drop }: { drop: DropTileData }) {
  const upcoming = drop.releaseDate && drop.releaseDate.getTime() > Date.now() - 86_400_000;
  return (
    <div className="relative">
    <a
      href={drop.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-3 rounded-2xl border border-zinc-200 bg-white p-3 pr-9 transition active:scale-[0.99] hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-zinc-100 sm:size-24 dark:bg-zinc-800">
        {drop.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={drop.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
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
        <div className="mt-auto flex items-center justify-between gap-2 text-xs">
          <span className={upcoming ? 'font-semibold text-rose-600' : 'text-zinc-500'}>
            {upcoming
              ? `${drop.label === 'Event' || drop.label === 'Pre-release' ? 'On' : 'Releases'} ${formatDay(drop.releaseDate!)}`
              : drop.publishedAt
                ? `Posted ${timeAgo(drop.publishedAt)}`
                : 'Date to be confirmed'}
            {drop.pricePence ? ` · ${formatPence(drop.pricePence)}` : ''}
          </span>
          <span className="shrink-0 font-semibold text-zinc-900 dark:text-zinc-100">{drop.cta} →</span>
        </div>
      </div>
    </a>
    {drop.deleteBody && (
      <div className="absolute right-1 top-1">
        <DeleteButton body={drop.deleteBody} confirmText={`Remove “${drop.title}”?`} />
      </div>
    )}
    </div>
  );
}
