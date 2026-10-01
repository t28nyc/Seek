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
  nonUkWords: string;
  requireUkMention: boolean;
};

const OLD_PRIORITY_DEFAULT = 'perfect order, nihil zero, paradox rift, prismatic evolutions, destined rivals';
const PRIORITY_DEFAULT = [
  // everything Pokémon (remove this to make only the items below a priority)
  'pokemon',
  // product types
  'elite trainer box', 'etb', 'booster box', 'booster display', 'booster bundle', 'booster pack', 'premium collection',
  'super premium collection', 'ultra premium collection', 'pokemon center',
  // sets
  'perfect order', 'nihil zero', 'delta reign', 'chaos rising', '30th celebration', 'mega evolution', 'phantasmal flames',
  'paradox rift', 'prismatic evolutions', 'destined rivals', 'journey together', 'surging sparks', 'black bolt', 'white flare',
].join(', ');

export const DEFAULT_SETTINGS: GeneralSettings = {
  checkHotMin: 5,
  checkInStockMin: 10,
  checkNormalMin: 20,
  checkScannedMin: 120,
  rescanShopsMin: 30,
  priorityKeywords: PRIORITY_DEFAULT,
  excludeFromScans:
    'event, ticket, tournament, league, sleeves, playmat, deck box, toploader, portfolio, 9 pocket, 4 pocket, card binder, plush, figure, t shirt, hoodie, mug, keyring, poster',
  inStoreExclude:
    'event, game night, league, tournament, prerelease, pre release, championship, play day, cup, challenge, ticket, booking, meetup',
  dropsKeepDays: 30,
  rrpForJapanese: false,
  nonUkWords:
    'target, walmart, gamestop, best buy, costco wholesale, sams club, meijer, kroger, barnes noble, walgreens, cvs, dollar general, five below, usa, united states, us release, america, american, canada, australia, eb games, jb hi fi, kmart, big w, dollar tree, toys r us canada',
  requireUkMention: true,
};

