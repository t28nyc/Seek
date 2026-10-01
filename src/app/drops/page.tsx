import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { ADDED_BY_YOU } from '@/lib/drops/feeds';
import { toTile } from '@/lib/drops/tiles';
import { getSettings } from '@/lib/settings';
import { DatedGroups, dayHeading, groupBy, monthHeading } from '@/components/dated-groups';
import { AddDropForm } from '@/components/add-drop-form';
import { DeleteButton } from '@/components/delete-button';
import { FeedSources } from '@/components/feed-sources';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Product drops — Peek' };

/** Product drops: dated drops/pre-orders first (soonest first), then the latest posts by day. */
export default async function DropsPage() {
  const settings = await getSettings();
  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const since = new Date(Date.now() - settings.dropsKeepDays * 86_400_000);

  const [upcoming, latest, deletedCount] = await Promise.all([
    prisma.dropItem.findMany({
      where: { kind: 'online', hidden: false, releaseDate: { gte: today } },
      orderBy: { releaseDate: 'asc' },
      take: 100,
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
    prisma.dropItem.count({ where: { kind: 'online', hidden: true } }),
  ]);

  const groups = [
    ...groupBy(
      upcoming.map((i) => toTile(i, 'online')),
      (t) => `Coming up · ${monthHeading(t.releaseDate)}`,
    ),
    ...groupBy(
      latest.map((i) => toTile(i, 'online')),
      (t) => (t.publishedAt ? dayHeading(t.publishedAt) : 'Your links'),
    ),
  ];
  const count = upcoming.length + latest.length;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">Product drops</h1>
          <p className="text-sm text-zinc-500">Product drops, raffles, pre-orders, restocks and new sets — soonest first.</p>
        </div>
        <div className="flex items-center gap-2">
          {count > 0 && (
            <DeleteButton
              label="Delete all"
              body={{ target: 'drops', kind: 'online' }}
              confirmText={`Delete all ${count} product drops? You can bring them back with “Restore”.`}
            />
          )}
          <AddDropForm kind="online" />
        </div>
      </div>
      {deletedCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          {deletedCount} deleted
          <DeleteButton
            label="Restore"
            body={{ target: 'restore', kind: 'online' }}
            confirmText={`Bring back ${deletedCount} deleted drop${deletedCount === 1 ? '' : 's'}?`}
            className="rounded-full bg-white px-3 py-1 font-semibold text-zinc-900 ring-1 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700"
          />
        </div>
      )}
      <DatedGroups groups={groups} empty="No drops found yet. Tap Refresh to search now, or add a link." />
      <FeedSources />
    </main>
  );
}
