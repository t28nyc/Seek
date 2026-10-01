import type { StockStatus } from '@prisma/client';
import type { RetailerConfig } from '../retailers';
import { fetchHtml, FetchFailure, type FetchFailureKind } from './fetch';
import { parseProductPage, type Signal } from './parse';

export type ScrapeResult = {
  /** QUEUE / parsed status on success; UNKNOWN when the fetch failed. */
  status: StockStatus;
  ok: boolean;
  title?: string;
  imageUrl?: string;
  pricePence?: number;
  wasPricePence?: number;
  httpStatus?: number;
  durationMs: number;
  error?: string;
  failure?: FetchFailureKind;
  retryAfterSec?: number;
  signals?: Signal[];
};

/**
 * Fetch one product page and extract title, price and stock status.
 * Never throws: every failure comes back as { ok: false, failure, error }
 * so a single bad page can't take down a cron batch.
 */
export async function scrapeUrl(
  url: string,
  cfg: Pick<RetailerConfig, 'selectors'>,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<ScrapeResult> {
  const started = Date.now();
  try {
    const page = await fetchHtml(url, { timeoutMs: opts.timeoutMs ?? 8_000, retries: opts.retries ?? 1 });
    const parsed = parseProductPage(page.html, cfg, page.finalUrl);
    return { ...parsed, ok: true, httpStatus: page.httpStatus, durationMs: Date.now() - started };
  } catch (e) {
    const durationMs = Date.now() - started;
    if (e instanceof FetchFailure) {
      // A waiting room is a real, useful status — the drop is live.
      if (e.kind === 'queue') {
        return { status: 'QUEUE', ok: true, httpStatus: e.httpStatus, durationMs, failure: 'queue' };
      }
      return {
        status: 'UNKNOWN',
        ok: false,
        failure: e.kind,
        error: e.message,
        httpStatus: e.httpStatus,
        retryAfterSec: e.retryAfterSec,
        durationMs,
      };
    }
    return { status: 'UNKNOWN', ok: false, failure: 'network', error: String(e), durationMs };
  }
}
