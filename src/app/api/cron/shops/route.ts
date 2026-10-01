import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isAuthorizedCron } from '@/lib/cron-auth';
import { claimJob } from '@/lib/jobs';
import { discoverShops, verifyPendingShops } from '@/lib/scraper/shops';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/shops — checks shops waiting to be verified (a few per run),
 * and once a week looks for new UK shops on the web.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const discover = await claimJob('shop-discovery', 7 * 24 * 3_600_000);
  const [verified, discovered] = await Promise.all([
    verifyPendingShops(4, 45_000),
    discover ? discoverShops(40_000) : Promise.resolve(null),
  ]);
  if (verified.length || discovered?.added) revalidatePath('/', 'layout');
  return NextResponse.json({ verified, discovered });
}
