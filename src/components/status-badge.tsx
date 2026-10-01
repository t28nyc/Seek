import type { StockStatus } from '@prisma/client';

const STYLES: Record<StockStatus, { label: string; className: string }> = {
  IN_STOCK: { label: 'In stock', className: 'bg-emerald-500/15 text-emerald-700 ring-emerald-600/25 dark:text-emerald-300' },
  QUEUE: { label: 'Queue live', className: 'bg-violet-500/15 text-violet-700 ring-violet-600/25 dark:text-violet-300' },
  PREORDER: { label: 'Pre-order', className: 'bg-sky-500/15 text-sky-700 ring-sky-600/25 dark:text-sky-300' },
  COMING_SOON: { label: 'Coming soon', className: 'bg-amber-500/15 text-amber-800 ring-amber-600/25 dark:text-amber-300' },
  OUT_OF_STOCK: { label: 'Out of stock', className: 'bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-400' },
  UNKNOWN: { label: 'Checking…', className: 'bg-zinc-500/10 text-zinc-500 ring-zinc-500/20' },
};

export function StatusBadge({ status }: { status: StockStatus }) {
  const s = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.className}`}>
      {(status === 'IN_STOCK' || status === 'QUEUE') && (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {s.label}
    </span>
  );
}
