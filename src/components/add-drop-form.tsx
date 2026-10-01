'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** Add a drop / in-store link by hand. Title, picture and date are read from the page; the date can be set here. */
export function AddDropForm({ kind }: { kind: 'online' | 'in-store' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/drops', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, kind, date: date || undefined }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setMsg({ ok: false, text: data?.error ?? 'Couldn’t add that link.' });
      return;
    }
    setMsg({ ok: true, text: `Added: ${data.item.title}` });
    setUrl('');
    setDate('');
    startTransition(() => router.refresh());
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-zinc-900 px-3 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
      >
        + Add a link
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <label className="text-xs font-semibold text-zinc-500">
        {kind === 'in-store' ? 'Link to an in-store release or event' : 'Link to a product drop'}
      </label>
      <input
        type="text"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        required
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
        className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base focus:border-zinc-400 focus:outline-none sm:text-sm dark:border-zinc-700 dark:bg-zinc-800"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          {kind === 'in-store' ? 'Date (optional)' : 'Release date (optional)'}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-base sm:text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setOpen(false)} className="px-2 text-sm text-zinc-500">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {busy ? 'Reading page…' : 'Add'}
          </button>
        </div>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</p>}
    </form>
  );
}
