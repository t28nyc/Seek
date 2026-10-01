import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { FEEDS } from '@/lib/drops/feeds';
import type { DropTileData } from '@/components/drop-tile';
import { DatedGroups, dayHeading, groupBy, monthHeading } from '@/components/dated-groups';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Product drops — Peek' };

/** Product drops found on the web: upcoming release dates first, then the latest posts by day. */
export default async function DropsPage() {
  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [upcoming, latest] = await Promise.all([
    prisma.dropItem.findMany({
      where: { kind: 'online', releaseDate: { gte: today } },
      orderBy: { releaseDate: 'asc' },
      take: 60,
    }),
    prisma.dropItem.findMany({
      where: { kind: 'online', publishedAt: { gte: since }, OR: [{ releaseDate: null }, { releaseDate: { lt: today } }] },
      orderBy: { publishedAt: 'desc' },
      take: 150,
    }),
  ]);

  const tile = (i: (typeof latest)[number]): DropTileData => ({
    key: i.id,
    href: i.url,
    title: i.title,
    source: i.source,
    imageUrl: i.imageUrl,
    label: i.source === 'HotUKDeals' ? 'Deal' : 'News',
    releaseDate: i.releaseDate,
    publishedAt: i.publishedAt,
    cta: 'Go to drop',
  });

  const groups = [
    ...groupBy(upcoming.map(tile), (t) => `Upcoming · ${monthHeading(t.releaseDate)}`),
    ...groupBy(latest.map(tile), (t) => dayHeading(t.publishedAt)),
  ];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
      <div>
        <h1 className="text-lg font-bold">Product drops</h1>
        <p className="text-sm text-zinc-500">
          Releases, restocks and deals found on the web ({FEEDS.map((f) => f.name).join(', ')}), checked every 30
          minutes.
        </p>
      </div>
      <DatedGroups groups={groups} empty="No drops found yet. Tap Refresh to check now." />
    </main>
  );
}
