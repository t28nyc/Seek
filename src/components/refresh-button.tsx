'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Starts a background refresh (products, websites, drop feeds), then reloads
 * the page's data a few times while results come in. The button is free
 * again after a moment; a small note shows that work is happening.
 */
export function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'starting' | 'running'>('idle');
  const [note, setNote] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  async function refresh() {
    setState('starting');
    const res = await fetch('/api/refresh', { method: 'POST' })
      .then((r) => r.json() as Promise<{ started: boolean; links?: number; sites?: number; message?: string }>)
      .catch(() => null);

    if (!res) {
      setState('idle');
      setNote('Couldn’t start a refresh — try again.');
      return;
    }
    setNote(
      res.started
        ? `Checking ${res.links} link${res.links === 1 ? '' : 's'}, ${res.sites} website${res.sites === 1 ? '' : 's'} and the drop feeds…`
        : (res.message ?? 'Already refreshing'),
    );
    setState('running');
    timers.current.forEach(clearTimeout);
    timers.current = [8_000, 20_000, 40_000, 65_000].map((ms, i, all) =>
      setTimeout(() => {
        router.refresh();
        if (i === all.length - 1) {
          setState('idle');
          setNote('Up to date');
          timers.current.push(setTimeout(() => setNote(null), 5_000));
        }
      }, ms),
    );
  }

  const running = state !== 'idle';
  return (
    <div className="flex items-center gap-2">
      {note && (
        <span role="status" className="max-w-[9rem] truncate text-[11px] text-white/70 sm:max-w-64 sm:text-xs">
          {note}
        </span>
      )}
      <button
        type="button"
        onClick={refresh}
        disabled={state === 'starting'}
        title={note ?? 'Check everything now'}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-yellow-300 px-3 text-sm font-semibold text-zinc-900 transition hover:bg-yellow-200 disabled:opacity-70"
      >
        <svg
          viewBox="0 0 24 24"
          className={`size-4 ${running ? 'animate-spin' : ''}`}
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
        {state === 'starting' ? 'Starting…' : state === 'running' ? 'Updating' : 'Refresh'}
      </button>
    </div>
  );
}
