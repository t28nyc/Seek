import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { bing, DEFAULT_FEEDS, DEFAULT_RRP_RULES, getFeeds, getRrpRules, saveSettings } from '@/lib/settings';
import { parsePricePence } from '@/lib/scraper/parse';
import { isPublicHost } from '@/lib/retailers';

export const dynamic = 'force-dynamic';

type Body = { section?: string; action?: string; id?: string; values?: Record<string, unknown> };

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pence = (v: unknown) => (v === '' || v == null ? null : (parsePricePence(String(v)) ?? undefined));

/** Swap a row with its neighbour in sort order. */
async function move(rows: { id: string }[], id: string, dir: number, update: (id: string, sortOrder: number) => Promise<unknown>) {
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  const order = rows.map((r) => r.id);
  [order[i], order[j]] = [order[j], order[i]];
  await Promise.all(order.map((rid, n) => update(rid, n)));
}

/**
 * POST /api/settings — everything the Settings page changes.
 * { section: 'general', values }                        save general settings
 * { section: 'rrp', action: 'create'|'update'|'delete'|'up'|'down'|'reset', id?, values? }
 * { section: 'feeds', action: 'create'|'update'|'delete'|'up'|'down'|'reset', id?, values? }
 */
export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as Body;
  const v = body.values ?? {};

  try {
    if (body.section === 'general') {
      const saved = await saveSettings(v);
      revalidatePath('/', 'layout');
      return NextResponse.json({ ok: true, settings: saved });
    }

    if (body.section === 'rrp') {
      const rules = await getRrpRules(true);
      switch (body.action) {
        case 'create':
        case 'update': {
          const name = str(v.name, 120);
          const keywords = str(v.keywords, 500);
          const rrpPence = pence(v.rrp);
          const lowPence = pence(v.low);
          if (!name || !keywords) return NextResponse.json({ error: 'Give it a name and at least one keyword.' }, { status: 400 });
          if (!rrpPence) return NextResponse.json({ error: 'Enter an RRP like 49.99.' }, { status: 400 });
          if (lowPence === undefined) return NextResponse.json({ error: 'Enter the low price like 45.99, or leave it empty.' }, { status: 400 });
          const data = { name, keywords, rrpPence, lowPence, enabled: v.enabled !== false };
          if (body.action === 'create') {
            await prisma.rrpRule.create({ data: { ...data, sortOrder: rules.length } });
          } else {
            await prisma.rrpRule.update({ where: { id: body.id! }, data });
          }
          break;
        }
        case 'delete':
          await prisma.rrpRule.delete({ where: { id: body.id! } });
          break;
        case 'up':
        case 'down':
          await move(rules, body.id!, body.action === 'up' ? -1 : 1, (id, sortOrder) =>
            prisma.rrpRule.update({ where: { id }, data: { sortOrder } }),
          );
          break;
        case 'reset':
          await prisma.$transaction([
            prisma.rrpRule.deleteMany({}),
            prisma.rrpRule.createMany({ data: DEFAULT_RRP_RULES.map((r, i) => ({ ...r, sortOrder: i })) }),
          ]);
          break;
        default:
          return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
      }
      revalidatePath('/', 'layout');
      return NextResponse.json({ ok: true, rules: await getRrpRules(true) });
    }

    if (body.section === 'feeds') {
      const feeds = await getFeeds(true);
      switch (body.action) {
        case 'create':
        case 'update': {
          const name = str(v.name, 80);
          const raw = str(v.url, 1_000);
          // Not a link? Treat it as web search words.
          const url = /^https?:\/\//i.test(raw) ? raw : raw ? bing(raw) : '';
          if (!name || !url) return NextResponse.json({ error: 'Give it a name and a feed link or search words.' }, { status: 400 });
          try {
            if (!isPublicHost(new URL(url).hostname)) throw new Error();
          } catch {
            return NextResponse.json({ error: 'That isn’t a public web address.' }, { status: 400 });
          }
          const page = ['online', 'in-store', 'auto'].includes(String(v.page)) ? String(v.page) : 'auto';
          const kind = v.kind === 'deal' ? 'deal' : 'news';
          const data = { name, url, page, kind, enabled: v.enabled !== false };
          if (body.action === 'create') {
            await prisma.feedSource.create({ data: { ...data, sortOrder: feeds.length } });
          } else {
            await prisma.feedSource.update({ where: { id: body.id! }, data });
          }
          break;
        }
        case 'delete':
          await prisma.feedSource.delete({ where: { id: body.id! } });
          break;
        case 'up':
        case 'down':
          await move(feeds, body.id!, body.action === 'up' ? -1 : 1, (id, sortOrder) =>
            prisma.feedSource.update({ where: { id }, data: { sortOrder } }),
          );
          break;
        case 'reset':
          await prisma.$transaction([
            prisma.feedSource.deleteMany({}),
            prisma.feedSource.createMany({ data: DEFAULT_FEEDS.map((f, i) => ({ ...f, sortOrder: i })) }),
          ]);
          break;
        default:
          return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
      }
      revalidatePath('/', 'layout');
      return NextResponse.json({ ok: true, feeds: await getFeeds(true) });
    }

    return NextResponse.json({ error: 'Unknown section.' }, { status: 400 });
  } catch (e) {
    const unique = e instanceof Error && /Unique constraint/i.test(e.message);
    return NextResponse.json({ error: unique ? 'That source is already in the list.' : 'Couldn’t save that.' }, { status: 400 });
  }
}
