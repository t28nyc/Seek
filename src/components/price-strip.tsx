'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const fmt = (pence: number) => gbp.format(pence / 100);

export type RrpView = { pence: number; source: string; detail?: string } | null;

/**
 * Price | RRP | Difference — always shown together. Tap the RRP to set your
 * own; it's saved on the product, so it applies at every shop.
 */
export function PriceStrip({
  productId,
  pricePence,
  wasPricePence,
  rrp,
  typical,
}: {
  productId: string | null;
  pricePence: number | null;
  wasPricePence?: number | null;
  rrp: RrpView;
  typical?: [number, number] | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(rrp ? (rrp.pence / 100).toFixed(2) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(next: string | null) {
    if (!productId) return;
    setSaving(true);
    setError(null);
    const res = await fetch('/api/rrp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId, rrp: next }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError((await res?.json().catch(() => null))?.error ?? 'Couldn’t save.');
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(value.trim() || null);
        }}
        className="flex flex-wrap items-center gap-1.5"
      >
        <label className="flex min-w-0 flex-1 items-center rounded-lg bg-zinc-100 px-2 ring-1 ring-zinc-300 focus-within:ring-zinc-500 dark:bg-zinc-800 dark:ring-zinc-700">
          <span className="text-xs text-zinc-500">RRP £</span>
          <input
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="54.99"
            aria-label="RRP in pounds"
            className="w-full min-w-0 bg-transparent px-1 py-1.5 text-base focus:outline-none sm:text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {saving ? '…' : 'Save'}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="px-1 text-xs text-zinc-500 underline">
          Cancel
        </button>
        {rrp?.source === 'you' && (
          <button type="button" onClick={() => save(null)} className="px-1 text-xs text-zinc-500 underline">
            Use automatic
          </button>
        )}
        {error && <p className="w-full text-[11px] text-rose-600">{error}</p>}
      </form>
    );
  }

  const diff = rrp && pricePence != null ? pricePence - rrp.pence : null;
  const pct = diff != null && rrp ? (diff / rrp.pence) * 100 : null;
  const tone =
    diff == null || Math.abs(diff) < 1
      ? 'text-zinc-600 dark:text-zinc-300'
      : diff > 0
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-emerald-600 dark:text-emerald-400';
  const sourceLabel = rrp
    ? rrp.source === 'you'
      ? 'set by you'
      : rrp.source === 'RRP table'
        ? 'RRP table'
        : rrp.detail
          ? `from ${rrp.detail}`
          : rrp.source
    : null;

  return (
    <div className="grid grid-cols-3 overflow-hidden rounded-lg bg-zinc-100 text-center dark:bg-zinc-800/70">
      <div className="flex flex-col px-1.5 py-1">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Price</span>
        <span className="text-sm font-bold tabular-nums">{pricePence != null ? fmt(pricePence) : '—'}</span>
        {wasPricePence && pricePence != null && wasPricePence > pricePence && (
          <span className="text-[10px] text-zinc-400 line-through tabular-nums">{fmt(wasPricePence)}</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => productId && setEditing(true)}
        disabled={!productId}
        className="flex flex-col border-x border-white px-1.5 py-1 transition hover:bg-zinc-200 dark:border-zinc-900 dark:hover:bg-zinc-700"
        title={
          rrp?.source === 'RRP table'
            ? `From the RRP table (“${rrp.detail}”) — tap to set your own`
            : productId
              ? 'Tap to set the RRP'
              : undefined
        }
      >
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">RRP {productId && '✎'}</span>
        {rrp ? (
          <>
            <span className="text-sm font-semibold tabular-nums">{fmt(rrp.pence)}</span>
            <span className="truncate text-[10px] text-zinc-400">{sourceLabel}</span>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold text-zinc-400">{productId ? 'Set' : '—'}</span>
            {typical && (
              <span className="truncate text-[10px] text-zinc-400">
                typical {fmt(typical[0]).replace('.00', '')}–{fmt(typical[1]).replace('.00', '')}
              </span>
            )}
          </>
        )}
      </button>
      <div className="flex flex-col px-1.5 py-1">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">vs RRP</span>
        {diff != null ? (
          <>
            <span className={`text-sm font-bold tabular-nums ${tone}`}>
              {Math.abs(diff) < 1 ? '£0' : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}`}
            </span>
            <span className={`text-[10px] font-semibold tabular-nums ${tone}`}>
              {Math.abs(diff) < 1 ? 'at RRP' : `${diff > 0 ? '+' : '−'}${Math.abs(pct!).toFixed(Math.abs(pct!) < 10 ? 1 : 0)}%`}
            </span>
          </>
        ) : (
          <span className="text-sm text-zinc-400">—</span>
        )}
      </div>
      {error && <p className="col-span-3 text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}
