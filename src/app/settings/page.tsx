import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getFeeds, getRrpRules, getSettings, SETTING_LABELS, type GeneralSettings } from '@/lib/settings';
import { GeneralSettingsForm, RrpTableEditor, SourcesEditor } from '@/components/settings-editors';
import { timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Settings — Peek' };

const TABS = [
  { id: 'rrp', label: 'RRP table' },
  { id: 'sources', label: 'Sources' },
  { id: 'checking', label: 'Checking & keywords' },
  { id: 'websites', label: 'Websites' },
] as const;
type TabId = (typeof TABS)[number]['id'];

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const requested = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : 'rrp';

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
      <h1 className="text-lg font-bold">Settings</h1>

      <nav aria-label="Settings sections" className="-mx-3 flex gap-1 overflow-x-auto border-b border-zinc-200 px-3 [scrollbar-width:none] dark:border-zinc-800">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/settings?tab=${t.id}`}
            scroll={false}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
              tab === t.id
                ? 'border-zinc-900 text-zinc-900 dark:border-white dark:text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {tab === 'rrp' && <RrpTab />}
        {tab === 'sources' && <SourcesTab />}
        {tab === 'checking' && <CheckingTab />}
        {tab === 'websites' && <WebsitesTab />}
      </section>
    </main>
  );
}

function Intro({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm text-zinc-500">{children}</p>;
}

async function RrpTab() {
  const rules = await getRrpRules(true);
  return (
    <>
      <Intro>
        Used for the RRP when nothing better is found (your own RRP, an RRP printed on a shop’s page, or the Pokémon Center
        price come first). Each product gets the <strong>first</strong> row whose words all appear in its name — keep specific
        rows (like “Mini Tin”) above general ones (like “Tin”). Price comparisons use the top of the range.
      </Intro>
      <RrpTableEditor
        rules={rules.map((r) => ({ id: r.id, name: r.name, keywords: r.keywords, rrpPence: r.rrpPence, lowPence: r.lowPence, enabled: r.enabled }))}
      />
    </>
  );
}

async function SourcesTab() {
  const feeds = await getFeeds(true);
  return (
    <>
      <Intro>
        Where Peek looks for product drops and in-store releases — checked every 30 minutes and on Refresh. Add an RSS feed
        link, or just type search words to add a web search.
      </Intro>
      <SourcesEditor feeds={feeds.map((f) => ({ id: f.id, name: f.name, url: f.url, kind: f.kind, page: f.page, enabled: f.enabled }))} />
    </>
  );
}

async function CheckingTab() {
  const settings = await getSettings();
  const fields = (Object.keys(SETTING_LABELS) as (keyof GeneralSettings)[]).map((key) => ({
    key,
    ...SETTING_LABELS[key],
    value: settings[key],
  }));
  return (
    <>
      <Intro>
        How often things are checked, what counts as a priority, and what’s left out. Nothing can be checked more often than
        every 5 minutes (the scheduler’s limit).
      </Intro>
      <GeneralSettingsForm fields={fields} />
    </>
  );
}

async function WebsitesTab() {
  const shops = await prisma.shop.findMany({ orderBy: { name: 'asc' } });
  return (
    <>
      <Intro>
        Websites Peek scans for Pokémon products. Add one by pasting its homepage or category page on the{' '}
        <Link href="/" className="underline">
          Online page
        </Link>
        ; remove one from the “Websites Peek scans” panel there.
      </Intro>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="py-2 pr-3 font-semibold">Website</th>
              <th className="py-2 pr-3 font-semibold">Scans</th>
              <th className="py-2 pr-3 text-right font-semibold">Products</th>
              <th className="py-2 font-semibold">Last scan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {shops.map((s) => (
              <tr key={s.id} className={s.enabled ? '' : 'opacity-50'}>
                <td className="py-2 pr-3">{s.name}</td>
                <td className="py-2 pr-3 text-zinc-500">
                  {!s.enabled ? 'removed' : s.platform === 'listing' ? 'category page' : s.collection ? `“${s.collection}”` : 'whole site'}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{s.productsFound}</td>
                <td className="py-2 text-zinc-500">{s.lastError ?? (s.lastScannedAt ? timeAgo(s.lastScannedAt) : 'not yet')}</td>
              </tr>
            ))}
            {!shops.length && (
              <tr>
                <td colSpan={4} className="py-3 text-zinc-500">
                  None yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
