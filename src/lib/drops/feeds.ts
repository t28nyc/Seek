/**
 * Product drops and in-store releases from the web.
 *
 * Sources are RSS feeds: a UK deals forum (HotUKDeals), TCG news (PokeBeach)
 * and Bing News searches — Bing publishes any news search as RSS, which is
 * how Peek "searches the web" without a paid search API. Posts about
 * Pokémon TCG releases, pre-orders, restocks, events and deals are kept and
 * stored as DropItem tiles on the Product drops or In store page.
 */
import * as cheerio from 'cheerio';
import { prisma } from '../db';
import { fetchHtml } from '../scraper/fetch';
import { extractReleaseDate } from '../dates';
import { extractDropDetails, type DropDetails } from './extract';
import { isNonUkPost } from '../uk';
import { isPublicHost } from '../retailers';
import { getFeeds, getSettings } from '../settings';

export type Feed = {
  name: string;
  url: string;
  /** 'deal': every TCG post counts (it's buyable now). 'news': only posts about releases, stock or events. */
  kind: 'deal' | 'news';
  /** Which page its posts go on. 'auto' = In store if the post mentions shops/events, else Product drops. */
  page: 'online' | 'in-store' | 'auto';
};

/** The list of sources lives in the database and is edited on the Settings page (defaults in lib/settings.ts). */
export { getFeeds } from '../settings';

const TCG =
  /\b(tcg|trading cards?|booster|elite trainer|etb|tins?|blister|bundle|collection box|premium collection|card game|pok[eé]mon cards?|sealed|expansion)\b/i;
const NOT_TCG = /\b(gift card|pok[eé]mon go|switch 2?|nintendo|t-shirt|hoodie|plush|lego|figure|video game|anime|movie|trailer)\b/i;
const DROP_WORDS =
  /\b(release[sd]?|releasing|release date|pre-?orders?|restock(ed)?|back in stock|launch(es|ed)?|coming|available|reveal(ed)?|announce[sd]?|drops?|allocation|raffle|ballot|queue|in stock|new set|expansion|where to buy|on sale|event|prerelease|pre-release|happy meal)\b/i;
// Releases in physical shops (not events — those are filtered out of In store)
const IN_STORE =
  /\b(in[- ]?stores?|instore|on shelves|store release|street date|supermarkets?|smyths|argos|tesco|asda|sainsbury'?s|morrisons|aldi|lidl|w ?h ?smith|the entertainer|game stores?|happy meal|mcdonald'?s|high street)\b/i;

export function dropKind(title: string, summary: string, page: string = 'auto'): 'online' | 'in-store' {
  if (page === 'online' || page === 'in-store') return page;
  return IN_STORE.test(`${title} ${summary}`) ? 'in-store' : 'online';
}

export function isDropPost(title: string, summary: string, kind: string): boolean {
  if (!TCG.test(`${title} ${summary}`) || NOT_TCG.test(title)) return false;
  return kind === 'deal' || DROP_WORDS.test(title);
}

export type FeedPost = {
  url: string;
  title: string;
  summary: string;
  imageUrl?: string;
  publisher?: string;
  publishedAt: Date;
};

/** Bing News wraps links in a click tracker; the real article is in its `url` parameter. */
function unwrapLink(link: string): string {
  try {
    const u = new URL(link);
    if (/(^|\.)bing\.com$/.test(u.hostname) && u.searchParams.get('url')) return u.searchParams.get('url')!;
  } catch {
    /* keep as is */
  }
  return link;
}

