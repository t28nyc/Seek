/**
 * The list of UK shops Seek polls for Pokémon products (Settings → Websites).
 *
 * - A starter list of UK shops known to sell Pokémon TCG (from UK buying guides).
 * - Shops found on the web: links to shops in UK "where to buy" articles,
 *   found through the news searches.
 * - Shops you add.
 *
 * Every new shop is checked before it's polled: it must price in pounds and
 * Seek must be able to read its products (Shopify catalogue, a Pokémon
 * category page, or its sitemap), within the site's robots.txt rules.
 */
import * as cheerio from 'cheerio';
import { prisma } from '../db';
import { storeNameFromHost } from '../retailers';
import { bareHost } from '../host';
import { ukCheck } from '../uk';
import { bing } from '../settings';
import { fetchHtml } from './fetch';
import { crawlListingPage, isPokemonSealed, loadScanSettings, probeShopify, saveFoundUrls, sitemapProductUrls } from './catalog';

type Starter = { host: string; name: string; pages?: string[] };

/**
 * UK shops selling Pokémon TCG, from UK buying guides (Which?, cardcollector.co.uk,
 * poketracker.co.uk, packratt.co.uk) and searches. `pages` = Pokémon category pages
 * for shops that aren't on Shopify. Marketplaces (Amazon, eBay) are left out.
 */
export const STARTER_SHOPS: Starter[] = [
  // Independent card shops (mostly Shopify)
  { host: 'www.gumgumgames.co.uk', name: 'Gum Gum Games' },
  { host: 'www.totalcards.net', name: 'Total Cards' },
  { host: 'gatheringgames.co.uk', name: 'Gathering Games' },
  { host: 'www.doublesleeved.co.uk', name: 'Double Sleeved' },
  { host: 'aftermkt.co.uk', name: 'Aftermkt' },
  { host: 'titancards.co.uk', name: 'Titan Cards' },
  { host: 'pixel-hub.co.uk', name: 'Pixel Hub' },
  { host: 'obsidia-tcg.store', name: 'Obsidia TCG' },
  { host: 'jetcards.uk', name: 'JET Cards' },
  { host: 'www.nxtgentrading.co.uk', name: 'NXT Gen Trading' },
  { host: 'www.cardcatchershop.co.uk', name: 'Card Catcher' },
  { host: 'pokepals.co.uk', name: 'PokePals UK' },
  { host: 'buyanycards.co.uk', name: 'Buy Any Cards' },
  { host: 'bremnertcg.co.uk', name: 'Bremner TCG' },
  { host: 'cosmiccollectables.co.uk', name: 'Cosmic Collectables' },
  { host: 'thecardvault.co.uk', name: 'The Card Vault' },
  { host: 'dansolotcg.co.uk', name: 'Dan Solo TCG' },
  { host: 'diceanddestiny.co.uk', name: 'Dice and Destiny' },
  { host: 'endocollects.co.uk', name: 'Endo Collects' },
  { host: 'hillscards.co.uk', name: 'Hills Cards' },
  { host: 'firestormcards.co.uk', name: 'Firestorm Cards' },
  { host: 'japan2uk.com', name: 'Japan2UK' },
  { host: 'jestergamesstore.com', name: 'Jester Games' },
  { host: 'loadeddice.uk', name: 'Loaded Dice' },
  { host: 'romulusgames.com', name: 'Romulus Games' },
  { host: 'tabletoprepublic.com', name: 'Tabletop Republic' },
  { host: 'endgameldn.com', name: 'End Game London' },
  { host: 'bagosbreaks.co.uk', name: 'Bagos Breaks' },
  { host: 'tcgshopuk.co.uk', name: 'TCG Shop UK', pages: ['https://tcgshopuk.co.uk/product-category/pokemon-cards-uk/'] },
  { host: 'unicorncards.co.uk', name: 'Unicorn Cards', pages: ['https://unicorncards.co.uk/pokemon-cards'] },
  // Larger card retailers (category pages)
  {
    host: 'www.chaoscards.co.uk',
    name: 'Chaos Cards',
    pages: [
      'https://www.chaoscards.co.uk/shop/card-games/pokemon/elite-trainer-boxes-pokemon',
      'https://www.chaoscards.co.uk/shop/card-games/pokemon/booster-packs-pokemon',
      'https://www.chaoscards.co.uk/shop/card-games/pokemon',
    ],
  },
  {
    host: 'magicmadhouse.co.uk',
    name: 'Magic Madhouse',
    pages: ['https://magicmadhouse.co.uk/pokemon/pokemon-sealed-product/elite-trainer-boxes', 'https://magicmadhouse.co.uk/pokemon'],
  },
  // High-street retailers (often block automated reading — Seek will say so)
  {
    host: 'www.smythstoys.com',
    name: 'Smyths Toys',
    pages: ['https://www.smythstoys.com/uk/en-gb/toys/action-figures-and-playsets/pokemon-toys/pokemon-trading-card-game-tcg/c/SM0601011202'],
  },
  { host: 'www.game.co.uk', name: 'GAME' },
  { host: 'www.argos.co.uk', name: 'Argos' },
  { host: 'www.very.co.uk', name: 'Very' },
  { host: 'www.johnlewis.com', name: 'John Lewis' },
  { host: 'www.hmv.com', name: 'HMV' },
  { host: 'www.theworks.co.uk', name: 'The Works' },
  { host: 'www.zavvi.com', name: 'Zavvi' },
  { host: 'forbiddenplanet.com', name: 'Forbidden Planet' },
];

