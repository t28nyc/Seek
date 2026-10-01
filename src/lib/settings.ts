/**
 * Everything editable on the Settings page: general settings (key/value),
 * the RRP table and the web sources for Product drops / In store.
 * Defaults live here and are written to the database the first time they're read.
 */
import { prisma } from './db';

import { matchesAny, phraseMatches, splitList, tokens } from './match';
export { matchesAny, matchRrpRule, phraseMatches, splitList, tokens, type RrpRuleLike } from './match';

// ---------- General settings ----------

export type GeneralSettings = {
  checkHotMin: number;
  checkInStockMin: number;
  checkNormalMin: number;
  checkScannedMin: number;
  rescanShopsMin: number;
  priorityKeywords: string;
  excludeFromScans: string;
  inStoreExclude: string;
  dropsKeepDays: number;
  rrpForJapanese: boolean;
};

export const DEFAULT_SETTINGS: GeneralSettings = {
  checkHotMin: 5,
  checkInStockMin: 10,
  checkNormalMin: 20,
  checkScannedMin: 120,
  rescanShopsMin: 30,
  priorityKeywords: 'perfect order, nihil zero, paradox rift, prismatic evolutions, destined rivals',
  excludeFromScans:
    'event, ticket, tournament, league, sleeves, playmat, deck box, toploader, portfolio, 9 pocket, 4 pocket, card binder, plush, figure, t shirt, hoodie, mug, keyring, poster',
  inStoreExclude:
    'event, game night, league, tournament, prerelease, pre release, championship, play day, cup, challenge, ticket, booking, meetup',
  dropsKeepDays: 30,
  rrpForJapanese: false,
};

export const SETTING_LABELS: Record<keyof GeneralSettings, { label: string; help: string; unit?: string }> = {
  checkHotMin: { label: 'Check priority products every', help: 'Out-of-stock products matching the priority keywords.', unit: 'min' },
  checkInStockMin: { label: 'Check in-stock products every', help: 'To spot them selling out.', unit: 'min' },
  checkNormalMin: { label: 'Check other products every', help: 'Out-of-stock links you added.', unit: 'min' },
  checkScannedMin: { label: 'Check products found by scanning every', help: 'From sitemaps and category pages (Shopify shops are covered by the rescan).', unit: 'min' },
  rescanShopsMin: { label: 'Rescan Shopify shops every', help: 'Reads the whole catalogue again, with stock and prices.', unit: 'min' },
  priorityKeywords: { label: 'Priority keywords', help: 'Products whose names contain any of these are checked most often. Comma-separated.' },
  excludeFromScans: { label: 'Leave out of website scans', help: 'Products containing any of these phrases are skipped (accessories, tickets…). Comma-separated.' },
  inStoreExclude: { label: 'Hide from In store', help: 'In store shows releases only; items mentioning any of these are hidden. Comma-separated.' },
  dropsKeepDays: { label: 'Keep drops and news for', help: 'Older posts drop off the pages.', unit: 'days' },
  rrpForJapanese: { label: 'Use the RRP table for Japanese products', help: 'Off by default — Japanese products have different prices.' },
};

let cache: { at: number; value: GeneralSettings } | null = null;

export async function getSettings(): Promise<GeneralSettings> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const rows = await prisma.setting.findMany();
  const value = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (!(r.key in DEFAULT_SETTINGS)) continue;
    try {
      (value as Record<string, unknown>)[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore bad value */
    }
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Validate and save general settings; returns the saved values. */
export async function saveSettings(input: Record<string, unknown>): Promise<GeneralSettings> {
  const current = await getSettings();
  const next = { ...current };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GeneralSettings)[]) {
    if (!(key in input)) continue;
    const def = DEFAULT_SETTINGS[key];
    const v = input[key];
    if (typeof def === 'number') {
      const n = Math.round(Number(v));
      if (Number.isFinite(n)) (next as Record<string, unknown>)[key] = Math.min(Math.max(n, key.startsWith('check') ? 5 : 1), 10_080);
    } else if (typeof def === 'boolean') {
      (next as Record<string, unknown>)[key] = v === true || v === 'true' || v === 'on';
    } else if (typeof v === 'string') {
      (next as Record<string, unknown>)[key] = splitList(v.slice(0, 2_000)).join(', ');
    }
  }
  await prisma.$transaction(
    (Object.keys(next) as (keyof GeneralSettings)[]).map((key) =>
      prisma.setting.upsert({
        where: { key },
        update: { value: JSON.stringify(next[key]) },
        create: { key, value: JSON.stringify(next[key]) },
      }),
    ),
  );
  cache = { at: Date.now(), value: next };
  if (next.priorityKeywords !== current.priorityKeywords) await recomputePriorities(next.priorityKeywords);
  return next;
}

export function isPriorityTitle(title: string | null | undefined, s: GeneralSettings): boolean {
  return !!title && matchesAny(title, s.priorityKeywords);
}

