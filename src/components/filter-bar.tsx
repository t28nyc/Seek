import Link from 'next/link';
import { EXPANSIONS, PRODUCT_TYPES } from '@/lib/categorize';

export type Filters = { view: string; set?: string; type?: string; lang?: string };

function href(current: Filters, patch: Partial<Filters>) {
  const merged = { ...current, ...patch };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v && !(k === 'view' && v === 'in-stock')) p.set(k, v);
  }
  const s = p.toString();
  return s ? `/?${s}` : '/';
}

function Chip({ active, to, children }: { active: boolean; to: string; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      scroll={false}
      className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
          : 'bg-white text-zinc-600 ring-1 ring-zinc-200 hover:ring-zinc-400 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800'
      }`}
    >
      {children}
    </Link>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">{children}</div>
    </div>
  );
}

export function FilterBar({ filters, counts }: { filters: Filters; counts: Record<string, number> }) {
  const sets = [...EXPANSIONS].sort((a, b) => Number(!!b.hot) - Number(!!a.hot));
  const toggle = (key: keyof Filters, value: string) => href(filters, { [key]: filters[key] === value ? undefined : value });

  return (
    <div className="flex flex-col gap-3">
      <Row label="Show">
        <Chip active={filters.view === 'in-stock'} to={href(filters, { view: 'in-stock' })}>
          In stock{counts.inStock ? ` · ${counts.inStock}` : ''}
        </Chip>
        <Chip active={filters.view === 'sale'} to={href(filters, { view: 'sale' })}>
          On sale{counts.onSale ? ` · ${counts.onSale}` : ''}
        </Chip>
        <Chip active={filters.view === 'all'} to={href(filters, { view: 'all' })}>
          Everything tracked
        </Chip>
      </Row>
      <Row label="Set">
        {sets.map((e) => (
          <Chip key={e.key} active={filters.set === e.key} to={toggle('set', e.key)}>
            {e.hot && <span className="mr-1 text-rose-500">●</span>}
            {e.label}
            {e.jpLabel && <span className="text-zinc-400"> / {e.jpLabel}</span>}
          </Chip>
        ))}
      </Row>
      <Row label="Type">
        {PRODUCT_TYPES.map((t) => (
          <Chip key={t.type} active={filters.type === t.type} to={toggle('type', t.type)}>
            {t.label}
          </Chip>
        ))}
        <Chip active={filters.lang === 'JP'} to={toggle('lang', 'JP')}>
          Japanese only
        </Chip>
      </Row>
    </div>
  );
}
