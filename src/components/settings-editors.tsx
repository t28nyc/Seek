'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { matchRrpRule } from '@/lib/match';

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const fmt = (p: number) => gbp.format(p / 100);
const toPounds = (p: number | null | undefined) => (p ? (p / 100).toFixed(2) : '');

async function call(body: Record<string, unknown>) {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  const data = await res?.json().catch(() => null);
  if (!res?.ok) throw new Error(data?.error ?? 'Couldn’t save.');
  return data;
}

const input =
  'w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-base focus:border-zinc-400 focus:outline-none sm:text-sm dark:border-zinc-700 dark:bg-zinc-800';
const btn = 'rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50';
const primary = `${btn} bg-zinc-900 text-white dark:bg-white dark:text-zinc-900`;
const ghost = `${btn} text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800`;
const iconBtn =
  'flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800';

function useSaver() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  async function run(body: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await call(body);
      after?.();
      start(() => router.refresh());
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

// ---------------- General settings ----------------

type Field = { key: string; label: string; help: string; unit?: string; value: string | number | boolean };

export function GeneralSettingsForm({ fields }: { fields: Field[] }) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>(
    Object.fromEntries(fields.map((f) => [f.key, f.value])),
  );
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useSaver();

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        if (await run({ section: 'general', values })) setSaved(true);
      }}
      className="flex flex-col gap-4"
    >
      {fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="text-sm font-medium">{f.label}</span>
          {typeof f.value === 'boolean' ? (
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })}
                className="size-5"
              />
              <span className="text-xs text-zinc-500">{f.help}</span>
            </span>
          ) : typeof f.value === 'number' ? (
            <span className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={String(values[f.key])}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                className={`${input} max-w-28`}
              />
              <span className="text-sm text-zinc-500">{f.unit}</span>
            </span>
          ) : (
            <textarea
              rows={String(values[f.key]).length > 200 ? 5 : 3}
              value={String(values[f.key])}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              className={input}
            />
          )}
          {typeof f.value !== 'boolean' && <span className="text-xs text-zinc-500">{f.help}</span>}
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={primary}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    </form>
  );
}

// ---------------- RRP table ----------------

export type RuleRow = { id: string; name: string; keywords: string; rrpPence: number; lowPence: number | null; enabled: boolean };

function RuleForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
  busy,
}: {
  initial?: RuleRow;
  onSubmit: (v: { name: string; keywords: string; rrp: string; low: string; enabled: boolean }) => void;
  onCancel?: () => void;
  submitLabel: string;
  busy: boolean;
}) {
  const [v, setV] = useState({
    name: initial?.name ?? '',
    keywords: initial?.keywords ?? '',
    rrp: toPounds(initial?.rrpPence),
    low: toPounds(initial?.lowPence),
    enabled: initial?.enabled ?? true,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
      className="flex flex-col gap-2"
    >
      <input className={input} placeholder="Name, e.g. Elite Trainer Box" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <input
        className={input}
        placeholder="Keywords, comma-separated, e.g. elite trainer, etb"
        value={v.keywords}
        onChange={(e) => setV({ ...v, keywords: e.target.value })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-zinc-500">
          RRP £
          <input className={`${input} w-24`} inputMode="decimal" placeholder="49.99" value={v.rrp} onChange={(e) => setV({ ...v, rrp: e.target.value })} />
        </label>
        <label className="flex items-center gap-1 text-xs text-zinc-500">
          Low end £ (optional)
          <input className={`${input} w-24`} inputMode="decimal" placeholder="—" value={v.low} onChange={(e) => setV({ ...v, low: e.target.value })} />
        </label>
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <button type="button" className={ghost} onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" disabled={busy} className={primary}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

export function RrpTableEditor({ rules }: { rules: RuleRow[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [test, setTest] = useState('');
  const { busy, error, run } = useSaver();
  const match = test.trim() ? matchRrpRule(test, rules) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-800/60">
        <label className="mb-1 block text-xs font-semibold text-zinc-500">Try it: type a product name</label>
        <input
          className={input}
          placeholder="e.g. Pokémon TCG: Perfect Order Booster Bundle"
          value={test}
          onChange={(e) => setTest(e.target.value)}
        />
        {test.trim() && (
          <p className="mt-1.5 text-xs">
            {match ? (
              <>
                Matches <strong>{match.name}</strong> → RRP {fmt(match.rrpPence)}
              </>
            ) : (
              <span className="text-zinc-500">No row matches — add keywords to a row, or add a new row.</span>
            )}
          </p>
        )}
      </div>

      <ol className="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {/* Column headings (wider screens) */}
        <li className="hidden grid-cols-[1.5rem_minmax(0,1.1fr)_minmax(0,1.6fr)_7.5rem_9.5rem] items-center gap-3 bg-zinc-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 sm:grid dark:bg-zinc-800/50">
          <span>#</span>
          <span>Item</span>
          <span>Matches names containing</span>
          <span className="text-right">Price range</span>
          <span className="text-right">Actions</span>
        </li>
        {rules.map((r, i) => (
          <li key={r.id} className={`flex flex-col gap-2 p-3 ${r.enabled ? '' : 'opacity-50'}`}>
            {editing === r.id ? (
              <RuleForm
                initial={r}
                busy={busy}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={(v) => run({ section: 'rrp', action: 'update', id: r.id, values: v }, () => setEditing(null))}
              />
            ) : (
              <div className="flex items-start gap-2 sm:grid sm:grid-cols-[1.5rem_minmax(0,1.1fr)_minmax(0,1.6fr)_7.5rem_9.5rem] sm:items-center sm:gap-3">
                <span className="mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums text-zinc-400 sm:mt-0 sm:text-left">{i + 1}</span>
                <div className="min-w-0 flex-1 sm:contents">
                  <div className="flex flex-wrap items-baseline gap-x-2 sm:block">
                    <span className="text-sm font-semibold">{r.name}</span>
                    <span className="text-sm tabular-nums sm:hidden">
                      {r.lowPence ? `${fmt(r.lowPence)} – ` : ''}
                      <strong>{fmt(r.rrpPence)}</strong>
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-zinc-500 sm:whitespace-normal sm:text-xs">
                    <span className="sm:hidden">Matches: </span>
                    {r.keywords}
                  </p>
                  <span className="hidden text-right text-sm tabular-nums sm:block">
                    {r.lowPence ? <span className="text-zinc-500">{fmt(r.lowPence)} – </span> : null}
                    <strong>{fmt(r.rrpPence)}</strong>
                  </span>
                </div>
                <div className="flex shrink-0 items-center sm:justify-end">
                  <button className={iconBtn} disabled={busy || i === 0} onClick={() => run({ section: 'rrp', action: 'up', id: r.id })} aria-label="Move up">
                    ↑
                  </button>
                  <button
                    className={iconBtn}
                    disabled={busy || i === rules.length - 1}
                    onClick={() => run({ section: 'rrp', action: 'down', id: r.id })}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    className={iconBtn}
                    disabled={busy}
                    onClick={() =>
                      run({
                        section: 'rrp',
                        action: 'update',
                        id: r.id,
                        values: { name: r.name, keywords: r.keywords, rrp: toPounds(r.rrpPence), low: toPounds(r.lowPence), enabled: !r.enabled },
                      })
                    }
                    aria-label={r.enabled ? 'Turn off' : 'Turn on'}
                    title={r.enabled ? 'Turn off' : 'Turn on'}
                  >
                    {r.enabled ? '●' : '○'}
                  </button>
                  <button className={iconBtn} onClick={() => setEditing(r.id)} aria-label="Edit">
                    ✎
                  </button>
                  <button
                    className={`${iconBtn} hover:text-rose-600`}
                    disabled={busy}
                    onClick={() => window.confirm(`Remove “${r.name}” from the RRP table?`) && run({ section: 'rrp', action: 'delete', id: r.id })}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>

      {adding ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          <RuleForm busy={busy} submitLabel="Add" onCancel={() => setAdding(false)} onSubmit={(v) => run({ section: 'rrp', action: 'create', values: v }, () => setAdding(false))} />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className={primary} onClick={() => setAdding(true)}>
            + Add an item
          </button>
          <button
            className={ghost}
            disabled={busy}
            onClick={() => window.confirm('Replace the whole RRP table with the original list?') && run({ section: 'rrp', action: 'reset' })}
          >
            Reset to defaults
          </button>
        </div>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

// ---------------- Sources ----------------

export type FeedRow = { id: string; name: string; url: string; kind: string; page: string; enabled: boolean };

const PAGE_LABEL: Record<string, string> = { online: 'Product drops', 'in-store': 'In store', auto: 'Either (decided per post)' };

/** Show Bing searches as their search words rather than the full feed URL. */
function describeUrl(url: string) {
  try {
    const u = new URL(url);
    if (/bing\.com$/.test(u.hostname) && u.searchParams.get('q')) return `Web search: “${u.searchParams.get('q')}”`;
    return u.hostname + u.pathname;
  } catch {
    return url;
  }
}

function FeedForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
  busy,
}: {
  initial?: FeedRow;
  onSubmit: (v: { name: string; url: string; page: string; kind: string; enabled: boolean }) => void;
  onCancel?: () => void;
  submitLabel: string;
  busy: boolean;
}) {
  const [v, setV] = useState({
    name: initial?.name ?? '',
    url: initial?.url ?? '',
    page: initial?.page ?? 'online',
    kind: initial?.kind ?? 'news',
    enabled: initial?.enabled ?? true,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
      className="flex flex-col gap-2"
    >
      <input className={input} placeholder="Name, e.g. Web: Argos Pokémon" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <input
        className={input}
        placeholder="RSS feed link — or just search words, e.g. pokemon cards argos"
        value={v.url}
        onChange={(e) => setV({ ...v, url: e.target.value })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${input} w-auto`} value={v.page} onChange={(e) => setV({ ...v, page: e.target.value })}>
          <option value="online">Goes to Product drops</option>
          <option value="in-store">Goes to In store</option>
          <option value="auto">Either (decided per post)</option>
        </select>
        <select className={`${input} w-auto`} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
          <option value="news">News: only release/stock posts</option>
          <option value="deal">Deals: every Pokémon card post</option>
        </select>
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <button type="button" className={ghost} onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" disabled={busy} className={primary}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

export function SourcesEditor({ feeds }: { feeds: FeedRow[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { busy, error, run } = useSaver();

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {feeds.map((f, i) => (
          <li key={f.id} className={`p-3 ${f.enabled ? '' : 'opacity-50'}`}>
            {editing === f.id ? (
              <FeedForm
                initial={f}
                busy={busy}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={(v) => run({ section: 'feeds', action: 'update', id: f.id, values: v }, () => setEditing(null))}
              />
            ) : (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{f.name}</p>
                  <p className="truncate text-[11px] text-zinc-500">{describeUrl(f.url)}</p>
                  <p className="text-[11px] text-zinc-500">
                    {PAGE_LABEL[f.page] ?? f.page} · {f.kind === 'deal' ? 'all Pokémon card posts' : 'release/stock posts only'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <button className={iconBtn} disabled={busy || i === 0} onClick={() => run({ section: 'feeds', action: 'up', id: f.id })} aria-label="Move up">
                    ↑
                  </button>
                  <button
                    className={iconBtn}
                    disabled={busy || i === feeds.length - 1}
                    onClick={() => run({ section: 'feeds', action: 'down', id: f.id })}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    className={iconBtn}
                    disabled={busy}
                    onClick={() => run({ section: 'feeds', action: 'update', id: f.id, values: { ...f, enabled: !f.enabled } })}
                    aria-label={f.enabled ? 'Turn off' : 'Turn on'}
                    title={f.enabled ? 'Turn off' : 'Turn on'}
                  >
                    {f.enabled ? '●' : '○'}
                  </button>
                  <button className={iconBtn} onClick={() => setEditing(f.id)} aria-label="Edit">
                    ✎
                  </button>
                  <button
                    className={`${iconBtn} hover:text-rose-600`}
                    disabled={busy}
                    onClick={() => window.confirm(`Remove the source “${f.name}”?`) && run({ section: 'feeds', action: 'delete', id: f.id })}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          <FeedForm busy={busy} submitLabel="Add" onCancel={() => setAdding(false)} onSubmit={(v) => run({ section: 'feeds', action: 'create', values: v }, () => setAdding(false))} />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className={primary} onClick={() => setAdding(true)}>
            + Add a source
          </button>
          <button
            className={ghost}
            disabled={busy}
            onClick={() => window.confirm('Replace all sources with the original list?') && run({ section: 'feeds', action: 'reset' })}
          >
            Reset to defaults
          </button>
        </div>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