/** Sites that are never shops worth polling (marketplaces, social, news, wikis…). */
const NOT_SHOPS =
  /(^|\.)(amazon\.|ebay\.|etsy\.|vinted\.|facebook\.|instagram\.|tiktok\.|twitter\.|x\.com|youtube\.|youtu\.be|reddit\.|wikipedia\.|pokemon\.com|bulbapedia|serebii|pokebeach|google\.|apple\.|bing\.|msn\.|bbc\.|which\.co\.uk|hotukdeals|cardmarket|tcgplayer|pricecharting|cardcollector\.co\.uk|poketracker|packratt|radiotimes|independent\.co\.uk|theguardian|dailymail|mirror\.co\.uk|express\.co\.uk|metro\.co\.uk|ign\.com|polygon|eurogamer|gamesradar|techradar|t3\.com|pcgamer|nintendolife|dexerto|thegamer|screenrant|gamerant|cbr\.com|vice\.com|mashable|forbes|businessinsider|trustpilot|linktr\.ee|discord)/i;

export async function ensureStarterShops() {
  // One-off: re-check shops without a .uk domain against the stricter UK rules.
  const recheck = await prisma.setting.findUnique({ where: { key: 'migrated.shops.ukcheck2' } });
  if (!recheck) {
    const shops = await prisma.shop.findMany({ where: { status: 'active' }, select: { id: true, host: true } });
    const ids = shops.filter((s) => !/\.uk$/i.test(s.host)).map((s) => s.id);
    if (ids.length) await prisma.shop.updateMany({ where: { id: { in: ids } }, data: { status: 'checking' } });
    await prisma.setting.upsert({ where: { key: 'migrated.shops.ukcheck2' }, update: {}, create: { key: 'migrated.shops.ukcheck2', value: 'true' } });
  }
  const flag = await prisma.setting.findUnique({ where: { key: 'seeded.shops.v2' } });
  if (flag) return;
  await prisma.shop.createMany({
    data: STARTER_SHOPS.map((s) => ({
      host: s.host,
      name: s.name,
      status: 'checking',
      origin: 'starter list',
      platform: s.pages ? 'listing' : 'auto',
      collection: s.pages?.join('\n') ?? null,
    })),
    skipDuplicates: true, // shops already in the list keep their settings
  });
  await prisma.setting.create({ data: { key: 'seeded.shops.v2', value: 'true' } });
}

type ShopRow = { id: string; host: string; name: string; platform: string; collection: string | null; origin?: string };

/**
 * Check a new shop: UK (prices in £) and readable. Picks how to read it:
 * Shopify catalogue → its Pokémon category pages → its sitemap.
 */
export async function verifyShop(shop: ShopRow, deadline: number) {
  await loadScanSettings();
  const fail = async (status: 'not-uk' | 'unreadable', reason: string) => {
    await prisma.shop.update({ where: { id: shop.id }, data: { status, enabled: false, lastError: reason, lastScannedAt: new Date() } });
    // Products already found there stop showing (links you added yourself stay)
    if (status === 'not-uk') {
      await prisma.trackedUrl.updateMany({ where: { host: bareHost(shop.host), source: 'CATALOG' }, data: { active: false } });
    }
  };

  // UK only. Shops from the starter list (taken from UK buying guides) pass unless shown to be non-UK;
  // shops found on the web or added by you must show they're UK (Shopify country, or UK details on the site).
  const uk = await ukCheck(shop.host);
  if (uk.verdict === 'not-uk' || (uk.verdict === 'unknown' && shop.origin !== 'starter list')) {
    await fail(
      'not-uk',
      uk.verdict === 'not-uk'
        ? `${uk.why ?? 'Not a UK shop'} — Seek is UK-only`
        : 'Couldn’t confirm it’s a UK shop (no UK address or Shopify country found)',
    );
    return { host: shop.host, status: 'not-uk' };
  }

  // 1. Shopify catalogue (keeping a collection you chose, e.g. just "pokemon")
  const handle = shop.collection && !/^https?:/i.test(shop.collection) ? shop.collection : null;
  const firstPage = await probeShopify(shop.host, handle);
  if (firstPage) {
    const pokemon = firstPage.filter((p) => isPokemonSealed(p, !!handle && /pok/i.test(handle))).length;
    await prisma.shop.update({
      where: { id: shop.id },
      data: { status: 'active', enabled: true, platform: 'shopify', collection: handle, scanPage: 1, nextScanAt: new Date(), lastError: null },
    });
    return { host: shop.host, status: 'active', how: 'shopify', pokemonOnFirstPage: pokemon };
  }

  // 2. Pokémon category pages (given in the starter list or by you)
  const pages = (shop.collection ?? '').split('\n').filter((u) => /^https?:\/\//.test(u));
  if (pages.length) {
    const found: string[] = [];
    for (const page of pages) {
      if (Date.now() > deadline) break;
      found.push(...(await crawlListingPage(page, deadline, 3)));
    }
    if (found.length) {
      await saveFoundUrls([...new Set(found)]);
      await prisma.shop.update({
        where: { id: shop.id },
        data: {
          status: 'active',
          enabled: true,
          platform: 'listing',
          productsFound: new Set(found).size,
          lastScannedAt: new Date(),
          nextScanAt: new Date(Date.now() + 24 * 3_600_000),
          lastError: null,
        },
      });
      return { host: shop.host, status: 'active', how: 'category pages', found: found.length };
    }
  }

  // 3. Sitemap
  const urls = await sitemapProductUrls(shop.host, deadline);
  if (urls.length) {
    await saveFoundUrls(urls);
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        status: 'active',
        enabled: true,
        platform: 'sitemap',
        productsFound: urls.length,
        lastScannedAt: new Date(),
        nextScanAt: new Date(Date.now() + 24 * 3_600_000),
        lastError: null,
      },
    });
    return { host: shop.host, status: 'active', how: 'sitemap', found: urls.length };
  }

  await fail('unreadable', 'Couldn’t read its products (it may block automated access). Paste product links from it instead.');
  return { host: shop.host, status: 'unreadable' };
}

