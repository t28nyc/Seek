import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { getRetailer } from '@/lib/retailers';
import type { DropTileData } from '@/components/drop-tile';
import { DatedGroups, groupBy, monthHeading } from '@/components/dated-groups';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'In store — Peek' };

/**
 * In-store releases, soonest first:
 * - events (pre-releases, leagues, tournaments) listed by the shops Peek scans
 * - set release dates mentioned in news (sets hit shop shelves on release day)
 * - allocations/releases added by hand to the Drop table
 */
export default async function InStorePage() {
  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));

  const [items, manual] = await Promise.all([
    prisma.dropItem.findMany({
      where: {
        OR: [
          { kind: 'in-store', OR: [{ releaseDate: null }, { releaseDate: { gte: today } }] },
          { releaseDate: { gte: today } },
        ],
      },
      orderBy: [{ releaseDate: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }],
      take: 150,
    }),
    prisma.drop.findMany({
      where: { OR: [{ releaseDate: { gte: today } }, { releaseDate: null }] },
      orderBy: { releaseDate: { sort: 'asc', nulls: 'last' } },
    }),
  ]);

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
      label: i.kind === 'in-store' ? (/pre-?release/i.test(i.title) ? 'Pre-release' : 'Event') : 'Release',
      releaseDate: i.releaseDate,
      publishedAt: i.kind === 'in-store' ? null : i.publishedAt,
      cta: i.kind === 'in-store' ? 'Book' : 'Details',
    })),
  ].sort((a, b) => (a.releaseDate?.getTime() ?? Infinity) - (b.releaseDate?.getTime() ?? Infinity));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
      <div>
        <h1 className="text-lg font-bold">In store</h1>
        <p className="text-sm text-zinc-500">
          Release days, pre-release events and tournaments at the shops Peek scans — soonest first.
        </p>
      </div>
      <DatedGroups
        groups={groupBy(tiles, (t) => monthHeading(t.releaseDate))}
        empty="No in-store releases or events found yet. They appear as Peek scans shops and reads release news."
      />
    </main>
  );
}
