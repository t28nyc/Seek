import Link from 'next/link';
import type { Prisma, StockStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getRetailer, storeNameFromHost } from '@/lib/retailers';
import { ListingCard } from '@/components/listing-card';
import { DropTile, type DropTileData } from '@/components/drop-tile';
import { TrackUrlForm } from '@/components/track-url-form';

// Always read fresh stock from the database.
export const dynamic = 'force-dynamic';

type Tab = 'in-stock' | 'out-of-stock' | 'drops';
type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const IN_STOCK: StockStatus[] = ['IN_STOCK', 'QUEUE'];
const OUT_OF_STOCK: StockStatus[] = ['OUT_OF_STOCK', 'UNKNOWN'];
const UPCOMING: StockStatus[] = ['PREORDER', 'COMING_SOON'];

export default async function Dashboard({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = one(sp.tab);
  const tab: Tab = t === 'out-of-stock' || t === 'drops' ? t : 'in-stock';
  const q = (one(sp.q) ?? '').trim().slice(0, 80);

  const search: Prisma.TrackedUrlWhereInput = q ? { title: { contains: q, mode: 'insensitive' } } : {};
  const recent = new Date(Date.now() - 30 * 86_400_000);
  const startOfToday = new Date(new Date().setUTCHours(0, 0, 0, 0));

  const [inStockCount, outCount, preorderCount, postCount, shops] = await Promise.all([
    prisma.trackedUrl.count({ where: { active: true, status: { in: IN_STOCK } } }),
    prisma.trackedUrl.count({ where: { active: true, status: { in: OUT_OF_STOCK } } }),
    prisma.trackedUrl.count({ where: { active: true, status: { in: UPCOMING } } }),
    prisma.dropItem.count({ where: { OR: [{ publishedAt: { gte: recent } }, { releaseDate: { gte: startOfToday } }] } }),
    prisma.shop.findMany({ where: { enabled: true }, orderBy: { name: 'asc' }, select: { host: true, name: true } }),
  ]);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'in-stock', label: 'In stock', count: inStockCount },
    { id: 'out-of-stock', label: 'Out of stock', count: outCount },
    { id: 'drops', label: 'Drops', count: preorderCount + postCount },
  ];

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <header className="bg-zinc-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pb-7 sm:pt-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 text-xl font-black tracking-tight">
              <span className="inline-block size-6 rounded-full bg-[linear-gradient(to_bottom,#ef4444_50%,#fff_50%)] [box-shadow:inset_0_0_0_2px_#18181b]" />
              Peek
            </Link>
            <span className="text-xs text-white/60">{inStockCount} in stock now</span>
          </div>
          <div className="max-w-2xl">
            <h1 className="mb-3 text-lg font-bold leading-snug sm:text-2xl">
              Paste a product link — Peek tells you when it’s in stock.
            </h1>
            <TrackUrlForm />
          </div>
        </div>
      </header>

      {/* Tabs: sticky so they stay reachable while scrolling on a phone */}
      <nav className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto grid max-w-6xl grid-cols-3 gap-1 px-2 py-2 sm:px-6">
          {tabs.map((x) => (
            <Link
              key={x.id}
              href={x.id === 'in-stock' ? '/' : `/?tab=${x.id}`}
              scroll={false}
              aria-current={tab === x.id ? 'page' : undefined}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold transition ${
                tab === x.id
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                  : 'text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="truncate">{x.label}</span>
              <span className={`text-xs tabular-nums ${tab === x.id ? 'opacity-70' : 'text-zinc-400'}`}>{x.count}</span>
            </Link>
          ))}
        </div>
      </nav>

      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
        {tab === 'drops' ? (
          <DropsView />
        ) : (
          <>
            <form action="/" className="flex gap-2" role="search">
              {tab !== 'in-stock' && <input type="hidden" name="tab" value={tab} />}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search products…"
                aria-label="Search products"
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none sm:text-sm dark:border-zinc-800 dark:bg-zinc-900"
              />
            </form>
            <StockGrid tab={tab} search={search} q={q} />
          </>
        )}

        <footer className="mt-6 text-center text-xs leading-relaxed text-zinc-500">
          Scanning {shops.length} shop{shops.length === 1 ? '' : 's'} for everything Pokémon:{' '}
          {shops.map((s) => s.name || storeNameFromHost(s.host)).join(', ') || 'none yet'}.
          <br />
          Paste a shop’s homepage above to add it (Shopify shops only).
        </footer>
      </main>
    </div>
  );
}

