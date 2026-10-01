'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export type ShopRowView = {
  id: string;
  name: string;
  host: string;
  status: string;
  enabled: boolean;
  origin: string;
  how: string;
  products: number;
  inStock: number;
  lastScan: string;
  error: string | null;
};

const STATUS: Record<string, { label: string; className: string }> = {
  active: { label: 'Polling', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  paused: { label: 'Paused', className: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400' },
  checking: { label: 'Checking…', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  'not-uk': { label: 'Not UK', className: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  unreadable: { label: 'Can’t read', className: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
};

const btn = 'rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50';

export function ShopsEditor({ shops }: { shops: ShopRowView[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'problem'>('all');

  async function act(body: Record<string, unknown>, key: string, okText?: string) {
    setBusy(key);
    setMsg(null);
    const res = await fetch('/api/shops', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setMsg({ ok: false, text: data?.error ?? 'That didn’t work.' });
      return false;
    }
    if (data?.message || okText) setMsg({ ok: true, text: data?.message ?? okText });
    start(() => router.refresh());
    // Checks run in the background: refresh again shortly to show results
    setTimeout(() => router.refresh(), 15_000);
    setTimeout(() => router.refresh(), 45_000);
    return true;
  }

  const shown = shops.filter((s) =>
    filter === 'all' ? true : filter === 'active' ? s.status === 'active' : ['not-uk', 'unreadable'].includes(s.status),
  );
  const active = shops.filter((s) => s.status === 'active' && s.enabled).length;
  const checking = shops.filter((s) => s.status === 'checking').length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>
          <strong>{active}</strong> shops being polled
          {checking > 0 && <span className="text-sky-600"> · {checking} being checked</span>}
        </span>
        <button
          className={`${btn} ml-auto bg-zinc-900 text-white dark:bg-white dark:text-zinc-900`}
          disabled={busy === 'discover'}
          onClick={() => act({ action: 'discover' }, 'discover')}
        >
          {busy === 'discover' ? 'Starting…' : '🔍 Find more UK shops'}
        </button>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act({ action: 'add', url }, 'add', 'Added — checking it now (prices in £ and readable products).')) setUrl('');
        }}
        className="flex gap-2"
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          inputMode="url"
          autoCapitalize="off"
          placeholder="Add a shop: its website or Pokémon category page"
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-base focus:border-zinc-400 focus:outline-none sm:text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
        <button className={`${btn} bg-zinc-900 text-white dark:bg-white dark:text-zinc-900`} disabled={busy === 'add' || !url.trim()}>
          Add
        </button>
      </form>
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</p>}

      <div className="flex gap-1 text-xs">
        {(
          [
            ['all', `All (${shops.length})`],
            ['active', 'Polling'],
            ['problem', 'Problems'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1 font-medium ${filter === k ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'ring-1 ring-zinc-200 dark:ring-zinc-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="py-2 pr-3 font-semibold">Shop</th>
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 text-right font-semibold">Products</th>
              <th className="py-2 pr-3 text-right font-semibold">In stock</th>
              <th className="py-2 pr-3 font-semibold">Read via · last check</th>
              <th className="py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {shown.map((s) => {
              const st = STATUS[s.status === 'active' && !s.enabled ? 'paused' : s.status] ?? STATUS.checking;
              return (
                <tr key={s.id} className="align-top">
                  <td className="py-2 pr-3">
                    <a href={`https://${s.host}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                      {s.name}
                    </a>
                    <div className="text-[11px] text-zinc-500">{s.origin}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.className}`}>{st.label}</span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {s.products > 0 ? (
                      <Link href={`/?site=${encodeURIComponent(s.host.replace(/^www\./, ''))}`} className="hover:underline">
                        {s.products}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {s.inStock > 0 ? (
                      <Link href={`/?site=${encodeURIComponent(s.host.replace(/^www\./, ''))}&status=in`} className="font-semibold text-emerald-600 hover:underline">
                        {s.inStock}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="max-w-56 py-2 pr-3 text-xs text-zinc-500">
                    {s.error ? <span className="text-amber-700 dark:text-amber-400">{s.error}</span> : `${s.how} · ${s.lastScan}`}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">
                    {s.status === 'active' && (
                      <button className={`${btn} ring-1 ring-zinc-200 dark:ring-zinc-700`} disabled={!!busy} onClick={() => act({ action: 'toggle', id: s.id }, s.id)}>
                        {s.enabled ? 'Pause' : 'Resume'}
                      </button>
                    )}
                    {s.status !== 'active' && s.status !== 'checking' && (
                      <button className={`${btn} ring-1 ring-zinc-200 dark:ring-zinc-700`} disabled={!!busy} onClick={() => act({ action: 'recheck', id: s.id }, s.id)}>
                        Check again
                      </button>
                    )}
                    <button
                      className={`${btn} ml-1 text-rose-600 ring-1 ring-rose-200 dark:ring-rose-900`}
                      disabled={!!busy}
                      onClick={() =>
                        window.confirm(`Remove ${s.name} and the products found there? Links you added yourself stay.`) &&
                        act({ action: 'remove', id: s.id }, s.id)
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={6} className="py-3 text-zinc-500">
                  Nothing here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
