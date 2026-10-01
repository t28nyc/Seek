/**
 * Product drops from the web: reads deal-forum and news feeds (RSS/Atom),
 * keeps posts about Pokémon TCG releases, pre-orders, restocks and deals,
 * and stores them as DropItem tiles.
 */
import * as cheerio from 'cheerio';
import { prisma } from '../db';
import { fetchHtml } from '../scraper/fetch';
import { extractReleaseDate } from '../dates';

export type Feed = {
  name: string;
  url: string;
  /** 'deal': every TCG post counts (it's something buyable now). 'news': only posts about releases/stock. */
  kind: 'deal' | 'news';
};

/** Add more feeds here. Any RSS or Atom URL works; failing feeds are skipped. */
export const FEEDS: Feed[] = [
  { name: 'HotUKDeals', url: 'https://www.hotukdeals.com/rss/tag/pokemon', kind: 'deal' },
  { name: 'PokeBeach', url: 'https://www.pokebeach.com/feed', kind: 'news' },
];

const TCG = /\b(tcg|trading cards?|booster|elite trainer|etb|tins?|blister|bundle|collection box|premium collection|card game|pokemon cards?|pokémon cards?|sealed)\b/i;
const NOT_TCG = /\b(gift card|pok[eé]mon go|switch|nintendo|t-shirt|hoodie|plush|lego|figure|video game)\b/i;
const DROP_WORDS =
  /\b(release|released|releasing|pre-?orders?|restock|restocked|back in stock|launch|launches|coming soon|available now|reveal|revealed|announce[sd]?|drop|allocation|raffle|ballot|queue|in stock|new set|expansion)\b/i;

const IN_STORE = /\b(in[- ]?stores?|instore|pre-?release|local game stores?|LGS|store release|street date)\b/i;

/** Posts about releases in physical shops go on the In Store page; everything else on Product Drops. */
export function dropKind(title: string, summary: string): 'online' | 'in-store' {
  return IN_STORE.test(`${title} ${summary}`) ? 'in-store' : 'online';
}

export function isDropPost(title: string, summary: string, kind: Feed['kind']): boolean {
  const text = `${title} ${summary}`;
  if (!TCG.test(text) || NOT_TCG.test(title)) return false;
  return kind === 'deal' || DROP_WORDS.test(title);
}

export type FeedPost = { url: string; title: string; summary: string; imageUrl?: string; publishedAt: Date };

/** Parse RSS 2.0 or Atom into posts. */
export function parseFeed(xml: string): FeedPost[] {
  const $ = cheerio.load(xml, { xml: true });
  const posts: FeedPost[] = [];

  $('item, entry').each((_, el) => {
    const $el = $(el);
    const title = $el.children('title').first().text().trim();
    const link =
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
      summaryDoc('img').first().attr('src') ||
      undefined;
    const dateText =
      $el.children('pubDate').first().text() ||
      $el.children('published').first().text() ||
      $el.children('updated').first().text() ||
      $el.children('dc\\:date').first().text();
    const publishedAt = dateText ? new Date(dateText) : new Date();

    if (!title || !link || !/^https?:\/\//.test(link)) return;
    posts.push({
      url: link,
      title,
      summary,
      imageUrl: imageUrl && /^https?:\/\//.test(imageUrl) ? imageUrl : undefined,
      publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
    });
  });
  return posts;
}

/** Fetch every feed and store new drop posts. */
export async function refreshDrops() {
  const results = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const { html } = await fetchHtml(feed.url, { timeoutMs: 10_000, retries: 1 });
        const posts = parseFeed(html).filter((p) => isDropPost(p.title, p.summary, feed.kind));
        const { count } = posts.length
          ? await prisma.dropItem.createMany({
              data: posts.map((p) => ({
                url: p.url,
                title: p.title.slice(0, 300),
                source: feed.name,
                kind: dropKind(p.title, p.summary),
                summary: p.summary || null,
                imageUrl: p.imageUrl,
                publishedAt: p.publishedAt,
                releaseDate: extractReleaseDate(`${p.title}. ${p.summary}`),
              })),
              skipDuplicates: true,
            })
          : { count: 0 };
        return { feed: feed.name, matched: posts.length, added: count };
      } catch (e) {
        return { feed: feed.name, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  // Keep the table small: drop posts older than 60 days whose release date (if any) has passed.
  const cutoff = new Date(Date.now() - 60 * 86_400_000);
  await prisma.dropItem.deleteMany({
    where: { publishedAt: { lt: cutoff }, OR: [{ releaseDate: null }, { releaseDate: { lt: new Date() } }] },
  });
  return results;
}
