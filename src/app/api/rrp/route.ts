import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { parsePricePence } from '@/lib/scraper/parse';

export const dynamic = 'force-dynamic';

/**
 * POST /api/rrp  { productId: string, rrp: string | null }
 * Sets (or clears) the RRP for a product. Products are shared across shops,
 * so one RRP applies to that product everywhere it's listed.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { productId?: unknown; rrp?: unknown };
  if (typeof body.productId !== 'string') return NextResponse.json({ error: 'Missing productId.' }, { status: 400 });

  let rrpPence: number | null = null;
  if (body.rrp !== null && body.rrp !== '') {
    rrpPence = parsePricePence(String(body.rrp)) ?? null;
    if (!rrpPence) return NextResponse.json({ error: 'Enter a price like 54.99.' }, { status: 400 });
  }

  const product = await prisma.product
    .update({ where: { id: body.productId }, data: { rrpPence } })
    .catch(() => null);
  if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });

  revalidatePath('/');
  return NextResponse.json({ ok: true, rrpPence });
}
