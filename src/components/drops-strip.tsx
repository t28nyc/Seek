import type { Drop } from '@prisma/client';
import { getRetailer } from '@/lib/retailers';
import { formatDay } from '@/lib/format';

export function DropsStrip({ drops }: { drops: Drop[] }) {
  if (!drops.length) return null;
  return (
    <section aria-labelledby="drops-heading">
      <h2 id="drops-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Upcoming drops
      </h2>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        {drops.map((d) => (
          <article
            key={d.id}
            className="flex w-64 shrink-0 snap-start flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-rose-600">{d.releaseDate ? formatDay(d.releaseDate) : 'Date TBC'}</span>
              {d.retailer && <span className="text-zinc-500">{getRetailer(d.retailer).name}</span>}
            </div>
            <h3 className="text-sm font-semibold leading-snug">{d.title}</h3>
            {d.notes && <p className="line-clamp-2 text-xs text-zinc-500">{d.notes}</p>}
            {d.allocationUrl && (
              <a
                href={d.allocationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-auto inline-flex items-center justify-center rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
              >
                Sign up for allocation →
              </a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
