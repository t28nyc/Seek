import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getFeeds, getRrpRules, getSettings, SETTING_LABELS, type GeneralSettings } from '@/lib/settings';
import { GeneralSettingsForm, RrpTableEditor, SourcesEditor } from '@/components/settings-editors';
import { ShopsEditor } from '@/components/shops-editor';
import { ensureStarterShops } from '@/lib/scraper/shops';
import { timeAgo } from '@/lib/format';
import { bareHost } from '@/lib/host';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Settings — Seek' };

const TABS = [
  { id: 'rrp', label: 'RRP table' },
  { id: 'sources', label: 'Sources' },
  { id: 'checking', label: 'Checking & keywords' },
  { id: 'websites', label: 'Shops' },
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
        Where Seek looks for product drops and in-store releases — checked every 30 minutes and on Refresh. Add an RSS feed
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
  await ensureStarterShops();
  const shops = await prisma.shop.findMany({ where: { status: { not: 'removed' } }, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
  // Two grouped queries for all shops (rather than two per shop).
  const [all, inStock] = await Promise.all([
    prisma.trackedUrl.groupBy({ by: ['host'], where: { active: true }, _count: { _all: true } }),
    prisma.trackedUrl.groupBy({ by: ['host'], where: { active: true, status: 'IN_STOCK' }, _count: { _all: true } }),
  ]);
  const allBy = new Map(all.map((g) => [g.host, g._count._all]));
  const stockBy = new Map(inStock.map((g) => [g.host, g._count._all]));
  const counts = shops.map((s) => [allBy.get(bareHost(s.host)) ?? 0, stockBy.get(bareHost(s.host)) ?? 0]);
  const how: Record<string, string> = {
    shopify: 'Shopify catalogue',
    listing: 'category pages',
    sitemap: 'sitemap',
    auto: 'not checked yet',
  };
  const order: Record<string, number> = { active: 0, checking: 1, unreadable: 2, 'not-uk': 3 };
  const rows = shops
    .map((s, i) => ({
      id: s.id,
      name: s.name,
      host: s.host,
      status: s.status,
      enabled: s.enabled,
      origin: s.origin,
      how: how[s.platform] ?? s.platform,
      products: counts[i][0],
      inStock: counts[i][1],
      lastScan: s.lastScannedAt ? timeAgo(s.lastScannedAt) : 'not yet',
      error: s.status === 'active' ? null : s.lastError,
    }))
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.inStock - a.inStock || b.products - a.products);
  return (
    <>
      <Intro>
        UK shops Seek polls for Pokémon products. New shops are checked first: they must price in pounds and Seek must be able
        to read their products (respecting each site’s robots.txt). The list starts with shops from UK buying guides; “Find
        more UK shops” searches the web for others, and it runs automatically once a week.
      </Intro>
      <ShopsEditor shops={rows} />
    </>
  );
}
