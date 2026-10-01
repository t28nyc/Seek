/** A URL's domain without "www." — the key Seek uses for "which shop is this?". */
export function bareHost(urlOrHost: string): string {
  let h = urlOrHost;
  try {
    if (/^https?:\/\//i.test(urlOrHost)) h = new URL(urlOrHost).hostname;
  } catch {
    /* use as given */
  }
  return h.toLowerCase().replace(/^www\./, '');
}
