import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { resolveStore } from '@/lib/retailers';
import { scrapeUrl } from '@/lib/scraper/scrape';
import { applyResult } from '@/lib/scraper/run';
import { addShop, scanShop } from '@/lib/scraper/catalog';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/track  { url: string }
 * - A product link: save it, check it straight away, then keep polling it.
 * - A website's homepage: add it to the sites Peek scans for Pokémon products
 *   (Shopify catalogue, or the site's sitemap) and do a first scan.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== 'string' || body.url.length > 2048) {
    return NextResponse.json({ error: 'Send { "url": "<product link>" }.' }, { status: 400 });
  }

  const resolved = resolveStore(body.url);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  if ('shopHost' in resolved) {
    const added = await addShop(resolved.shopHost);
    if (!added) {
      return NextResponse.json(
        {
          error:
            'Couldn’t find any Pokémon products on that site — it may block scanning or not list products in a sitemap. Paste a product link from it instead.',
        },
        { status: 400 },
      );
    }
    if (added.platform === 'shopify') {
      const scan = await scanShop(added.shop, Date.now() + 25_000);
      revalidatePath('/');
      return NextResponse.json({ kind: 'shop', shop: added.shop.name, found: scan.found, finished: scan.finished });
    }
    revalidatePath('/');
    // Sitemap finds have no title/stock yet; they're checked over the next half hour.
    return NextResponse.json({ kind: 'shop', shop: added.shop.name, found: added.found, finished: false, pending: true });
  }

  const existing = await prisma.trackedUrl.findUnique({ where: { url: resolved.url } });
  if (existing) {
    // Promote shop-scan finds to "tracked by you" so they're checked every few minutes.
    if (!existing.active || existing.source === 'CATALOG') {
      await prisma.trackedUrl.update({
        where: { id: existing.id },
        data: { active: true, source: 'USER', nextCheckAt: new Date() },
      });
    }
    return NextResponse.json({ kind: 'product', created: false, listing: existing });
  }

  const item = await prisma.trackedUrl.create({
    data: { url: resolved.url, retailer: resolved.config.key, source: 'USER' },
  });

  // Shorter timeout than the cron: someone is waiting on this request.
  const result = await scrapeUrl(item.url, resolved.config, { timeoutMs: 7_000, retries: 0 });
  const { updated } = await applyResult(item, result);

  revalidatePath('/');
  return NextResponse.json(
    { kind: 'product', created: true, listing: updated, firstCheck: { ok: result.ok, status: result.status, error: result.error } },
    { status: 201 },
  );
}
