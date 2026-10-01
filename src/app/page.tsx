import Link from 'next/link';
import type { Prisma, StockStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { storeNameFromHost } from '@/lib/retailers';
import { ListingRow } from '@/components/listing-row';
import { TrackUrlForm } from '@/components/track-url-form';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const STATUS_FILTERS = {
  all: { label: 'All', statuses: null },
  in: { label: 'In stock', statuses: ['IN_STOCK', 'QUEUE'] },
  pre: { label: 'Pre-order', statuses: ['PREORDER', 'COMING_SOON'] },
  out: { label: 'Out of stock', statuses: ['OUT_OF_STOCK', 'UNKNOWN'] },
} as const satisfies Record<string, { label: string; statuses: readonly StockStatus[] | null }>;
type StatusKey = keyof typeof STATUS_FILTERS;

const PAGE = 50;

type Filters = { status: StatusKey; site?: string; mine: boolean; q: string; n: number };

function href(f: Filters, patch: Partial<Filters>) {
  const m = { ...f, ...patch };
  const p = new URLSearchParams();
  if (m.status !== 'all') p.set('status', m.status);
  if (m.site) p.set('site', m.site);
  if (m.mine) p.set('mine', '1');
  if (m.q) p.set('q', m.q);
  if (m.n > PAGE) p.set('n', String(m.n));
  const s = p.toString();
  return s ? `/?${s}` : '/';
}

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
  const sp = await searchParams;
  const statusParam = one(sp.status) as StatusKey | undefined;
  const f: Filters = {
    status: statusParam && statusParam in STATUS_FILTERS ? statusParam : 'all',
    site: one(sp.site)?.toLowerCase() || undefined,
    mine: one(sp.mine) === '1',
    q: (one(sp.q) ?? '').trim().slice(0, 80),
    n: Math.min(Math.max(Number(one(sp.n)) || PAGE, PAGE), 1000),
  };

  // Everything except the status filter — used for the per-status counts.
  const base: Prisma.TrackedUrlWhereInput = {
    active: true,
    ...(f.site && { url: { startsWith: `https://${f.site}/` } }),
    ...(f.mine && { source: 'USER' as const }),
    ...(f.q && { title: { contains: f.q, mode: 'insensitive' as const } }),
  };
  const statuses = STATUS_FILTERS[f.status].statuses;
  const where: Prisma.TrackedUrlWhereInput = statuses ? { ...base, status: { in: [...statuses] } } : base;

  const [listings, total, byStatus, shops, mineUrls] = await Promise.all([
    prisma.trackedUrl.findMany({
      where,
      include: { product: true },
      // StockStatus order puts in-stock first; then hot sets; then most recent change.
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { lastChangedAt: { sort: 'desc', nulls: 'last' } }],
      take: f.n,
    }),
    prisma.trackedUrl.count({ where }),
    prisma.trackedUrl.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.shop.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
    prisma.trackedUrl.findMany({ where: { active: true, source: 'USER' }, select: { url: true }, take: 500 }),
  ]);

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

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
      <section className="rounded-2xl bg-zinc-900 p-4 text-white dark:bg-zinc-900">
        <h1 className="mb-1 text-base font-bold">Add a product or a website</h1>
        <p className="mb-3 text-xs text-white/60">
          Paste a product link to track it, or a shop’s homepage to find all of its Pokémon products.
        </p>
        <TrackUrlForm />
      </section>

      <section className="flex flex-col gap-2" aria-label="Filters">
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
          {(Object.keys(STATUS_FILTERS) as StatusKey[]).map((k) => (
            <Chip key={k} to={href(f, { status: k, n: PAGE })} active={f.status === k}>
              {STATUS_FILTERS[k].label}
              <span className="text-xs tabular-nums opacity-60">{countFor(k)}</span>
            </Chip>
          ))}
          <Chip to={href(f, { mine: !f.mine, n: PAGE })} active={f.mine}>
            Added by me
          </Chip>
        </div>

        {sites.size > 1 && (
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
            <Chip to={href(f, { site: undefined, n: PAGE })} active={!f.site}>
              All shops
            </Chip>
            {[...sites].map(([host, name]) => (
              <Chip key={host} to={href(f, { site: f.site === host ? undefined : host, n: PAGE })} active={f.site === host}>
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
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {listings.map((l) => (
              <ListingRow key={l.id} listing={l} />
            ))}
          </ul>
          <div className="flex items-center justify-between px-1 text-xs text-zinc-500">
            <span>
              Showing {listings.length} of {total}
            </span>
            {total > listings.length && (
              <Link
                href={href(f, { n: f.n + PAGE })}
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
          {f.q || f.site || f.mine || f.status !== 'all'
            ? 'Nothing matches these filters.'
            : 'Nothing here yet. Paste a product link or a shop’s homepage above.'}
        </div>
      )}

      <footer className="mt-4 text-center text-xs leading-relaxed text-zinc-500">
        Scanning {shops.length} website{shops.length === 1 ? '' : 's'} for Pokémon products
        {shops.length ? `: ${shops.map((s) => s.name).join(', ')}` : ''}.
      </footer>
    </main>
  );
}
