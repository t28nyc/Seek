import Link from 'next/link';
import type { StockStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { storeNameFromHost } from '@/lib/retailers';
import { rrpForListings } from '@/lib/rrp';
import { timeAgo } from '@/lib/format';
import {
  baseWhere,
  filtersHref,
  listWhere,
  PAGE,
  readFilters,
  STATUS_FILTERS,
  type StatusKey,
} from '@/lib/online-filters';
import { ListingRow } from '@/components/listing-row';
import { TrackUrlForm } from '@/components/track-url-form';
import { DeleteButton } from '@/components/delete-button';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function Chip({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      scroll={false}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium transition ${
        active
          ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
          : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:ring-zinc-400 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800'
      }`}
    >
      {children}
    </Link>
  );
}

export default async function OnlinePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = readFilters(await searchParams);
  const where = listWhere(f);

  const [listings, total, byStatus, shops, mineUrls] = await Promise.all([
    prisma.trackedUrl.findMany({
      where,
      include: { product: true },
      // StockStatus order puts in-stock first; then hot sets; then most recent change.
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { lastChangedAt: { sort: 'desc', nulls: 'last' } }],
      take: f.n,
    }),
    prisma.trackedUrl.count({ where }),
    prisma.trackedUrl.groupBy({ by: ['status'], where: baseWhere(f), _count: { _all: true } }),
    prisma.shop.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
    prisma.trackedUrl.findMany({ where: { active: true, source: 'USER' }, select: { url: true }, take: 500 }),
  ]);
  const rrps = await rrpForListings(listings);

  const countFor = (key: StatusKey) => {
    const s = STATUS_FILTERS[key].statuses as readonly StockStatus[] | null;
    return byStatus.filter((g) => !s || s.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
  };

  // Sites to filter by: scanned websites plus any site you've pasted links from.
  const sites = new Map<string, string>(shops.map((s) => [s.host, s.name]));
  for (const { url } of mineUrls) {
    const host = new URL(url).hostname;
    if (!sites.has(host)) sites.set(host, storeNameFromHost(host));
  }
  const now = Date.now();
  const filtered = f.q || f.site || f.mine || f.status !== 'all';
  const siteName = f.site ? (sites.get(f.site) ?? storeNameFromHost(f.site)) : null;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
      <section className="rounded-2xl bg-zinc-900 p-4 text-white">
        <h1 className="mb-1 text-base font-bold">Add a product or a website</h1>
        <p className="mb-3 text-xs text-white/60">
          Paste a product link to track it — or a shop’s homepage or Pokémon category page to find all of its Pokémon
          products.
        </p>
        <TrackUrlForm />
      </section>

      {shops.length > 0 && (
        <details className="group rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
            <span>
              Websites Peek scans <span className="font-normal text-zinc-500">({shops.length})</span>
              {shops.some((s) => s.nextScanAt.getTime() <= now || s.scanPage > 1) && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-sky-600">
                  <span className="size-1.5 animate-pulse rounded-full bg-current" /> scanning
                </span>
              )}
            </span>
            <span className="text-zinc-400 transition group-open:rotate-180">▾</span>
          </summary>
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
            {shops.map((s) => {
              const scanning = s.nextScanAt.getTime() <= now || s.scanPage > 1;
              const scope =
                s.platform === 'listing'
                  ? 'category page'
                  : s.collection
                    ? `“${s.collection}” collection`
                    : s.platform === 'sitemap'
                      ? 'whole site (sitemap)'
                      : 'whole shop';
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link href={filtersHref(f, { site: s.host, n: PAGE })} className="text-sm font-medium hover:underline">
                      {s.name}
                    </Link>
                    <p className="truncate text-[11px] text-zinc-500">
                      {scope} · {s.productsFound} products ·{' '}
                      {scanning ? (
                        <span className="font-medium text-sky-600">scanning now…</span>
                      ) : s.lastError ? (
                        <span className="text-amber-600">{s.lastError}</span>
                      ) : (
                        `updated ${timeAgo(s.lastScannedAt)}`
                      )}
                    </p>
                  </div>
                  <DeleteButton
                    body={{ target: 'shop', id: s.id }}
                    confirmText={`Stop scanning ${s.name} and remove the products it found? Links you added yourself stay.`}
                  />
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <section className="flex flex-col gap-2" aria-label="Filters">
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
          {(Object.keys(STATUS_FILTERS) as StatusKey[]).map((k) => (
            <Chip key={k} to={filtersHref(f, { status: k, n: PAGE })} active={f.status === k}>
              {STATUS_FILTERS[k].label}
              <span className="text-xs tabular-nums opacity-60">{countFor(k)}</span>
            </Chip>
          ))}
          <Chip to={filtersHref(f, { mine: !f.mine, n: PAGE })} active={f.mine}>
            Added by me
          </Chip>
        </div>

        {sites.size > 1 && (
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
            <Chip to={filtersHref(f, { site: undefined, n: PAGE })} active={!f.site}>
              All shops
            </Chip>
            {[...sites].map(([host, name]) => (
              <Chip key={host} to={filtersHref(f, { site: f.site === host ? undefined : host, n: PAGE })} active={f.site === host}>
                {name}
              </Chip>
            ))}
          </div>
        )}

        <form action="/" role="search" className="flex">
          {f.status !== 'all' && <input type="hidden" name="status" value={f.status} />}
          {f.site && <input type="hidden" name="site" value={f.site} />}
          {f.mine && <input type="hidden" name="mine" value="1" />}
          <input
            type="search"
            name="q"
            defaultValue={f.q}
            placeholder="Search products…"
            aria-label="Search products"
            className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none sm:text-sm dark:border-zinc-800 dark:bg-zinc-900"
          />
        </form>
      </section>

      {listings.length ? (
        <>
          <div className="flex items-center justify-between gap-2 px-1 text-xs text-zinc-500">
            <span>
              {total} product{total === 1 ? '' : 's'}
              {siteName ? ` at ${siteName}` : ''}
            </span>
            <DeleteButton
              label={filtered ? `Delete these ${total}` : 'Delete all'}
              body={{
                target: 'listings',
                filters: {
                  status: f.status,
                  ...(f.site && { site: f.site }),
                  ...(f.mine && { mine: '1' }),
                  ...(f.q && { q: f.q }),
                },
              }}
              confirmText={
                f.site && !f.q && !f.mine && f.status === 'all'
                  ? `Delete all ${total} products from ${siteName} and stop scanning it? This can’t be undone.`
                  : `Delete ${filtered ? 'these' : 'all'} ${total} product${total === 1 ? '' : 's'}? This can’t be undone.`
              }
            />
          </div>
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {listings.map((l) => (
              <ListingRow
                key={l.id}
                listing={l}
                rrp={rrps.get(l.id) ?? null}
              />
            ))}
          </ul>
          <div className="flex items-center justify-between px-1 text-xs text-zinc-500">
            <span>
              Showing {listings.length} of {total}
            </span>
            {total > listings.length && (
              <Link
                href={filtersHref(f, { n: f.n + PAGE })}
                scroll={false}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-900 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800"
              >
                Show more
              </Link>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {filtered ? 'Nothing matches these filters.' : 'Nothing here yet. Paste a product link or a shop’s website above.'}
        </div>
      )}
    </main>
  );
}
