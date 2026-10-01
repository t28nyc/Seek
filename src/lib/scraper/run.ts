import type { StockStatus, TrackedUrl } from '@prisma/client';
import { prisma } from '../db';
import { getStoreConfig } from '../retailers';
import { findOrCreateProduct } from '../products';
import { scrapeUrl, type ScrapeResult } from './scrape';

const MIN = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Adaptive polling: how long until this URL is due again.
 * The real floor is how often the scheduler calls /api/cron/scrape.
 */
export function nextDelayMs(o: {
  status: StockStatus;
  ok: boolean;
  failCount: number;
  priority: number;
  retryAfterSec?: number;
}): number {
  let base: number;
  if (!o.ok) {
    // Exponential backoff on failures/blocks: 30m, 1h, 2h, 4h, capped at 6h.
    base = Math.min(6 * 60 * MIN, 30 * MIN * 2 ** Math.min(o.failCount - 1, 4));
    if (o.retryAfterSec) base = Math.max(base, o.retryAfterSec * 1000);
  } else {
    switch (o.status) {
      // The scheduler fires every ~5 min, so 5 min is the effective floor.
      case 'QUEUE':
        base = 5 * MIN; // drop is live
        break;
      case 'IN_STOCK':
        base = 10 * MIN; // catch it selling out
        break;
      case 'OUT_OF_STOCK':
        base = o.priority > 0 ? 5 * MIN : 20 * MIN; // hot sets every run, the rest every ~20 min
        break;
      case 'PREORDER':
      case 'COMING_SOON':
        base = 30 * MIN;
        break;
      default:
        base = 10 * MIN;
    }
  }
  // Up to 20% early/late so checks spread out; a slightly-early 5 min still lands on the next run.
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** Write a scrape result to the database. Shared by the cron and the "track" endpoint. */
export async function applyResult(item: TrackedUrl, r: ScrapeResult) {
  const now = new Date();
  const failCount = r.ok ? 0 : item.failCount + 1;

  // A failed fetch keeps the last known status/price; it only records the error.
  const status = r.ok ? r.status : item.status;
  const pricePence = r.ok ? (r.pricePence ?? item.pricePence) : item.pricePence;
  const wasPricePence = r.ok ? (r.wasPricePence ?? null) : item.wasPricePence;
  const statusChanged = status !== item.status;
  const priceChanged = pricePence !== item.pricePence;

  let productId = item.productId;
  let priority = item.priority;
  if (!productId && r.title) {
    const product = await findOrCreateProduct(r.title);
    productId = product.id;
    if (product.hot) priority = Math.max(priority, 1);
  }

  const [updated] = await prisma.$transaction([
    prisma.trackedUrl.update({
      where: { id: item.id },
      data: {
        status,
        pricePence,
        wasPricePence,
        onSale: !!(wasPricePence && pricePence && wasPricePence > pricePence),
        ...(r.ok && r.rrpPence ? { rrpPence: r.rrpPence } : {}),
        title: item.title ?? r.title,
        imageUrl: item.imageUrl ?? r.imageUrl,
        productId,
        priority,
        failCount,
        lastError: r.error ?? null,
        lastCheckedAt: now,
        ...(statusChanged && { lastChangedAt: now }),
        ...(status === 'IN_STOCK' && r.ok && { lastInStockAt: now }),
        // Stop polling pages that have disappeared.
        ...(r.httpStatus === 404 || r.httpStatus === 410 ? { active: false } : {}),
        nextCheckAt: new Date(
          now.getTime() + nextDelayMs({ status, ok: r.ok, failCount, priority, retryAfterSec: r.retryAfterSec }),
        ),
      },
    }),
    ...(statusChanged || priceChanged || !r.ok
      ? [
          prisma.stockCheck.create({
            data: {
              trackedUrlId: item.id,
              status: r.ok ? r.status : 'UNKNOWN',
              pricePence: r.pricePence,
              httpStatus: r.httpStatus,
              durationMs: r.durationMs,
              error: r.error?.slice(0, 500),
            },
          }),
        ]
      : []),
  ]);

  return { updated, statusChanged, previous: item.status };
}

export async function checkOne(item: TrackedUrl) {
  const r = await scrapeUrl(item.url, getStoreConfig(item.url));
  const { statusChanged, previous } = await applyResult(item, r);
  // Hook for alerts: e.g. if (statusChanged && r.status === 'IN_STOCK') await notify(item)
  return { id: item.id, status: r.ok ? r.status : previous, changed: statusChanged, ok: r.ok, error: r.error };
}

/**
 * Check every URL that is due, within a time budget that leaves headroom
 * under the function's maxDuration.
 *
 * - Different shops run in parallel; requests to the same shop run one at a
 *   time with a jittered gap (minGapMs; 3s for shops without a config).
 * - Each row is "leased" before it's fetched, so overlapping or duplicate
 *   cron invocations never scrape the same page twice.
 */
export async function runDueChecks({ budgetMs = 40_000, limit = 40 } = {}) {
  const started = Date.now();
  const due = await prisma.trackedUrl.findMany({
    where: { active: true, nextCheckAt: { lte: new Date() } },
    orderBy: [{ priority: 'desc' }, { nextCheckAt: 'asc' }],
    take: limit,
  });

  const byHost = new Map<string, TrackedUrl[]>();
  for (const d of due) {
    const host = new URL(d.url).host;
    byHost.set(host, [...(byHost.get(host) ?? []), d]);
  }

  const results: Awaited<ReturnType<typeof checkOne>>[] = [];
  const outOfTime = () => Date.now() - started > budgetMs;

  await Promise.all(
    [...byHost.values()].map(async (items) => {
      for (const [i, item] of items.entries()) {
        if (outOfTime()) return;
        if (i > 0) await sleep(getStoreConfig(item.url).minGapMs * (0.75 + Math.random() * 0.5));
        if (outOfTime()) return;

        const lease = await prisma.trackedUrl.updateMany({
          where: { id: item.id, nextCheckAt: item.nextCheckAt },
          data: { nextCheckAt: new Date(Date.now() + 5 * MIN) },
        });
        if (lease.count === 0) continue; // another run took it

        try {
          results.push(await checkOne(item));
        } catch (e) {
          results.push({ id: item.id, status: item.status, changed: false, ok: false, error: String(e) });
        }
      }
    }),
  );

  return {
    due: due.length,
    checked: results.length,
    changed: results.filter((r) => r.changed).length,
    failed: results.filter((r) => !r.ok).length,
    ms: Date.now() - started,
    results,
  };
}
