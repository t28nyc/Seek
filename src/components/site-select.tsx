'use client';

import { useRouter } from 'next/navigation';

/** Shop picker for the Online page (a dropdown scales better than chips with dozens of shops). */
export function SiteSelect({ options, value, hrefFor }: { options: { host: string; label: string }[]; value?: string; hrefFor: Record<string, string> }) {
  const router = useRouter();
  return (
    <select
      aria-label="Shop"
      value={value ?? ''}
      onChange={(e) => router.push(hrefFor[e.target.value] ?? '/', { scroll: false })}
      className="min-h-9 min-w-0 max-w-full rounded-full bg-white px-3 text-[13px] font-medium text-zinc-700 ring-1 ring-zinc-200 focus:outline-none dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800"
    >
      <option value="">All shops</option>
      {options.map((o) => (
        <option key={o.host} value={o.host}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
