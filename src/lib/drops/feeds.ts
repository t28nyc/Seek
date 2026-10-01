/**
 * Product drops from the web: reads deal-forum and news feeds (RSS/Atom),
 * keeps posts about Pokémon TCG releases, pre-orders, restocks and deals,
 * and stores them as DropItem tiles.
 */
import * as cheerio from 'cheerio';
import { prisma } from '../db';
import { fetchHtml } from '../scraper/fetch';

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

export function isDropPost(title: string, summary: string, kind: Feed['kind']): boolean {
  const text = `${title} ${summary}`;
  if (!TCG.test(text) || NOT_TCG.test(title)) return false;
  return kind === 'deal' || DROP_WORDS.test(title);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/**
 * Pull a release date out of text: "27th March", "March 27, 2026", "27 Mar 2026".
 * A date without a year is taken as the next time that date comes round.
 * Only dates near a release word count, so "posted 3 May" isn't read as a release.
 */
export function extractReleaseDate(text: string, now = new Date()): Date | undefined {
  const near = text.match(
    new RegExp(`(releas\\w*|launch\\w*|out on|available|pre-?order\\w*|drops?|arriv\\w*)[^.]{0,40}?((\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}(?:,?\\s+(\\d{4}))?|${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?)`, 'i'),
  );
  if (!near) return undefined;
  const day = Number(near[3] ?? near[7]);
  const monthName = (near[4] ?? near[6])?.slice(0, 3).toLowerCase();
  const yearStr = near[5] ?? near[8];
  const month = MONTHS.indexOf(monthName ?? '');
  if (month < 0 || !day || day > 31) return undefined;
  let year = yearStr ? Number(yearStr) : now.getUTCFullYear();
  let d = new Date(Date.UTC(year, month, day, 12));
  if (!yearStr && d.getTime() < now.getTime() - 14 * 86_400_000) d = new Date(Date.UTC(++year, month, day, 12));
  return d;
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
