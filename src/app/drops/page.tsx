import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { ADDED_BY_YOU } from '@/lib/drops/feeds';
import type { DropTileData } from '@/components/drop-tile';
import { DatedGroups, dayHeading, groupBy, monthHeading } from '@/components/dated-groups';
import { AddDropForm } from '@/components/add-drop-form';
import { DeleteButton } from '@/components/delete-button';
import { FeedSources } from '@/components/feed-sources';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Product drops — Peek' };

/** Product drops found on the web: upcoming release dates first, then the latest posts by day. */
export default async function DropsPage() {
  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [upcoming, latest] = await Promise.all([
    prisma.dropItem.findMany({
      where: { kind: 'online', hidden: false, releaseDate: { gte: today } },
      orderBy: { releaseDate: 'asc' },
      take: 80,
    }),
    prisma.dropItem.findMany({
      where: {
        kind: 'online',
        hidden: false,
        OR: [{ publishedAt: { gte: since } }, { source: ADDED_BY_YOU }],
        AND: [{ OR: [{ releaseDate: null }, { releaseDate: { lt: today } }] }],
      },
      orderBy: { publishedAt: 'desc' },
      take: 200,
    }),
  ]);

  const tile = (i: (typeof latest)[number]): DropTileData => ({
    key: i.id,
    href: i.url,
    title: i.title,
    source: i.source,
    imageUrl: i.imageUrl,
    label: i.source === 'HotUKDeals' ? 'Deal' : /pre-?order/i.test(i.title) ? 'Pre-order' : /restock/i.test(i.title) ? 'Restock' : 'News',
    releaseDate: i.releaseDate,
    publishedAt: i.publishedAt,
    cta: 'Go to drop',
    deleteBody: { target: 'drop', id: i.id },
  });

  const groups = [
    ...groupBy(upcoming.map(tile), (t) => `Upcoming · ${monthHeading(t.releaseDate)}`),
    ...groupBy(latest.map(tile), (t) => dayHeading(t.publishedAt)),
  ];
  const count = upcoming.length + latest.length;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">Product drops</h1>
          <p className="text-sm text-zinc-500">Pre-orders, restocks, new sets and deals found on the web — newest first.</p>
        </div>
        <div className="flex items-center gap-2">
          {count > 0 && (
            <DeleteButton
              label="Delete all"
              body={{ target: 'drops', kind: 'online' }}
              confirmText={`Delete all ${count} product drops? This can’t be undone.`}
            />
          )}
          <AddDropForm kind="online" />
        </div>
      </div>
      <DatedGroups groups={groups} empty="No drops found yet. Tap Refresh to search now, or add a link." />
      <FeedSources />
    </main>
  );
}
