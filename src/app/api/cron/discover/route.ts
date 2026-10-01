import { NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cron-auth';
import { prisma } from '@/lib/db';
import { discoverAll } from '@/lib/scraper/discover';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HISTORY_DAYS = 90;

/**
 * GET /api/cron/discover — daily: find new products on category pages and
 * prune old stock history so the free-tier database stays small.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [discovered, pruned] = await Promise.all([
    discoverAll(),
    prisma.stockCheck.deleteMany({
      where: { checkedAt: { lt: new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60_000) } },
    }),
  ]);

  return NextResponse.json({ discovered, prunedChecks: pruned.count });
}
