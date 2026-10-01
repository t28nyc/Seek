import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { getRetailer } from '@/lib/retailers';
import type { DropTileData } from '@/components/drop-tile';
import { DatedGroups, groupBy, monthHeading } from '@/components/dated-groups';
import { AddDropForm } from '@/components/add-drop-form';
import { DeleteButton } from '@/components/delete-button';
import { FeedSources } from '@/components/feed-sources';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'In store — Peek' };

/**
 * In-store releases, soonest first:
 * - events (pre-releases, leagues, tournaments) listed by the websites Peek scans
 * - news about Pokémon cards in physical shops (supermarkets, toy shops, Happy Meals…)
 * - set release dates from news (sets reach shop shelves on release day)
 * - links you add
 */
export default async function InStorePage() {
  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const recent = new Date(Date.now() - 30 * 86_400_000);

  const [items, manual] = await Promise.all([
    prisma.dropItem.findMany({
      where: {
        hidden: false,
        OR: [
          // In-store items: upcoming, undated, or posted in the last 30 days
          { kind: 'in-store', OR: [{ releaseDate: { gte: today } }, { releaseDate: null, publishedAt: { gte: recent } }] },
          // Any upcoming release date (sets hit shelves on release day)
          { releaseDate: { gte: today } },
        ],
      },
      orderBy: [{ releaseDate: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }],
      take: 200,
    }),
    prisma.drop.findMany({
      where: { OR: [{ releaseDate: { gte: today } }, { releaseDate: null }] },
      orderBy: { releaseDate: { sort: 'asc', nulls: 'last' } },
    }),
  ]);

  const label = (title: string, kind: string) =>
    /pre-?release/i.test(title) ? 'Pre-release' : /tournament|league|cup|event/i.test(title) ? 'Event' : kind === 'in-store' ? 'In store' : 'Release';

  const tiles: DropTileData[] = [
    ...manual.map((d) => ({
      key: d.id,
      href: d.allocationUrl ?? '#',
      title: d.title,
      source: d.retailer ? getRetailer(d.retailer).name : 'Peek',
      label: 'Allocation',
      releaseDate: d.releaseDate,
      cta: 'Sign up',
    })),
    ...items.map((i) => ({
      key: i.id,
      href: i.url,
      title: i.title,
      source: i.source,
      imageUrl: i.imageUrl,
      label: label(i.title, i.kind),
      releaseDate: i.releaseDate,
      publishedAt: i.publishedAt,
      cta: /event|pre-?release|tournament|league/i.test(i.title) ? 'Book' : 'Details',
      deleteBody: { target: 'drop', id: i.id },
    })),
  ].sort((a, b) => (a.releaseDate?.getTime() ?? Infinity) - (b.releaseDate?.getTime() ?? Infinity));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">In store</h1>
          <p className="text-sm text-zinc-500">
            Release days, Pokémon cards in high-street shops, and pre-release events — soonest first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tiles.length > 0 && (
            <DeleteButton
              label="Delete all"
              body={{ target: 'drops', kind: 'in-store' }}
              confirmText={`Delete all ${tiles.length} in-store items? This can’t be undone.`}
            />
          )}
          <AddDropForm kind="in-store" />
        </div>
      </div>
      <DatedGroups
        groups={groupBy(tiles, (t) => (t.releaseDate ? monthHeading(t.releaseDate) : 'Recent news · date to be confirmed'))}
        empty="Nothing in-store found yet. Tap Refresh to search now, or add a link."
      />
      <FeedSources />
    </main>
  );
}
