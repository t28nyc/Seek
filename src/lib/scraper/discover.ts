import * as cheerio from 'cheerio';
import { prisma } from '../db';
import { RETAILERS, resolveStore, type RetailerConfig } from '../retailers';
import { categorize } from '../categorize';
import { fetchHtml } from './fetch';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Crawl a retailer's configured category pages and queue any new Pokémon TCG
 * product links for polling. Runs once a day — new products appear far less
 * often than stock changes.
 */
export async function discoverRetailer(cfg: RetailerConfig) {
  const found = new Set<string>();
  const errors: string[] = [];

  for (const [i, listUrl] of cfg.discoveryUrls.entries()) {
    if (i > 0) await sleep(cfg.minGapMs);
    try {
      const { html, finalUrl } = await fetchHtml(listUrl, { timeoutMs: 10_000, retries: 1 });
      const $ = cheerio.load(html);
      $('a[href]').each((_, a) => {
        let u: URL;
        try {
          u = new URL($(a).attr('href')!, finalUrl);
        } catch {
          return;
        }
        if (!cfg.hosts.includes(u.hostname)) return;
        if (cfg.productPath && !cfg.productPath.test(u.pathname)) return;

        const label = [$(a).attr('title'), $(a).attr('aria-label'), $(a).text(), u.pathname.replace(/[-_/]/g, ' ')]
          .filter(Boolean)
          .join(' ');
        if (!categorize(label).looksLikeTcg) return;

        const resolved = resolveStore(u.toString());
        if ('url' in resolved) found.add(resolved.url);
      });
    } catch (e) {
      errors.push(`${listUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const urls = [...found];
  const { count } = urls.length
    ? await prisma.trackedUrl.createMany({
        data: urls.map((url) => ({ url, retailer: cfg.key, source: 'SEED' as const })),
        skipDuplicates: true, // already-tracked URLs are left alone
      })
    : { count: 0 };

  return { retailer: cfg.key, found: urls.length, added: count, errors };
}

export async function discoverAll() {
  return Promise.all(RETAILERS.filter((r) => r.discoveryUrls.length).map(discoverRetailer));
}
