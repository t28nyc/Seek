import type { Language, Prisma, ProductType, StockStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { EXPANSIONS, PRODUCT_TYPES } from '@/lib/categorize';
import { ListingCard } from '@/components/listing-card';
import { FilterBar, type Filters } from '@/components/filter-bar';
import { TrackUrlForm } from '@/components/track-url-form';
import { DropsStrip } from '@/components/drops-strip';

// Always read fresh stock from the database. The cron also calls
// revalidatePath('/') when something changes.
export const dynamic = 'force-dynamic';

const BUYABLE: StockStatus[] = ['IN_STOCK', 'QUEUE', 'PREORDER'];

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function readFilters(sp: SearchParams): Filters {
  const view = one(sp.view);
  const set = one(sp.set);
  const type = one(sp.type);
  const lang = one(sp.lang);
  return {
    view: view === 'sale' || view === 'all' ? view : 'in-stock',
    set: EXPANSIONS.some((e) => e.key === set) ? set : undefined,
    type: PRODUCT_TYPES.some((t) => t.type === type) ? type : undefined,
    lang: lang === 'JP' || lang === 'EN' ? lang : undefined,
  };
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = readFilters(await searchParams);

  const product: Prisma.ProductWhereInput = {
    ...(filters.set && { expansion: filters.set }),
    ...(filters.type && { type: filters.type as ProductType }),
    ...(filters.lang && { language: filters.lang as Language }),
  };
  const where: Prisma.TrackedUrlWhereInput = {
    active: true,
    ...(Object.keys(product).length > 0 && { product }),
    ...(filters.view === 'in-stock' && { status: { in: BUYABLE } }),
    ...(filters.view === 'sale' && { onSale: true }),
  };

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [listings, drops, inStock, onSale, tracked] = await Promise.all([
    prisma.trackedUrl.findMany({
      where,
      include: { product: true },
      // StockStatus enum order puts IN_STOCK first; hot sets next; freshest changes after.
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { lastChangedAt: { sort: 'desc', nulls: 'last' } }],
      take: 120,
    }),
    prisma.drop.findMany({
      where: { OR: [{ releaseDate: { gte: startOfToday } }, { releaseDate: null }] },
      orderBy: { releaseDate: { sort: 'asc', nulls: 'last' } },
      take: 10,
    }),
    prisma.trackedUrl.count({ where: { active: true, status: { in: BUYABLE } } }),
    prisma.trackedUrl.count({ where: { active: true, onSale: true } }),
    prisma.trackedUrl.count({ where: { active: true } }),
  ]);

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <header className="bg-zinc-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-8 pt-6 sm:px-6">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xl font-black tracking-tight">
              <span className="inline-block size-6 rounded-full bg-[linear-gradient(to_bottom,#ef4444_50%,#fff_50%)] ring-2 ring-zinc-900 [box-shadow:inset_0_0_0_2px_#18181b]" />
              Peek
            </span>
            <span className="text-xs text-white/60">
              {tracked} tracked · {inStock} buyable now
            </span>
          </div>
          <div className="max-w-2xl">
            <h1 className="mb-1 text-2xl font-bold sm:text-3xl">What’s actually in stock.</h1>
            <p className="mb-4 text-sm text-white/60">
              Paste a product link from any shop and Peek keeps checking whether it’s in stock.
            </p>
            <TrackUrlForm />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        <DropsStrip drops={drops} />

        <FilterBar filters={filters} counts={{ inStock, onSale }} />

        {listings.length ? (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </section>
        ) : (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
            {filters.view === 'in-stock'
              ? 'Nothing matching is in stock right now. Try “Everything tracked”, or paste a link above to watch it.'
              : 'Nothing matches these filters yet.'}
          </div>
        )}
      </main>
    </div>
  );
}
