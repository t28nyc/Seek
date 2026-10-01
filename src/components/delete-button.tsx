'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Delete with an "are you sure?" prompt. `body` is sent to /api/delete.
 * Renders a small × by default, or a labelled button when `label` is given.
 */
export function DeleteButton({
  body,
  confirmText,
  label,
  className,
}: {
  body: Record<string, unknown>;
  confirmText: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      window.alert('Couldn’t delete — try again.');
      return;
    }
    router.refresh();
  }

  if (label) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={
          className ??
          'rounded-full px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-50 dark:ring-rose-900 dark:hover:bg-rose-950'
        }
      >
        {busy ? 'Deleting…' : label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label="Delete"
      title="Delete"
      className={
        className ??
        'flex size-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950'
      }
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