/** Parse RSS 2.0 or Atom into posts. */
export function parseFeed(xml: string): FeedPost[] {
  const $ = cheerio.load(xml, { xml: true });
  const posts: FeedPost[] = [];

  $('item, entry').each((_, el) => {
    const $el = $(el);
    const title = $el.children('title').first().text().trim();
    const rawLink =
      $el.children('link').first().text().trim() ||
      $el.children('link[rel="alternate"]').attr('href') ||
      $el.children('link').first().attr('href') ||
      $el.children('guid').first().text().trim();
    const rawSummary =
      $el.children('description').first().text() ||
      $el.children('summary').first().text() ||
      $el.children('content').first().text() ||
      $el.children('content\\:encoded').first().text();
    const summaryDoc = cheerio.load(rawSummary || '');
    const summary = summaryDoc.root().text().replace(/\s+/g, ' ').trim().slice(0, 400);
    const imageUrl =
      $el.find('media\\:thumbnail, media\\:content').first().attr('url') ||
      $el.children('enclosure[type^="image"]').attr('url') ||
      $el.children('News\\:Image, news\\:image').first().text().trim() ||
      summaryDoc('img').first().attr('src') ||
      undefined;
    const publisher = $el.children('News\\:Source, news\\:source, source').first().text().trim() || undefined;
    const dateText =
      $el.children('pubDate').first().text() ||
      $el.children('published').first().text() ||
      $el.children('updated').first().text() ||
      $el.children('dc\\:date').first().text();
    const publishedAt = dateText ? new Date(dateText) : new Date();
    const url = unwrapLink(rawLink);

    if (!title || !url || !/^https?:\/\//.test(url)) return;
    posts.push({
      url,
      title,
      summary,
      publisher,
      imageUrl: imageUrl && /^https?:\/\//.test(imageUrl) ? imageUrl : undefined,
      publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
    });
  });
  return posts;
}

export type FeedResult = {
  feed: string;
  ok: boolean;
  matched: number; // relevant posts in the feed right now
  added: number; // new this time
  inStore?: number; // of the relevant posts: on In store
  drops?: number; // on Product drops
  deleted?: number; // deleted by you (stay hidden)
  error?: string;
};

/** Fetch every feed and store new posts. Records per-feed results so the pages can show what worked. */
export async function refreshDrops(): Promise<FeedResult[]> {
  const [feeds, settings] = await Promise.all([getFeeds(), getSettings()]);
  const results = await Promise.all(
    feeds.map(async (feed): Promise<FeedResult> => {
      try {
        const { html } = await fetchHtml(feed.url, { timeoutMs: 10_000, retries: 1 });
        // Pokémon TCG drops only, and UK only: posts about US/other shops or $/€ prices are left out.
        const posts = parseFeed(html).filter(
          (p) => isDropPost(p.title, p.summary, feed.kind) && !isNonUkPost(`${p.title} ${p.summary}`, settings.nonUkWords),
        );
        const { count } = posts.length
          ? await prisma.dropItem.createMany({
              data: posts.map((p) => ({
                url: p.url,
                title: p.title.slice(0, 300),
                source: p.publisher ? `${p.publisher}` : feed.name,
                kind: dropKind(p.title, p.summary, feed.page),
                summary: p.summary || null,
                imageUrl: p.imageUrl,
                publishedAt: p.publishedAt,
                releaseDate: extractReleaseDate(`${p.title}. ${p.summary}`),
              })),
              skipDuplicates: true, // also keeps posts you deleted deleted
            })
          : { count: 0 };
        // Where did this feed's posts end up? (Shown in the Sources panel.)
        const rows = posts.length
          ? await prisma.dropItem.findMany({ where: { url: { in: posts.map((p) => p.url) } }, select: { kind: true, hidden: true } })
          : [];
        return {
          feed: feed.name,
          ok: true,
          matched: posts.length,
          added: count,
          inStore: rows.filter((r) => !r.hidden && r.kind === 'in-store').length,
          drops: rows.filter((r) => !r.hidden && r.kind === 'online').length,
          deleted: rows.filter((r) => r.hidden).length,
        };
      } catch (e) {
        return { feed: feed.name, ok: false, matched: 0, added: 0, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  await prisma.jobRun.upsert({
    where: { name: 'drops-status' },
    update: { lastRunAt: new Date(), info: JSON.stringify(results) },
    create: { name: 'drops-status', lastRunAt: new Date(), info: JSON.stringify(results) },
  });

  // Keep the table small: remove feed posts older than twice the "keep" setting whose date (if any)
  // has passed. Links you added yourself and deleted posts are kept.
  const cutoff = new Date(Date.now() - Math.max(settings.dropsKeepDays * 2, 14) * 86_400_000);
  await prisma.dropItem.deleteMany({
    where: {
      publishedAt: { lt: cutoff },
      hidden: false,
      source: { not: ADDED_BY_YOU },
      OR: [{ releaseDate: null }, { releaseDate: { lt: new Date() } }],
    },
  });
  return results;
}

export async function feedStatus() {
  const row = await prisma.jobRun.findUnique({ where: { name: 'drops-status' } });
  if (!row?.info) return null;
  try {
    return { at: row.lastRunAt, results: JSON.parse(row.info) as FeedResult[] };
  } catch {
    return null;
  }
}

// ---------- Links added by hand ----------

export const ADDED_BY_YOU = 'Added by you';

/** Read a drop/product page: title, image, price, status, expected date, entry link, purchase limit. */
async function readDropPage(url: string): Promise<(DropDetails & { summary?: string }) | null> {
  try {
    const { html, finalUrl } = await fetchHtml(url, { timeoutMs: 8_000, retries: 0 });
    const details = extractDropDetails(html, finalUrl);
    const $ = cheerio.load(html);
    // Event pages: schema.org Event start date is the most reliable date
    if (!details.releaseDate) {
      $('script[type="application/ld+json"]').each((_, el) => {
        if (details.releaseDate) return;
        const m = ($(el).html() ?? '').match(/"startDate"\s*:\s*"([^"]+)"/);
        if (m && !Number.isNaN(new Date(m[1]).getTime())) details.releaseDate = new Date(m[1]);
      });
    }
    const description = ($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content'))?.trim();
    return { ...details, summary: details.notes.length ? details.notes.join(' · ') : description?.slice(0, 300) };
  } catch {
    return null;
  }
}

const detailFields = (d: Awaited<ReturnType<typeof readDropPage>>) =>
  d
    ? {
        status: d.status ?? null,
        pricePence: d.pricePence ?? null,
        entryUrl: d.entryUrl ?? null,
        purchaseLimit: d.purchaseLimit ?? null,
        ...(d.imageUrl && { imageUrl: d.imageUrl }),
        ...(d.summary && { summary: d.summary.slice(0, 400) }),
        checkedAt: new Date(),
      }
    : {};

/**
 * Add a drop or in-store link by hand. Reads the page for the title, image,
 * price, status (product drop, raffle, pre-order…), expected date, where to
 * enter and any purchase limit. A date or title you give overrides what's found.
 */
export async function addDropLink(input: { url: string; kind: 'online' | 'in-store'; title?: string; date?: Date }) {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input.url.trim()) ? input.url.trim() : `https://${input.url.trim()}`);
  } catch {
    throw new Error('That doesn’t look like a link.');
  }
  if (!isPublicHost(u.hostname)) throw new Error('That address isn’t a public website.');
  u.hash = '';

  const details = await readDropPage(u.toString());
  const title = (input.title?.trim() || details?.title || u.hostname).slice(0, 300);
  const releaseDate = input.date ?? details?.releaseDate ?? null;

  return prisma.dropItem.upsert({
    where: { url: u.toString() },
    update: { hidden: false, kind: input.kind, title, releaseDate, ...detailFields(details) },
    create: {
      url: u.toString(),
      title,
      kind: input.kind,
      source: ADDED_BY_YOU,
      releaseDate,
      publishedAt: new Date(),
      ...detailFields(details),
    },
  });
}

/**
 * Re-read links you added (status, date and price change as a drop
 * approaches). Runs with the drop feeds, at most every 3 hours, oldest first.
 */
export async function recheckAddedDrops(limit = 15, minAgeMs = 3 * 3_600_000, budgetMs = 40_000) {
  const deadline = Date.now() + budgetMs;
  const items = await prisma.dropItem.findMany({
    where: {
      source: ADDED_BY_YOU,
      hidden: false,
      OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(Date.now() - minAgeMs) } }],
    },
    orderBy: { checkedAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
  });
  let updated = 0;
  for (const item of items) {
    if (Date.now() > deadline) break;
    const d = await readDropPage(item.url);
    await prisma.dropItem.update({
      where: { id: item.id },
      data: d
        ? { ...detailFields(d), ...(d.releaseDate && { releaseDate: d.releaseDate }) }
        : { checkedAt: new Date() },
    });
    if (d) updated++;
  }
  return { checked: items.length, updated };
}
