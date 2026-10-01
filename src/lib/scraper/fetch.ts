/**
 * HTTP layer for the scraper: hard timeouts (connect + body), a response
 * size cap, limited retries for transient errors only, and detection of
 * bot-challenge pages and virtual queues so they are never mistaken for
 * "out of stock".
 */

export type FetchFailureKind = 'timeout' | 'network' | 'http' | 'blocked' | 'queue' | 'too_large';

export class FetchFailure extends Error {
  constructor(
    public kind: FetchFailureKind,
    message: string,
    public httpStatus?: number,
    public retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'FetchFailure';
  }
}

export type FetchResult = {
  html: string;
  httpStatus: number;
  finalUrl: string;
  durationMs: number;
};

export type FetchOptions = {
  /** Covers the whole request, including reading the body. */
  timeoutMs?: number;
  /** Extra attempts after the first, for timeouts / network errors / 5xx only. */
  retries?: number;
};

const MAX_BYTES = 3_000_000;

const HEADERS: Record<string, string> = {
  // Identify yourself. Set SCRAPER_USER_AGENT to something with a contact URL.
  'User-Agent': process.env.SCRAPER_USER_AGENT ?? 'PeekStockChecker/0.1 (+https://example.com/peek-bot)',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Cache-Control': 'no-cache',
};

// Challenge/interstitial pages are small. Real product pages often *include*
// bot-management scripts, so only apply these to short documents.
const CHALLENGE_MAX_LEN = 40_000;
const CHALLENGE_PATTERNS = [
  /Just a moment\.\.\.|cf-chl-|cf_chl_opt/i, // Cloudflare interstitial
  /_Incapsula_Resource|Incapsula incident ID/i, // Imperva
  /px-captcha|_pxCaptcha/i, // HUMAN / PerimeterX
  /captcha-delivery\.com/i, // DataDome
  /<title>\s*Access Denied\s*<\/title>/i, // Akamai and generic WAFs
  /<title>[^<]*(attention required|verify you are human|are you a robot)/i,
];
const QUEUE_URL = /queue-it\.net|\/queue\b|waitingroom/i;
const QUEUE_PAGE = /<title>[^<]*(queue|waiting room|you are now in line)/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchHtml(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const retries = opts.retries ?? 1;
  let last: FetchFailure | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(750 * 2 ** (attempt - 1) + Math.random() * 500);
    try {
      return await fetchOnce(url, timeoutMs);
    } catch (e) {
      last = e instanceof FetchFailure ? e : new FetchFailure('network', String(e));
      const transient =
        last.kind === 'timeout' || last.kind === 'network' || (last.kind === 'http' && (last.httpStatus ?? 0) >= 500);
      // Never retry blocks or queues: hammering a challenge only gets the IP flagged harder.
      if (!transient) throw last;
    }
  }
  throw last!;
}

async function fetchOnce(url: string, timeoutMs: number): Promise<FetchResult> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const finalUrl = res.url || url;

    if (QUEUE_URL.test(new URL(finalUrl).hostname + new URL(finalUrl).pathname)) {
      throw new FetchFailure('queue', 'Redirected to a virtual queue', res.status);
    }
    if (res.status === 429 || res.status === 503) {
      const ra = Number(res.headers.get('retry-after'));
      // 503 from a WAF is a block; from origin it's an outage. Treat both as "back off".
      throw new FetchFailure('blocked', `HTTP ${res.status}`, res.status, Number.isFinite(ra) && ra > 0 ? ra : undefined);
    }
    if (res.status === 403 || res.status === 401) throw new FetchFailure('blocked', `HTTP ${res.status}`, res.status);
    if (res.status === 404 || res.status === 410) throw new FetchFailure('http', `Page gone (HTTP ${res.status})`, res.status);
    if (!res.ok) throw new FetchFailure('http', `HTTP ${res.status}`, res.status);

    const html = await readCapped(res, MAX_BYTES);

    if (html.length < CHALLENGE_MAX_LEN) {
      if (QUEUE_PAGE.test(html)) throw new FetchFailure('queue', 'Virtual queue page', res.status);
      if (CHALLENGE_PATTERNS.some((p) => p.test(html))) {
        throw new FetchFailure('blocked', 'Bot challenge page', res.status);
      }
    }

    return { html, httpStatus: res.status, finalUrl, durationMs: Date.now() - started };
  } catch (e) {
    if (e instanceof FetchFailure) throw e;
    if (ctrl.signal.aborted) throw new FetchFailure('timeout', `Timed out after ${timeoutMs}ms`);
    throw new FetchFailure('network', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new FetchFailure('too_large', `Response over ${max} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
