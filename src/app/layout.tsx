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
              <div className="sm:order-last sm:ml-auto">
                <RefreshButton />
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
