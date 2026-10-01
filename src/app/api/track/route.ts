import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { resolveStore } from '@/lib/retailers';
import { scrapeUrl } from '@/lib/scraper/scrape';
import { applyResult } from '@/lib/scraper/run';
import { addListingPage, addShop, scanShop } from '@/lib/scraper/catalog';
import { ukCheck } from '@/lib/uk';
import { bareHost } from '@/lib/host';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type ShopReply = { kind: 'shop'; shop: string; site: string; found: number; finished: boolean; pending?: boolean; note?: string };

/**
 * POST /api/track  { url: string }
 * - Product link → track it and check it straight away.
 * - Homepage or Shopify collection (/collections/pokemon) → scan for every Pokémon product.
 * - Any other category page (a link that isn't a single product) → collect the product links on it.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== 'string' || body.url.length > 2048) {
    return NextResponse.json({ error: 'Paste a link first.' }, { status: 400 });
  }

  const resolved = resolveStore(body.url);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  // ---- Whole shop or Shopify collection ----
  if ('shopHost' in resolved) {
    // Earlier versions saved collection links as a single "product"; tidy those up.
    if (resolved.collection) {
      await prisma.trackedUrl.updateMany({
        where: { url: `https://${resolved.shopHost}/collections/${resolved.collection}` },
        data: { active: false },
      });
    }
    const added = await addShop(resolved.shopHost, resolved.collection);
    if (added && 'notUk' in added) {
      return NextResponse.json({ error: `Seek is UK-only — that site prices in ${added.currency === 'OTHER' ? 'another currency' : added.currency}.` }, { status: 400 });
    }
    if (!added) {
      return NextResponse.json(
        {
          error:
            'Couldn’t find any Pokémon products there — the site may block scanning or not list its products. Try pasting its Pokémon category page or a product link instead.',
        },
        { status: 400 },
      );
    }
    const reply: ShopReply = { kind: 'shop', shop: added.shop.name, site: added.shop.host, found: 0, finished: true };
    if (added.alreadyWhole) {
      reply.found = added.shop.productsFound;
      reply.note = `Already scanning the whole of ${added.shop.name}, which includes that collection.`;
    } else if (added.platform === 'shopify') {
      const scan = await scanShop(added.shop, Date.now() + 25_000);
      reply.found = scan.found;
      reply.finished = scan.finished;
    } else {
      reply.found = added.found ?? 0;
      reply.finished = false;
      reply.pending = true;
    }
    revalidatePath('/');
    return NextResponse.json(reply);
  }

  // ---- Product link (or a category page that turns out to list many products) ----
  const existing = await prisma.trackedUrl.findUnique({ where: { url: resolved.url } });
  if (existing) {
    // Promote scan finds / deleted items to "added by you" so they're checked every few minutes.
    if (!existing.active || existing.source === 'CATALOG') {
      await prisma.trackedUrl.update({
        where: { id: existing.id },
        data: { active: true, source: 'USER', nextCheckAt: new Date() },
      });
    }
    revalidatePath('/');
    return NextResponse.json({ kind: 'product', created: false, listing: existing });
  }

  // UK only: shops we don't know must price in pounds; Pokémon Center links must be its UK store.
  if (resolved.config.key === 'POKEMON_CENTER' && !/^\/en-gb\//.test(new URL(resolved.url).pathname)) {
    return NextResponse.json({ error: 'Seek is UK-only — use the UK Pokémon Center (pokemoncenter.com/en-gb/…).' }, { status: 400 });
  }
  if (!resolved.config.key) {
    const uk = await ukCheck(new URL(resolved.url).hostname);
    if (uk.verdict === 'not-uk') {
      return NextResponse.json({ error: 'Seek is UK-only — that shop doesn’t price in pounds.' }, { status: 400 });
    }
  }

  const item = await prisma.trackedUrl.create({
    data: { url: resolved.url, host: bareHost(resolved.url), retailer: resolved.config.key, source: 'USER' },
  });
  const result = await scrapeUrl(item.url, resolved.config, { timeoutMs: 7_000, retries: 0 });

  // Not a single product (no price, no stock signal)? Maybe it's a category page — collect its products.
  const notAProduct = !result.ok || (result.status === 'UNKNOWN' && !result.pricePence);
  if (notAProduct) {
    const listing = await addListingPage(item.url, Date.now() + 30_000);
    if (listing) {
      await prisma.trackedUrl.delete({ where: { id: item.id } });
      revalidatePath('/');
      return NextResponse.json({
        kind: 'shop',
        shop: listing.shop.name,
        site: listing.shop.host,
        found: listing.found,
        finished: false,
        pending: true,
      } satisfies ShopReply);
    }
  }

  const { updated } = await applyResult(item, result);
  revalidatePath('/');
  return NextResponse.json(
    { kind: 'product', created: true, listing: updated, firstCheck: { ok: result.ok, status: result.status, error: result.error } },
    { status: 201 },
  );
}
