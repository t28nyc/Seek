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
import { extractReleaseDate, findAnyDate } from '../dates';
import { isPublicHost } from '../retailers';

export type Feed = {
  name: string;
  url: string;
  /** 'deal': every TCG post counts (it's buyable now). 'news': only posts about releases, stock or events. */
  kind: 'deal' | 'news';
  /** Which page its posts go on. 'auto' = In store if the post mentions shops/events, else Product drops. */
  page: 'online' | 'in-store' | 'auto';
};

const bing = (q: string) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&mkt=en-GB`;

/** Add more feeds here. Any RSS or Atom URL works; failing feeds are skipped and shown as failing. */
export const FEEDS: Feed[] = [
  // UK deals forum: restocks and price drops posted by shoppers
  { name: 'HotUKDeals', url: 'https://www.hotukdeals.com/rss/tag/pokemon', kind: 'deal', page: 'auto' },
  // TCG news site: set announcements and release dates
  { name: 'PokeBeach', url: 'https://www.pokebeach.com/feed', kind: 'news', page: 'auto' },
  // Web news searches (UK edition)
  { name: 'Web: pre-orders', url: bing('pokemon tcg pre-order'), kind: 'news', page: 'online' },
  { name: 'Web: restocks', url: bing('pokemon cards restock uk'), kind: 'news', page: 'online' },
  { name: 'Web: new sets', url: bing('pokemon tcg new set release date'), kind: 'news', page: 'auto' },
  { name: 'Web: Pokémon Center', url: bing('pokemon center tcg pre-orders'), kind: 'news', page: 'online' },
  { name: 'Web: in stores', url: bing('pokemon cards in stores uk'), kind: 'news', page: 'in-store' },
  { name: 'Web: UK shops', url: bing('pokemon cards smyths OR argos OR tesco OR asda OR game'), kind: 'news', page: 'in-store' },
  { name: 'Web: events', url: bing('pokemon tcg prerelease event'), kind: 'news', page: 'in-store' },
];

const TCG =
  /\b(tcg|trading cards?|booster|elite trainer|etb|tins?|blister|bundle|collection box|premium collection|card game|pok[eé]mon cards?|sealed|expansion)\b/i;
const NOT_TCG = /\b(gift card|pok[eé]mon go|switch 2?|nintendo|t-shirt|hoodie|plush|lego|figure|video game|anime|movie|trailer)\b/i;
const DROP_WORDS =
  /\b(release[sd]?|releasing|release date|pre-?orders?|restock(ed)?|back in stock|launch(es|ed)?|coming|available|reveal(ed)?|announce[sd]?|drops?|allocation|raffle|ballot|queue|in stock|new set|expansion|where to buy|on sale|event|prerelease|pre-release|happy meal)\b/i;
const IN_STORE =
  /\b(in[- ]?stores?|instore|pre-?release|local game stores?|LGS|store release|street date|supermarkets?|smyths|argos|tesco|asda|sainsbury'?s|morrisons|aldi|lidl|w ?h ?smith|the entertainer|game stores?|happy meal|mcdonald'?s|event|tournament|league)\b/i;

export function dropKind(title: string, summary: string, page: Feed['page'] = 'auto'): 'online' | 'in-store' {
  if (page !== 'auto') return page;
  return IN_STORE.test(`${title} ${summary}`) ? 'in-store' : 'online';
}

export function isDropPost(title: string, summary: string, kind: Feed['kind']): boolean {
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

export type FeedResult = { feed: string; ok: boolean; matched: number; added: number; error?: string };

/** Fetch every feed and store new posts. Records per-feed results so the pages can show what worked. */
export async function refreshDrops(): Promise<FeedResult[]> {
  const results = await Promise.all(
    FEEDS.map(async (feed): Promise<FeedResult> => {
      try {
        const { html } = await fetchHtml(feed.url, { timeoutMs: 10_000, retries: 1 });
        const posts = parseFeed(html).filter((p) => isDropPost(p.title, p.summary, feed.kind));
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
        return { feed: feed.name, ok: true, matched: posts.length, added: count };
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

  // Keep the table small: remove feed posts older than 60 days whose date (if any) has passed.
  // Links you added yourself and deleted posts are kept.
  const cutoff = new Date(Date.now() - 60 * 86_400_000);
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

/**
 * Add a drop or in-store link by hand. Reads the page for a title, image and
 * date (event start date, publish date, or a date in the text); anything
 * passed in overrides what's found.
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

  let title = input.title?.trim();
  let imageUrl: string | undefined;
  let date = input.date;
  let summary: string | undefined;
  try {
    const { html, finalUrl } = await fetchHtml(u.toString(), { timeoutMs: 8_000, retries: 0 });
    const $ = cheerio.load(html);
    title ||= ($('meta[property="og:title"]').attr('content') || $('title').first().text() || $('h1').first().text()).trim();
    summary = ($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content'))?.trim();
    const img = $('meta[property="og:image"]').attr('content');
    if (img) imageUrl = new URL(img, finalUrl).toString();
    if (!date) {
      // schema.org Event start date is the most reliable for events
      $('script[type="application/ld+json"]').each((_, el) => {
        if (date) return;
        const m = ($(el).html() ?? '').match(/"startDate"\s*:\s*"([^"]+)"/);
        if (m && !Number.isNaN(new Date(m[1]).getTime())) date = new Date(m[1]);
      });
    }
    date ||= findAnyDate(`${title} ${summary ?? ''}`);
  } catch {
    /* page unreadable: still save the link with whatever was given */
  }

  return prisma.dropItem.upsert({
    where: { url: u.toString() },
    update: { hidden: false, kind: input.kind, ...(input.title && { title: input.title }), ...(input.date && { releaseDate: input.date }) },
    create: {
      url: u.toString(),
      title: (title || u.hostname).slice(0, 300),
      kind: input.kind,
      source: ADDED_BY_YOU,
      summary: summary?.slice(0, 400),
      imageUrl,
      releaseDate: date,
      publishedAt: new Date(),
    },
  });
}
