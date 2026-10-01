import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { SiteNav } from '@/components/site-nav';
import { RefreshButton } from '@/components/refresh-button';

export const metadata: Metadata = {
  title: 'Peek — Pokémon TCG stock',
  description: 'Stock, prices vs RRP, in-store releases and product drops for Pokémon TCG.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#09090b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-50">
        <header className="sticky top-0 z-30 bg-zinc-950/95 text-white backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-col gap-2 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:flex-row sm:items-center sm:gap-4 sm:px-6 sm:py-3">
            <div className="flex items-center justify-between sm:contents">
              <Link href="/" className="flex items-center gap-2 text-xl font-black tracking-tight">
                <span className="inline-block size-6 rounded-full bg-[linear-gradient(to_bottom,#ef4444_50%,#fff_50%)] [box-shadow:inset_0_0_0_2px_#18181b]" />
                Peek
              </Link>
              <div className="flex items-center gap-2 sm:order-last sm:ml-auto">
                <RefreshButton />
                <Link
                  href="/settings"
                  aria-label="Settings"
                  title="Settings"
                  className="flex size-10 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20"
                >
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </Link>
              </div>
            </div>
            <SiteNav />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
