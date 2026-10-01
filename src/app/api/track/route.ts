import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { resolveStore } from '@/lib/retailers';
import { scrapeUrl } from '@/lib/scraper/scrape';
import { applyResult } from '@/lib/scraper/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/track  { url: string }
 * Validates any shop's product URL, saves it, does a first
 * check immediately so the user sees a result, then leaves it to the cron.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== 'string' || body.url.length > 2048) {
    return NextResponse.json({ error: 'Send { "url": "<product link>" }.' }, { status: 400 });
  }

  const resolved = resolveStore(body.url);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  const existing = await prisma.trackedUrl.findUnique({ where: { url: resolved.url }, include: { product: true } });
  if (existing) {
    if (!existing.active) await prisma.trackedUrl.update({ where: { id: existing.id }, data: { active: true } });
    return NextResponse.json({ created: false, listing: existing });
  }

  const item = await prisma.trackedUrl.create({
    data: { url: resolved.url, retailer: resolved.config.key, source: 'USER' },
  });

  // Shorter timeout than the cron: someone is waiting on this request.
  const result = await scrapeUrl(item.url, resolved.config, { timeoutMs: 7_000, retries: 0 });
  const { updated } = await applyResult(item, result);

  revalidatePath('/');
  return NextResponse.json(
    {
      created: true,
      listing: updated,
      firstCheck: { ok: result.ok, status: result.status, error: result.error },
    },
    { status: 201 },
  );
}
