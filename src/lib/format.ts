const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

export function formatPence(pence: number | null | undefined): string | undefined {
  return pence == null ? undefined : gbp.format(pence / 100);
}

export function timeAgo(date: Date | null | undefined, now = Date.now()): string {
  if (!date) return 'never';
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function formatDay(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
}
