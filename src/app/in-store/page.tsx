import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getRetailer } from '@/lib/retailers';
import type { DropTileData } from '@/components/drop-tile';
import { DatedGroups, dayHeading, groupBy, monthHeading } from '@/components/dated-groups';
import { AddDropForm } from '@/components/add-drop-form';
import { DeleteButton } from '@/components/delete-button';
import { FeedSources } from '@/components/feed-sources';
import { getSettings, matchesAny } from '@/lib/settings';
import { ADDED_BY_YOU } from '@/lib/drops/feeds';
import { toTile } from '@/lib/drops/tiles';
import { isUkPost } from '@/lib/uk';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'In store — Seek' };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * In-store releases only (no game nights or tournaments):
 * upcoming release dates first (by month), then recent news (by day).
 */
export default async function InStorePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const showFiltered = sp.all === '1';
  const settings = await getSettings();
  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const recent = new Date(Date.now() - settings.dropsKeepDays * 86_400_000);

  const [items, manual, deletedCount] = await Promise.all([
    prisma.dropItem.findMany({
      where: {
        hidden: false,
        OR: [
          // In-store posts and links: anything upcoming, or posted recently
          { kind: 'in-store', OR: [{ releaseDate: { gte: today } }, { publishedAt: { gte: recent } }, { source: ADDED_BY_YOU }] },
          // News about an upcoming set release date (sets reach shop shelves on release day) —
          // but not product drops/pre-orders, which belong on Product drops.
          { kind: 'online', status: null, source: { not: ADDED_BY_YOU }, releaseDate: { gte: today }, title: { contains: 'releas', mode: 'insensitive' } },
        ],
      },
      orderBy: [{ releaseDate: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }],
      take: 300,
    }),
    prisma.drop.findMany({
      where: { OR: [{ releaseDate: { gte: today } }, { releaseDate: null }] },
      orderBy: { releaseDate: { sort: 'asc', nulls: 'last' } },
    }),
    prisma.dropItem.count({ where: { kind: 'in-store', hidden: true } }),
  ]);

  // Releases only: hide events, game nights, leagues… (word list in Settings). Links you added always show.
  const isFiltered = (title: string, source: string) => source !== ADDED_BY_YOU && matchesAny(title, settings.inStoreExclude);
  // UK only (posts saved before the UK filter existed are checked here too)
  const ukItems = items.filter((i) => isUkPost(i, settings.nonUkWords, settings.requireUkMention));
  const filteredCount = ukItems.filter((i) => isFiltered(i.title, i.source)).length;
  const shown = showFiltered ? ukItems : ukItems.filter((i) => !isFiltered(i.title, i.source));

  const tiles: DropTileData[] = [
    ...manual.map((d) => ({
      key: d.id,
      href: d.allocationUrl ?? '#',
      title: d.title,
      source: d.retailer ? getRetailer(d.retailer).name : 'Seek',
      label: 'Allocation',
      releaseDate: d.releaseDate,
      cta: 'Sign up',
    })),
    ...shown.map((i) => toTile(i, 'in-store')),
  ];
  const upcoming = tiles
    .filter((t) => t.releaseDate && t.releaseDate >= today)
    .sort((a, b) => a.releaseDate!.getTime() - b.releaseDate!.getTime());
  const rest = tiles
    .filter((t) => !(t.releaseDate && t.releaseDate >= today))
    .sort((a, b) => (b.publishedAt?.getTime() ?? b.releaseDate?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? a.releaseDate?.getTime() ?? 0));

  const groups = [
    ...groupBy(upcoming, (t) => `Coming up · ${monthHeading(t.releaseDate)}`),
    ...groupBy(rest, (t) => (t.publishedAt ? `News · ${dayHeading(t.publishedAt)}` : 'Your links')),
  ];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">In store</h1>
          <p className="text-sm text-zinc-500">Pokémon releases in UK high-street shops and supermarkets, and set release days.</p>
        </div>
        <div className="flex items-center gap-2">
          {tiles.length > 0 && (
            <DeleteButton
              label="Delete all"
              body={{ target: 'drops', kind: 'in-store' }}
              confirmText={`Delete all ${tiles.length} in-store items? You can bring them back with “Restore”.`}
            />
          )}
          <AddDropForm kind="in-store" />
        </div>
      </div>

      {(deletedCount > 0 || filteredCount > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          {filteredCount > 0 && (
            <span>
              {showFiltered ? 'Showing' : 'Hiding'} {filteredCount} event/game-night item{filteredCount === 1 ? '' : 's'} (
              <Link href={showFiltered ? '/in-store' : '/in-store?all=1'} className="font-semibold underline">
                {showFiltered ? 'hide them' : 'show them'}
              </Link>
              ,{' '}
              <Link href="/settings?tab=checking" className="underline">
                edit the word list
              </Link>
              )
            </span>
          )}
          {deletedCount > 0 && (
            <span className="flex items-center gap-2">
              {deletedCount} deleted
              <DeleteButton
                label="Restore"
                body={{ target: 'restore', kind: 'in-store' }}
                confirmText={`Bring back ${deletedCount} deleted in-store item${deletedCount === 1 ? '' : 's'}?`}
                className="rounded-full bg-white px-3 py-1 font-semibold text-zinc-900 ring-1 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700"
              />
            </span>
          )}
        </div>
      )}

      <DatedGroups groups={groups} empty="Nothing in-store found yet. Tap Refresh to search now, or add a link." />
      <FeedSources />
    </main>
  );
}