/** Check up to `limit` shops waiting to be checked, in parallel. */
export async function verifyPendingShops(limit = 4, budgetMs = 40_000) {
  await ensureStarterShops();
  const deadline = Date.now() + budgetMs;
  const pending = await prisma.shop.findMany({ where: { status: 'checking' }, orderBy: { createdAt: 'asc' }, take: limit });
  return Promise.all(
    pending.map((s) =>
      verifyShop(s, deadline).catch((e) =>
        prisma.shop
          .update({ where: { id: s.id }, data: { status: 'unreadable', enabled: false, lastError: String(e).slice(0, 200) } })
          .then(() => ({ host: s.host, status: 'unreadable' })),
      ),
    ),
  );
}

/**
 * Find more UK shops on the web: read UK "where to buy Pokémon cards" articles
 * (found through news search) and collect the shop sites they link to.
 * New sites are added as "checking" — they're only polled once verified.
 */
export async function discoverShops(budgetMs = 40_000) {
  const deadline = Date.now() + budgetMs;
  const queries = [
    'where to buy pokemon cards uk',
    'pokemon cards uk online shop',
    'pokemon tcg restock uk retailers',
    'pokemon elite trainer box uk where to buy',
  ];
  const articleUrls = new Set<string>();
  for (const q of queries) {
    if (Date.now() > deadline) break;
    try {
      const { html } = await fetchHtml(bing(q), { timeoutMs: 8_000, retries: 0 });
      const $ = cheerio.load(html, { xml: true });
      $('item > link').each((_, el) => {
        const link = $(el).text().trim();
        try {
          const u = new URL(link);
          const real = /bing\.com$/.test(u.hostname) ? u.searchParams.get('url') : link;
          if (real) articleUrls.add(real);
        } catch {
          /* skip */
        }
      });
    } catch {
      /* skip this search */
    }
  }

  const counts = new Map<string, number>();
  for (const article of [...articleUrls].slice(0, 12)) {
    if (Date.now() > deadline) break;
    try {
      const { html, finalUrl } = await fetchHtml(article, { timeoutMs: 8_000, retries: 0 });
      const own = new URL(finalUrl).hostname.replace(/^www\./, '');
      const $ = cheerio.load(html);
      const seen = new Set<string>();
      $('a[href]').each((_, a) => {
        try {
          const host = new URL($(a).attr('href')!, finalUrl).hostname.toLowerCase();
          const bare = host.replace(/^www\./, '');
          if (bare === own || NOT_SHOPS.test(host) || seen.has(bare)) return;
          seen.add(bare);
          counts.set(host, (counts.get(host) ?? 0) + 1);
        } catch {
          /* skip */
        }
      });
    } catch {
      /* skip this article */
    }
  }

  // UK-looking sites first (.uk domains), and sites mentioned by more than one article
  const candidates = [...counts.entries()]
    .filter(([host]) => /\.uk$/.test(host) || (counts.get(host) ?? 0) > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([host]) => host);

  const known = await prisma.shop.findMany({ select: { host: true } });
  const knownBare = new Set(known.map((k) => k.host.replace(/^www\./, '')));
  const fresh = candidates.filter((h) => !knownBare.has(h.replace(/^www\./, '')));
  const { count } = fresh.length
    ? await prisma.shop.createMany({
        data: fresh.map((host) => ({ host, name: storeNameFromHost(host), status: 'checking', origin: 'found on web', platform: 'auto' })),
        skipDuplicates: true,
      })
    : { count: 0 };
  return { articles: articleUrls.size, candidates: candidates.length, added: count };
}
