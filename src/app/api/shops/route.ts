import { after, NextResponse } from 'next/server';
import { bareHost } from '@/lib/host';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { isPublicHost, storeNameFromHost } from '@/lib/retailers';
import { claimJob } from '@/lib/jobs';
import { discoverShops, verifyPendingShops } from '@/lib/scraper/shops';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/shops — the shop list in Settings.
 * { action: 'add', url }            add a shop (homepage) or a shop's Pokémon category page
 * { action: 'toggle', id }          turn polling on/off
 * { action: 'recheck', id }         check it again (UK + readable)
 * { action: 'remove', id }          remove it and the products it found
 * { action: 'discover' }            look for more UK shops on the web now
 */
export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { action?: string; id?: string; url?: string };

  switch (body.action) {
    case 'add': {
      let u: URL;
      try {
        const raw = String(body.url ?? '').trim();
        u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      } catch {
        return NextResponse.json({ error: 'Enter a shop’s web address.' }, { status: 400 });
      }
      if (!isPublicHost(u.hostname)) return NextResponse.json({ error: 'That isn’t a public website.' }, { status: 400 });
      const isPage = u.pathname.length > 1;
      const existing = await prisma.shop.findUnique({ where: { host: u.hostname } });
      const pages = isPage
        ? [...new Set([...(existing?.collection ?? '').split('\n').filter((x) => /^https?:/.test(x)), `${u.origin}${u.pathname}`])].join('\n')
        : existing?.collection ?? null;
      await prisma.shop.upsert({
        where: { host: u.hostname },
        update: { status: 'checking', enabled: false, collection: pages, ...(isPage && { platform: 'listing' }), lastError: null },
        create: {
          host: u.hostname,
          name: storeNameFromHost(u.hostname),
          status: 'checking',
          origin: 'you',
          enabled: false,
          platform: isPage ? 'listing' : 'auto',
          collection: pages,
        },
      });
      after(() => verifyPendingShops(4, 45_000));
      break;
    }
    case 'toggle': {
      const shop = await prisma.shop.findUnique({ where: { id: body.id ?? '' } });
      if (!shop) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      if (shop.status !== 'active') return NextResponse.json({ error: 'Check it again first — it isn’t verified yet.' }, { status: 400 });
      await prisma.shop.update({ where: { id: shop.id }, data: { enabled: !shop.enabled, nextScanAt: new Date() } });
      break;
    }
    case 'recheck': {
      await prisma.shop.update({ where: { id: body.id ?? '' }, data: { status: 'checking', lastError: null } }).catch(() => null);
      after(() => verifyPendingShops(4, 45_000));
      break;
    }
    case 'remove': {
      const shop = await prisma.shop
        .update({ where: { id: body.id ?? '' }, data: { status: 'removed', enabled: false } })
        .catch(() => null);
      if (!shop) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      await prisma.trackedUrl.updateMany({
        where: { source: 'CATALOG', host: bareHost(shop.host) },
        data: { active: false },
      });
      break;
    }
    case 'discover': {
      if (!(await claimJob('shop-discovery-manual', 5 * 60_000))) {
        return NextResponse.json({ ok: true, message: 'Already searching — new shops appear over the next few minutes.' });
      }
      after(async () => {
        await discoverShops(30_000);
        await verifyPendingShops(4, 25_000);
        revalidatePath('/settings');
      });
      return NextResponse.json({ ok: true, message: 'Searching the web for UK shops — new ones appear here over the next few minutes as they’re checked.' });
    }
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }

  revalidatePath('/', 'layout');
  return NextResponse.json({ ok: true });
}
