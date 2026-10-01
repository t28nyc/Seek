'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Message = { kind: 'ok' | 'error'; text: string };

const STATUS_TEXT: Record<string, string> = {
  IN_STOCK: 'in stock right now',
  QUEUE: 'queue is live',
  PREORDER: 'available to pre-order',
  COMING_SOON: 'coming soon',
  OUT_OF_STOCK: 'out of stock — we’ll keep checking',
  UNKNOWN: 'couldn’t read stock yet — we’ll keep trying',
};

export function TrackUrlForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/track', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: 'error', text: data.error ?? 'Something went wrong.' });
      } else if (data.kind === 'shop') {
        setMessage({
          kind: 'ok',
          text: `Added ${data.shop}: found ${data.found} Pokémon product${data.found === 1 ? '' : 's'} so far${
            data.finished ? '' : ' — the rest will appear over the next few minutes'
          }.`,
        });
        setUrl('');
        startTransition(() => router.refresh());
      } else if (!data.created) {
        setMessage({ kind: 'ok', text: 'Already tracking that one — it’s now checked every few minutes.' });
        setUrl('');
      } else {
        const name = data.listing?.title ?? 'Product';
        setMessage({ kind: 'ok', text: `${name}: ${STATUS_TEXT[data.listing?.status] ?? 'added'}.` });
        setUrl('');
        startTransition(() => router.refresh());
      }
    } catch {
      setMessage({ kind: 'error', text: 'Network error — try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full">
      <div className="flex gap-2 rounded-2xl bg-white/10 p-1.5 ring-1 ring-white/15 focus-within:ring-white/40">
        <input
          type="text"
          inputMode="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a product link or shop homepage…"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-base text-white placeholder:text-white/50 focus:outline-none sm:text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-xl bg-yellow-300 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-yellow-200 disabled:opacity-60"
        >
          {busy ? 'Checking…' : 'Add'}
        </button>
      </div>
      {message && (
        <p role="status" className={`mt-2 text-sm ${message.kind === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