export const SETTING_LABELS: Record<keyof GeneralSettings, { label: string; help: string; unit?: string }> = {
  checkHotMin: { label: 'Check priority products every', help: 'Out-of-stock products matching the priority keywords.', unit: 'min' },
  checkInStockMin: { label: 'Check in-stock products every', help: 'To spot them selling out.', unit: 'min' },
  checkNormalMin: { label: 'Check other products every', help: 'Out-of-stock links you added.', unit: 'min' },
  checkScannedMin: { label: 'Check products found by scanning every', help: 'From sitemaps and category pages (Shopify shops are covered by the rescan).', unit: 'min' },
  rescanShopsMin: { label: 'Rescan Shopify shops every', help: 'Reads the whole catalogue again, with stock and prices.', unit: 'min' },
  priorityKeywords: {
    label: 'Priority keywords',
    help: 'Products whose names contain any of these are checked most often and listed first. Comma-separated. “pokemon” makes every product a priority — remove it to focus on the sets and product types listed.',
  },
  excludeFromScans: { label: 'Leave out of website scans', help: 'Products containing any of these phrases are skipped (accessories, tickets…). Comma-separated.' },
  inStoreExclude: { label: 'Hide from In store', help: 'In store shows releases only; items mentioning any of these are hidden. Comma-separated.' },
  dropsKeepDays: { label: 'Keep drops and news for', help: 'Older posts drop off the pages.', unit: 'days' },
  rrpForJapanese: { label: 'Use the RRP table for Japanese products', help: 'Off by default — Japanese products have different prices.' },
  requireUkMention: {
    label: 'Only keep web news that’s clearly about the UK',
    help: 'On: news from web searches and global sites is kept only if it mentions the UK, £ or a UK shop, or comes from a UK website. UK sources (HotUKDeals, Poké Tracker, UK shops) are always kept.',
  },
  nonUkWords: {
    label: 'Not-UK words',
    help: 'Drop and in-store posts mentioning these (or $/€ prices) are left out unless they also mention the UK or £. Comma-separated.',
  },
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
  // One-off upgrade: the original short priority list becomes the fuller default.
  const stored = rows.find((r) => r.key === 'priorityKeywords');
  if (!stored || stored.value === JSON.stringify(OLD_PRIORITY_DEFAULT)) {
    value.priorityKeywords = PRIORITY_DEFAULT;
    if (!rows.some((r) => r.key === 'migrated.priority2')) {
      await prisma.setting.upsert({
        where: { key: 'migrated.priority2' },
        update: { value: 'true' },
        create: { key: 'migrated.priority2', value: 'true' },
      });
      await recomputePriorities(PRIORITY_DEFAULT);
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
    // Titles can be written "Pokémon" or "Pokemon": match either spelling of each word.
    const variants = (w: string) => [...new Set([w, w.replace(/pokemon/g, 'pokémon')])];
    await prisma.trackedUrl.updateMany({
      where: { AND: words.map((w) => ({ OR: variants(w).map((v) => ({ title: { contains: v, mode: 'insensitive' as const } })) })) },
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

/** UK high-street chains that sell Pokémon cards — used for In store searches and to spot in-store posts. */
export const UK_STORES = [
  'Tesco', 'Smyths', 'TG Jones', 'WHSmith', 'Morrisons', 'Asda', "Sainsbury's", 'Aldi', 'Lidl', 'Argos', 'GAME',
  'The Entertainer', 'B&M', 'Home Bargains', 'The Range', 'Card Factory', 'Toys R Us', 'Hamleys', 'HMV', 'Forbidden Planet',
  'Costco', 'Co-op', 'Iceland', 'Poundland', 'Wilko', 'John Lewis', "McDonald's",
];

type FeedDefault = { name: string; url: string; kind: 'deal' | 'news'; page: 'online' | 'in-store' | 'auto' };

export const DEFAULT_FEEDS: FeedDefault[] = [
  // UK deals forum — every Pokémon card post is UK and relevant
  { name: 'HotUKDeals', url: 'https://www.hotukdeals.com/rss/tag/pokemon', kind: 'deal', page: 'auto' },
  // UK stock tracker's news section (a page of headlines, read like a feed)
  { name: 'Poké Tracker (UK news)', url: 'https://poketracker.co.uk/pokestop', kind: 'news', page: 'auto' },
  // TCG news (global — only posts that mention the UK are kept)
  { name: 'PokeBeach', url: 'https://www.pokebeach.com/feed', kind: 'news', page: 'auto' },
  // Web news searches, UK edition
  { name: 'Web: pre-orders', url: bing('pokemon tcg pre-order uk'), kind: 'news', page: 'online' },
  { name: 'Web: restocks', url: bing('pokemon cards restock uk'), kind: 'news', page: 'online' },
  { name: 'Web: new sets', url: bing('pokemon tcg new set release date uk'), kind: 'news', page: 'auto' },
  { name: 'Web: Pokémon Center', url: bing('pokemon center uk pre-orders'), kind: 'news', page: 'online' },
  { name: 'Web: rumours & leaks', url: bing('pokemon cards uk rumour OR leak OR spotted'), kind: 'news', page: 'auto' },
  // In store: one search per group of high-street chains, so each chain's news is found
  { name: 'In store: Tesco', url: bing('pokemon cards tesco'), kind: 'deal', page: 'in-store' },
  { name: 'In store: Smyths', url: bing('pokemon cards smyths'), kind: 'deal', page: 'in-store' },
  { name: 'In store: TG Jones / WHSmith', url: bing('pokemon cards "tg jones" OR whsmith'), kind: 'deal', page: 'in-store' },
  { name: 'In store: Morrisons', url: bing('pokemon cards morrisons'), kind: 'deal', page: 'in-store' },
  { name: 'In store: Asda', url: bing('pokemon cards asda'), kind: 'deal', page: 'in-store' },
  { name: "In store: Sainsbury's", url: bing("pokemon cards sainsbury's"), kind: 'deal', page: 'in-store' },
  { name: 'In store: Aldi / Lidl', url: bing('pokemon cards aldi OR lidl'), kind: 'deal', page: 'in-store' },
  { name: 'In store: Argos', url: bing('pokemon cards argos'), kind: 'deal', page: 'in-store' },
  { name: 'In store: B&M / Home Bargains', url: bing('pokemon cards "b&m" OR "home bargains" OR "the range"'), kind: 'deal', page: 'in-store' },
  { name: 'In store: The Entertainer / GAME', url: bing('pokemon cards "the entertainer" OR "game stores"'), kind: 'deal', page: 'in-store' },
  { name: 'In store: supermarkets', url: bing('pokemon cards supermarket uk'), kind: 'deal', page: 'in-store' },
  { name: "In store: McDonald's", url: bing("pokemon cards mcdonald's happy meal uk"), kind: 'deal', page: 'in-store' },
  { name: 'In store: release day', url: bing('pokemon tcg release day shops uk'), kind: 'news', page: 'in-store' },
];

export async function getFeeds(includeDisabled = false) {
  await seedOnce('seeded.feeds', () =>
    prisma.feedSource.createMany({ data: DEFAULT_FEEDS.map((f, i) => ({ ...f, sortOrder: i })), skipDuplicates: true }),
  );
  // One-off: make the original web searches UK-specific.
  await seedOnce('migrated.feeds.uk', async () => {
    for (const [from, to] of [
      ['pokemon tcg pre-order', 'pokemon tcg pre-order uk'],
      ['pokemon tcg new set release date', 'pokemon tcg new set release date uk'],
      ['pokemon center tcg pre-orders', 'pokemon center uk pre-orders'],
    ]) {
      await prisma.feedSource.updateMany({ where: { url: bing(from) }, data: { url: bing(to) } }).catch(() => null);
    }
  });
  // One-off: add the new UK in-store and rumour sources to existing lists (sources you removed aren't re-added
  // because this only runs once; your other sources are untouched). The old combined searches are retired.
  await seedOnce('migrated.feeds.instore2', async () => {
    const existing = await prisma.feedSource.count();
    await prisma.feedSource.deleteMany({
      where: { url: { in: [bing('pokemon cards smyths OR argos OR tesco OR asda OR game'), bing('pokemon cards in stores uk')] } },
    });
    await prisma.feedSource.createMany({
      data: DEFAULT_FEEDS.map((f, i) => ({ ...f, sortOrder: existing + i })),
      skipDuplicates: true,
    });
  });
  return prisma.feedSource.findMany({
    where: includeDisabled ? {} : { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}
