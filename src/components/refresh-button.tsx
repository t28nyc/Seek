'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type PartResult = { part: string; skipped?: string; checked?: number; changed?: number; remaining?: number; found?: number; added?: number; error?: string };

/** Checks products, rescans shops and reads drop feeds right now (three requests in parallel). */
export function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function refresh() {
    setBusy(true);
    setNote(null);
    const results = await Promise.all(
      ['products', 'shops', 'feeds'].map((part) =>
        fetch(`/api/refresh?part=${part}`, { method: 'POST' })
          .then((r) => r.json() as Promise<PartResult>)
          .catch(() => ({ part, error: 'failed' }) as PartResult),
      ),
    );
    setBusy(false);

    if (results.every((r) => r.skipped)) {
      setNote('Just refreshed');
    } else {
      const p = results.find((r) => r.part === 'products');
      const changed = results.reduce((n, r) => n + (r.changed ?? 0) + (r.part === 'feeds' ? (r.added ?? 0) : 0), 0);
      const more = p?.remaining ? ` · ${p.remaining} more queued` : '';
      setNote(`${changed} update${changed === 1 ? '' : 's'}${more}`);
    }
    startTransition(() => router.refresh());
    setTimeout(() => setNote(null), 6_000);
  }

  return (
    <div className="flex items-center gap-2">
      {note && <span role="status" className="hidden text-xs text-white/70 sm:inline">{note}</span>}
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        title={note ?? 'Check everything now'}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-yellow-300 px-3 text-sm font-semibold text-zinc-900 transition hover:bg-yellow-200 disabled:opacity-70"
      >
        <svg
          viewBox="0 0 24 24"
          className={`size-4 ${busy ? 'animate-spin' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        {busy ? 'Checking…' : 'Refresh'}
      </button>
      {note && <span role="status" className="sr-only">{note}</span>}
    </div>
  );
}
