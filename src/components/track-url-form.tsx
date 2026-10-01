'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Result =
  | { kind: 'error'; text: string }
  | { kind: 'product'; text: string }
  | { kind: 'shop'; title: string; text: string; site: string };

const STATUS_TEXT: Record<string, string> = {
  IN_STOCK: 'in stock right now',
  QUEUE: 'queue is live',
  PREORDER: 'available to pre-order',
  COMING_SOON: 'coming soon',
  OUT_OF_STOCK: 'out of stock — Peek will keep checking',
  UNKNOWN: 'couldn’t read the stock yet — Peek will keep trying',
};

const looksLikeWebsite = (s: string) => {
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.pathname === '/' || !/\/products?\//i.test(u.pathname);
  } catch {
    return false;
  }
};

export function TrackUrlForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [scanningSite, setScanningSite] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1_000);
    return () => clearInterval(t);
  }, [busy]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setSeconds(0);
    setScanningSite(looksLikeWebsite(url.trim()));
    setResult(null);
    try {
      const res = await fetch('/api/track', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ kind: 'error', text: data.error ?? 'Something went wrong.' });
        return;
      }
      setUrl('');
      if (data.kind === 'shop') {
        const n = `${data.found} Pokémon product${data.found === 1 ? '' : 's'}`;
        setResult({
          kind: 'shop',
          site: data.site,
          title: data.note ? data.note : `Found ${n} on ${data.shop}`,
          text: data.pending
            ? 'Their prices and stock fill in over the next 30 minutes. Peek re-reads the site daily for new products.'
            : data.finished
              ? 'Prices and stock are in. Peek rescans the site about every 30 minutes.'
              : 'More are being added over the next few minutes as Peek reads the rest of the site.',
        });
      } else if (!data.created) {
        setResult({ kind: 'product', text: 'Already tracking that one — it’s now checked every few minutes.' });
      } else {
        setResult({
          kind: 'product',
          text: `${data.listing?.title ?? 'Product'}: ${STATUS_TEXT[data.listing?.status] ?? 'added'}.`,
        });
      }
      startTransition(() => router.refresh());
    } catch {
      setResult({ kind: 'error', text: 'Network error — try again.' });
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
          autoCapitalize="off"
          autoCorrect="off"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Product link, shop website or category page…"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-base text-white placeholder:text-white/50 focus:outline-none sm:text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-xl bg-yellow-300 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-yellow-200 disabled:opacity-60"
        >
          {busy ? 'Working…' : 'Add'}
        </button>
      </div>

      {busy && (
        <div role="status" className="mt-3 flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2.5 text-sm">
          <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-yellow-300" />
          <span>
            {scanningSite
              ? `Reading the website for Pokémon products… ${seconds}s (can take up to a minute)`
              : `Checking the product page… ${seconds}s`}
          </span>
        </div>
      )}

      {result && (
        <div
          role="status"
          className={`mt-3 rounded-xl px-3 py-2.5 text-sm ${
            result.kind === 'error' ? 'bg-rose-500/20 text-rose-100' : 'bg-emerald-500/20 text-emerald-50'
          }`}
        >
          {result.kind === 'shop' ? (
            <>
              <p className="font-semibold">{result.title}</p>
              <p className="text-xs opacity-80">{result.text}</p>
              <Link
                href={`/?site=${encodeURIComponent(result.site)}`}
                className="mt-2 inline-block rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900"
              >
                Show them →
              </Link>
            </>
          ) : (
            result.text
          )}
        </div>
      )}
    </form>
  );
}