/** Re-flag which products are "priority" after the keyword list changes. */
async function recomputePriorities(keywords: string) {
  await prisma.trackedUrl.updateMany({ where: { priority: { gt: 0 } }, data: { priority: 0 } });
  for (const phrase of splitList(keywords)) {
    const words = tokens(phrase);
    if (!words.length) continue;
    await prisma.trackedUrl.updateMany({
      where: { AND: words.map((w) => ({ title: { contains: w, mode: 'insensitive' as const } })) },
      data: { priority: 1 },
    });
  }
}

// ---------- Seed-once helper ----------

async function seedOnce(flag: string, seed: () => Promise<unknown>) {
  const done = await prisma.setting.findUnique({ where: { key: flag } });
  if (done) return;
  await seed();
  await prisma.setting.upsert({ where: { key: flag }, update: { value: 'true' }, create: { key: flag, value: 'true' } });
}

// ---------- RRP table ----------

/** Starting RRP table (UK). RRP = top of the usual range; edit on the Settings page. Order matters: first match wins. */
export const DEFAULT_RRP_RULES: { name: string; keywords: string; rrpPence: number; lowPence?: number }[] = [
  { name: 'Pokémon Center Exclusive Elite Trainer Box', keywords: 'pokemon center elite trainer, pokemon centre elite trainer, pokemon center etb, pokemon centre etb', rrpPence: 5699, lowPence: 5499 },
  { name: 'Elite Trainer Box (ETB)', keywords: 'elite trainer, etb', rrpPence: 4999 },
  // Not in the original list: half of the 36-pack box price — edit if you have a better figure.
  { name: 'Half Booster Box (18 Packs)', keywords: 'half booster box, 18 pack, 18 booster', rrpPence: 7182 },
  { name: 'Booster Box (36 Packs)', keywords: 'booster box, booster display, display box, 36 pack, 36 booster', rrpPence: 14364 },
  { name: 'Booster Bundle (6 Packs)', keywords: 'booster bundle', rrpPence: 2599, lowPence: 2394 },
  { name: 'Binder Collection', keywords: 'binder collection', rrpPence: 2999 },
  { name: 'Tech Sticker Collection', keywords: 'tech sticker', rrpPence: 1599 },
  { name: '3-Pack Blister', keywords: '3 pack, three pack, 3 booster', rrpPence: 1699, lowPence: 1399 },
  { name: 'Checklane / 1-Pack Blister', keywords: 'checklane, blister', rrpPence: 699, lowPence: 649 },
  { name: 'Mini Tin', keywords: 'mini tin', rrpPence: 1099, lowPence: 899 },
  { name: 'Standard Tin', keywords: 'tin', rrpPence: 1999 },
  { name: 'Sleeved Booster Pack', keywords: 'sleeved booster', rrpPence: 429 },
  { name: 'Single Booster Pack', keywords: 'booster pack, booster', rrpPence: 429, lowPence: 399 },
];

export async function getRrpRules(includeDisabled = false) {
  await seedOnce('seeded.rrpRules', () =>
    prisma.rrpRule.createMany({ data: DEFAULT_RRP_RULES.map((r, i) => ({ ...r, sortOrder: i })) }),
  );
  return prisma.rrpRule.findMany({
    where: includeDisabled ? {} : { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

// ---------- Web sources for drops / in store ----------

export const bing = (q: string) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&mkt=en-GB`;

export const DEFAULT_FEEDS: { name: string; url: string; kind: 'deal' | 'news'; page: 'online' | 'in-store' | 'auto' }[] = [
  { name: 'HotUKDeals', url: 'https://www.hotukdeals.com/rss/tag/pokemon', kind: 'deal', page: 'auto' },
  { name: 'PokeBeach', url: 'https://www.pokebeach.com/feed', kind: 'news', page: 'auto' },
  { name: 'Web: pre-orders', url: bing('pokemon tcg pre-order'), kind: 'news', page: 'online' },
  { name: 'Web: restocks', url: bing('pokemon cards restock uk'), kind: 'news', page: 'online' },
  { name: 'Web: new sets', url: bing('pokemon tcg new set release date'), kind: 'news', page: 'auto' },
  { name: 'Web: Pokémon Center', url: bing('pokemon center tcg pre-orders'), kind: 'news', page: 'online' },
  { name: 'Web: in stores', url: bing('pokemon cards in stores uk'), kind: 'news', page: 'in-store' },
  { name: 'Web: UK shops', url: bing('pokemon cards smyths OR argos OR tesco OR asda OR game'), kind: 'news', page: 'in-store' },
  { name: 'Web: release day', url: bing('pokemon tcg release day shops uk'), kind: 'news', page: 'in-store' },
];

export async function getFeeds(includeDisabled = false) {
  await seedOnce('seeded.feeds', () =>
    prisma.feedSource.createMany({ data: DEFAULT_FEEDS.map((f, i) => ({ ...f, sortOrder: i })), skipDuplicates: true }),
  );
  return prisma.feedSource.findMany({
    where: includeDisabled ? {} : { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}
