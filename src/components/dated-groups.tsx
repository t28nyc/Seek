import { DropTile, type DropTileData } from './drop-tile';

export type Group = { heading: string; items: DropTileData[] };

/** Group tiles under headings, keeping the order they arrive in. */
export function groupBy(items: DropTileData[], key: (d: DropTileData) => string): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    const heading = key(item);
    const last = groups[groups.length - 1];
    if (last?.heading === heading) last.items.push(item);
    else groups.push({ heading, items: [item] });
  }
  return groups;
}

const LONDON = { timeZone: 'Europe/London' } as const;

export function monthHeading(d: Date | null | undefined) {
  return d ? d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', ...LONDON }) : 'Date to be confirmed';
}

export function dayHeading(d: Date | null | undefined, now = new Date()) {
  if (!d) return 'Undated';
  const key = (x: Date) => x.toLocaleDateString('en-GB', LONDON);
  if (key(d) === key(now)) return 'Today';
  if (key(d) === key(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  if (key(d) === key(new Date(now.getTime() + 86_400_000))) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...LONDON });
}

export function DatedGroups({ groups, empty }: { groups: Group[]; empty: string }) {
  if (!groups.length) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
        {empty}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.heading} className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {g.heading}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {g.items.map((d) => (
              <DropTile key={d.key} drop={d} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
