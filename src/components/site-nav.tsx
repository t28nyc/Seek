'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PAGES = [
  { href: '/', label: 'Online' },
  { href: '/in-store', label: 'In store' },
  { href: '/drops', label: 'Product drops' },
];

export function SiteNav() {
  const path = usePathname();
  return (
    <nav aria-label="Pages" className="grid grid-cols-3 gap-1 rounded-xl bg-white/10 p-1 sm:inline-grid sm:w-auto">
      {PAGES.map((p) => {
        const active = p.href === '/' ? path === '/' : path.startsWith(p.href);
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-10 items-center justify-center rounded-lg px-3 text-sm font-semibold transition ${
              active ? 'bg-white text-zinc-900' : 'text-white/75 hover:bg-white/10 hover:text-white'
            }`}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
