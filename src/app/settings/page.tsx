import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getFeeds, getRrpRules, getSettings, SETTING_LABELS, type GeneralSettings } from '@/lib/settings';
import { GeneralSettingsForm, RrpTableEditor, SourcesEditor } from '@/components/settings-editors';
import { timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Settings — Peek' };

function Section({ id, title, intro, children }: { id: string; title: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-base font-bold">{title}</h2>
      <p className="mb-4 mt-1 text-sm text-zinc-500">{intro}</p>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const [settings, rules, feeds, shops] = await Promise.all([
    getSettings(),
    getRrpRules(true),
    getFeeds(true),
    prisma.shop.findMany({ orderBy: { name: 'asc' } }),
  ]);

  const fields = (Object.keys(SETTING_LABELS) as (keyof GeneralSettings)[]).map((key) => ({
    key,
    ...SETTING_LABELS[key],
    value: settings[key],
  }));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
      <div>
        <h1 className="text-lg font-bold">Settings</h1>
        <nav className="mt-2 flex flex-wrap gap-2 text-xs">
          {[
            ['#rrp', 'RRP table'],
            ['#sources', 'Drop & in-store sources'],
            ['#checking', 'Checking & keywords'],
            ['#websites', 'Websites'],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-full bg-white px-3 py-1.5 font-medium ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              {label}
            </a>
          ))}
        </nav>
      </div>

      <Section
        id="rrp"
        title="RRP table"
        intro={
          <>
            Used for the RRP when nothing better is found (your own RRP, an RRP printed on a shop’s page, or the Pokémon Center
            price come first). Each product gets the <strong>first</strong> row whose keywords match its name — keep specific
            rows (like “Mini Tin”) above general ones (like “Tin”).
          </>
        }
      >
        <RrpTableEditor
          rules={rules.map((r) => ({
            id: r.id,
            name: r.name,
            keywords: r.keywords,
            rrpPence: r.rrpPence,
            lowPence: r.lowPence,
            enabled: r.enabled,
          }))}
        />
      </Section>

      <Section
        id="sources"
        title="Drop & in-store sources"
        intro="Where Peek looks for product drops and in-store releases, checked every 30 minutes and on Refresh. Add an RSS feed link, or just type search words to add a web search."
      >
        <SourcesEditor
          feeds={feeds.map((f) => ({ id: f.id, name: f.name, url: f.url, kind: f.kind, page: f.page, enabled: f.enabled }))}
        />
      </Section>

      <Section
        id="checking"
        title="Checking & keywords"
        intro="How often things are checked, what counts as a priority, and what’s left out. Checks can’t run more often than every 5 minutes (the scheduler’s limit)."
      >
        <GeneralSettingsForm fields={fields} />
      </Section>

      <Section
        id="websites"
        title="Websites"
        intro={
          <>
            Websites Peek scans for Pokémon products. Add one by pasting its homepage or category page on the{' '}
            <Link href="/" className="underline">
              Online page
            </Link>
            ; remove one from the “Websites Peek scans” panel there.
          </>
        }
      >
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {shops.map((s) => (
            <li key={s.id} className={`flex items-center justify-between gap-3 py-2 ${s.enabled ? '' : 'opacity-50'}`}>
              <span className="min-w-0 truncate">
                {s.name} <span className="text-xs text-zinc-500">· {s.collection ? 'part of site' : 'whole site'}</span>
              </span>
              <span className="shrink-0 text-xs text-zinc-500">
                {s.enabled ? `${s.productsFound} products · ${s.lastScannedAt ? timeAgo(s.lastScannedAt) : 'not scanned yet'}` : 'removed'}
              </span>
            </li>
          ))}
          {!shops.length && <li className="py-2 text-zinc-500">None yet.</li>}
        </ul>
      </Section>
    </main>
  );
}
