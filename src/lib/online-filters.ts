import type { Prisma, StockStatus } from '@prisma/client';
import { bareHost } from '@/lib/host';

/** Filters for the Online page; shared with "Delete all" so it removes exactly what's shown. */
export const STATUS_FILTERS = {
  all: { label: 'All', statuses: null },
  in: { label: 'In stock', statuses: ['IN_STOCK', 'QUEUE'] },
  pre: { label: 'Pre-order', statuses: ['PREORDER', 'COMING_SOON'] },
  out: { label: 'Out of stock', statuses: ['OUT_OF_STOCK', 'UNKNOWN'] },
} as const satisfies Record<string, { label: string; statuses: readonly StockStatus[] | null }>;
export type StatusKey = keyof typeof STATUS_FILTERS;

export const PAGE = 50;

export const LANGUAGES = {
  EN: 'English',
  JP: 'Japanese',
  ZH: 'Chinese',
  OTHER: 'Other',
} as const;
export type LangKey = keyof typeof LANGUAGES;

export type OnlineFilters = { status: StatusKey; site?: string; lang?: LangKey; mine: boolean; q: string; n: number };

type Raw = Record<string, string | string[] | undefined | null>;
const one = (v: string | string[] | undefined | null) => (Array.isArray(v) ? v[0] : (v ?? undefined));

export function readFilters(sp: Raw): OnlineFilters {
  const status = one(sp.status) as StatusKey | undefined;
  const lang = one(sp.lang)?.toUpperCase() as LangKey | undefined;
  const site = one(sp.site);
  return {
    status: status && status in STATUS_FILTERS ? status : 'all',
    site: site ? bareHost(site) : undefined,
    lang: lang && lang in LANGUAGES ? lang : undefined,
    mine: one(sp.mine) === '1',
    q: (one(sp.q) ?? '').trim().slice(0, 80),
    n: Math.min(Math.max(Number(one(sp.n)) || PAGE, PAGE), 1000),
  };
}

/** Everything except the status filter (used for per-status counts). */
export function baseWhere(f: OnlineFilters): Prisma.TrackedUrlWhereInput {
  return {
    active: true,
    ...(f.site && { host: f.site }),
    ...(f.lang && { product: { language: f.lang } }),
    ...(f.mine && { source: 'USER' as const }),
    ...(f.q && { title: { contains: f.q, mode: 'insensitive' as const } }),
  };
}

export function listWhere(f: OnlineFilters): Prisma.TrackedUrlWhereInput {
  const statuses = STATUS_FILTERS[f.status].statuses;
  const base = baseWhere(f);
  return statuses ? { ...base, status: { in: [...statuses] } } : base;
}

export function filtersHref(f: OnlineFilters, patch: Partial<OnlineFilters> = {}) {
  const m = { ...f, ...patch };
  const p = new URLSearchParams();
  if (m.status !== 'all') p.set('status', m.status);
  if (m.site) p.set('site', m.site);
  if (m.lang) p.set('lang', m.lang);
  if (m.mine) p.set('mine', '1');
  if (m.q) p.set('q', m.q);
  if (m.n > PAGE) p.set('n', String(m.n));
  const s = p.toString();
  return s ? `/?${s}` : '/';
}
