'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const fmt = (pence: number) => gbp.format(pence / 100);

/**
 * Price vs RRP for one listing, with an inline editor to set the product's RRP.
 * The RRP belongs to the product, so setting it once applies at every shop.
 */
export function RrpEditor({
  productId,
  rrpPence,
  pricePence,
  rrpSource,
  compact = false,
}: {
  productId: string | null;
  rrpPence: number | null;
  pricePence: number | null;
  /** 'you' when set by the user, 'shop' when read from the shop's page. */
  rrpSource: 'you' | 'shop' | null;
  /** One-line version for list rows. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(rrpPence ? (rrpPence / 100).toFixed(2) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(rrp: string | null) {
    if (!productId) return;
    setSaving(true);
    setError(null);
    const res = await fetch('/api/rrp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId, rrp }),
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
        className="flex flex-col gap-1.5"
      >
        <div className="flex items-center gap-1.5">
          <label className="flex min-w-0 flex-1 items-center rounded-lg bg-zinc-100 px-2 ring-1 ring-zinc-300 focus-within:ring-zinc-500 dark:bg-zinc-800 dark:ring-zinc-700">
            <span className="text-sm text-zinc-500">£</span>
            <input
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="RRP"
              aria-label="RRP in pounds"
              className="w-full min-w-0 bg-transparent px-1 py-1.5 text-base focus:outline-none sm:text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {saving ? '…' : 'Save'}
          </button>
        </div>
        <div className="flex gap-3 text-[11px]">
          <button type="button" onClick={() => setEditing(false)} className="text-zinc-500 underline">
            Cancel
          </button>
          {rrpSource === 'you' && (
            <button type="button" onClick={() => save(null)} className="text-zinc-500 underline">
              Clear RRP
            </button>
          )}
        </div>
        {error && <p className="text-[11px] text-rose-600">{error}</p>}
      </form>
    );
  }

  if (!rrpPence) {
    return productId ? (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="self-start text-[11px] font-medium text-zinc-500 underline decoration-dotted underline-offset-2"
      >
        + Set RRP
      </button>
    ) : null;
  }

  const diff = pricePence != null ? pricePence - rrpPence : null;
  const pct = diff != null ? Math.round((diff / rrpPence) * 100) : null;
  const tone =
    diff == null || diff === 0
      ? 'text-zinc-600 dark:text-zinc-400'
      : diff > 0
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-emerald-600 dark:text-emerald-400';

  const diffText =
    diff == null
      ? ''
      : diff === 0
        ? 'at RRP'
        : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))} (${diff > 0 ? '+' : '−'}${Math.abs(pct!)}%)`;

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => productId && setEditing(true)}
        disabled={!productId}
        className="self-start text-left text-[11px] leading-tight text-zinc-500"
        title={rrpSource === 'shop' ? 'RRP shown on the shop’s page — tap to change' : 'Tap to change RRP'}
      >
        RRP {fmt(rrpPence)}
        {diffText && <span className={`ml-1 font-semibold tabular-nums ${tone}`}>{diffText}</span>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => productId && setEditing(true)}
      disabled={!productId}
      className="flex w-full flex-col items-start rounded-lg bg-zinc-100 px-2 py-1.5 text-left dark:bg-zinc-800"
      title={rrpSource === 'shop' ? 'RRP shown on the shop’s page — tap to change' : 'Tap to change RRP'}
    >
      <span className="text-[11px] text-zinc-500">
        RRP {fmt(rrpPence)}
        {rrpSource === 'shop' && ' (shop)'}
      </span>
      {diff != null && (
        <span className={`text-xs font-semibold tabular-nums ${tone}`}>
          {diff === 0
            ? 'At RRP'
            : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))} (${diff > 0 ? '+' : '−'}${Math.abs(pct!)}%) ${
                diff > 0 ? 'over' : 'under'
              }`}
        </span>
      )}
    </button>
  );
}
