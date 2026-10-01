import Link from 'next/link';
import { feedStatus, getFeeds } from '@/lib/drops/feeds';
import { timeAgo } from '@/lib/format';

/** Which web sources were checked, when, and what each found — so an empty page explains itself. */
export async function FeedSources() {
  const [status, feeds] = await Promise.all([feedStatus(), getFeeds()]);
  return (
    <details className="rounded-2xl border border-zinc-200 bg-white text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer list-none px-4 py-3 font-semibold">
        Sources{' '}
        <span className="font-normal text-zinc-500">
          ({feeds.length}) · {status ? `checked ${timeAgo(status.at)}` : 'not checked yet — tap Refresh'}
        </span>
      </summary>
      <ul className="divide-y divide-zinc-100 border-t border-zinc-100 text-xs dark:divide-zinc-800 dark:border-zinc-800">
        {feeds.map((f) => {
          const r = status?.results.find((x) => x.feed === f.name);
          return (
            <li key={f.name} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0 truncate">
                {f.name}
                <span className="text-zinc-400"> · {f.page === 'auto' ? 'drops & in store' : f.page === 'in-store' ? 'in store' : 'drops'}</span>
              </span>
              <span className={`shrink-0 text-right ${!r ? 'text-zinc-400' : r.ok ? 'text-emerald-600' : 'text-amber-600'}`}>
                {!r
                  ? '—'
                  : !r.ok
                    ? `✗ ${r.error?.slice(0, 40)}`
                    : r.inStore === undefined
                      ? `✓ ${r.matched} relevant`
                      : `✓ ${r.matched} relevant: ${r.inStore} in store · ${r.drops} drops${r.deleted ? ` · ${r.deleted} deleted` : ''}`}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-800">
        Plus links you add.{' '}
        <Link href="/settings?tab=sources" className="underline">
          Add or remove sources in Settings
        </Link>
      </p>
    </details>
  );
}