async function StockGrid({ tab, search, q }: { tab: Tab; search: Prisma.TrackedUrlWhereInput; q: string }) {
  const listings = await prisma.trackedUrl.findMany({
    where: { active: true, status: { in: tab === 'in-stock' ? IN_STOCK : OUT_OF_STOCK }, ...search },
    include: { product: true },
    orderBy:
      tab === 'in-stock'
        ? [{ priority: 'desc' }, { lastInStockAt: { sort: 'desc', nulls: 'last' } }]
        : [{ source: 'asc' }, { priority: 'desc' }, { lastChangedAt: { sort: 'desc', nulls: 'last' } }],
    take: 120,
  });

  if (!listings.length) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
        {q
          ? `Nothing ${tab === 'in-stock' ? 'in stock' : 'out of stock'} matches “${q}”.`
          : tab === 'in-stock'
            ? 'Nothing in stock right now. Paste a product link above to watch it.'
            : 'Nothing out of stock — or nothing tracked yet.'}
      </div>
    );
  }

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {listings.map((l) => (
        <ListingCard key={l.id} listing={l} />
      ))}
    </section>
  );
}

async function DropsView() {
  const recent = new Date(Date.now() - 30 * 86_400_000);
  const startOfToday = new Date(new Date().setUTCHours(0, 0, 0, 0));

  const [preorders, posts, manual] = await Promise.all([
    prisma.trackedUrl.findMany({
      where: { active: true, status: { in: UPCOMING } },
      orderBy: [{ priority: 'desc' }, { lastChangedAt: { sort: 'desc', nulls: 'last' } }],
      take: 60,
    }),
    prisma.dropItem.findMany({
      where: { OR: [{ publishedAt: { gte: recent } }, { releaseDate: { gte: startOfToday } }] },
      orderBy: [{ releaseDate: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }],
      take: 60,
    }),
    prisma.drop.findMany({
      where: { OR: [{ releaseDate: { gte: startOfToday } }, { releaseDate: null }] },
      orderBy: { releaseDate: { sort: 'asc', nulls: 'last' } },
      take: 20,
    }),
  ]);

  const shopTiles: DropTileData[] = preorders.map((p) => ({
    key: p.id,
    href: p.url,
    title: p.title ?? p.url,
    source: storeNameFromHost(new URL(p.url).hostname),
    imageUrl: p.imageUrl,
    label: p.status === 'PREORDER' ? 'Pre-order' : 'Coming soon',
    publishedAt: p.lastChangedAt,
    pricePence: p.pricePence,
    cta: p.status === 'PREORDER' ? 'Pre-order' : 'View',
  }));

  const webTiles: DropTileData[] = [
    ...manual.map((d) => ({
      key: d.id,
      href: d.allocationUrl ?? '#',
      title: d.title,
      source: d.retailer ? getRetailer(d.retailer).name : 'Peek',
      label: 'Allocation',
      releaseDate: d.releaseDate,
      cta: 'Sign up',
    })),
    ...posts.map((p) => ({
      key: p.id,
      href: p.url,
      title: p.title,
      source: p.source,
      imageUrl: p.imageUrl,
      label: p.source === 'HotUKDeals' ? 'Deal' : 'News',
      releaseDate: p.releaseDate,
      publishedAt: p.publishedAt,
      cta: 'Go to drop',
    })),
  ];

  if (!shopTiles.length && !webTiles.length) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
        No drops found yet. Peek checks deal forums and news every 30 minutes, and lists anything up for pre-order at
        the shops it scans.
      </div>
    );
  }

  return (
    <>
      {shopTiles.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Pre-orders & coming soon</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shopTiles.map((d) => (
              <DropTile key={d.key} drop={d} />
            ))}
          </div>
        </section>
      )}
      {webTiles.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">News, deals & restocks</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {webTiles.map((d) => (
              <DropTile key={d.key} drop={d} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
